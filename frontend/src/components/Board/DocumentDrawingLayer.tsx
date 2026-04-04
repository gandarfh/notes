import { useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store'
import { useDrawing } from '../../hooks/useDrawing'
import { InlineEditor } from '../Drawing/InlineEditor'
import { StylePanel } from '../StylePanel/StylePanel'
import { setClearDrawingSelection } from '../../input/drawingBridge'
import type { Editor } from '@tiptap/react'
import type { DrawingElement } from '../../drawing/types'
import { getElementBounds, isArrowType } from '../../drawing/types'
import { hitTest } from '../../drawing/hitTest'

interface Props {
    editor: Editor | null
    children: React.ReactNode
    isExternalUpdateRef: React.RefObject<boolean>
}

/** Cluster of drawing elements that occupy a vertical region */
interface DrawingCluster {
    id: string
    top: number
    bottom: number
    height: number
}

// ── Union-Find for connection-based clustering ──

class UnionFind {
    private parent = new Map<string, string>()
    private rank = new Map<string, number>()

    make(x: string) {
        if (!this.parent.has(x)) {
            this.parent.set(x, x)
            this.rank.set(x, 0)
        }
    }

    has(x: string) { return this.parent.has(x) }

    find(x: string): string {
        let root = x
        while (this.parent.get(root) !== root) root = this.parent.get(root)!
        let curr = x
        while (curr !== root) {
            const next = this.parent.get(curr)!
            this.parent.set(curr, root)
            curr = next
        }
        return root
    }

    union(a: string, b: string) {
        const ra = this.find(a), rb = this.find(b)
        if (ra === rb) return
        const rankA = this.rank.get(ra)!, rankB = this.rank.get(rb)!
        if (rankA < rankB) this.parent.set(ra, rb)
        else if (rankA > rankB) this.parent.set(rb, ra)
        else { this.parent.set(rb, ra); this.rank.set(ra, rankA + 1) }
    }
}

function clusterIdFromElements(ids: string[]): string {
    const sorted = [...ids].sort()
    let h = 0
    const s = sorted.join(',')
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0
    }
    return `cluster-${(h >>> 0).toString(36)}`
}

/**
 * Groups drawing elements into vertical clusters using connection-based grouping.
 *
 * 1. Union-Find: shapes connected by arrows → same component
 * 2. Bounding box per component (shapes only, no arrow waypoints)
 * 3. Merge components with overlapping/nearby vertical bounds (gap tolerance)
 * 4. Stable IDs from element ID hash
 */
function computeClusters(elements: DrawingElement[], gap = 20): DrawingCluster[] {
    const shapes = elements.filter(el => !isArrowType(el))
    if (shapes.length === 0) return []

    // Phase 1: Union-Find on arrow connections
    const uf = new UnionFind()
    for (const s of shapes) uf.make(s.id)

    for (const el of elements) {
        if (!isArrowType(el)) continue
        const a = el.startConnection?.elementId
        const b = el.endConnection?.elementId
        if (a && b && uf.has(a) && uf.has(b)) {
            uf.union(a, b)
        }
    }

    // Phase 2: Group shapes by connected component, compute bounding boxes
    // Add margin around each element to account for stroke width, selection handles,
    // and visual breathing room so text doesn't touch the element edges
    const elementMargin = 16
    const groups = new Map<string, { ids: string[]; top: number; bottom: number }>()
    for (const s of shapes) {
        const root = uf.find(s.id)
        const bounds = getElementBounds(s)
        const elTop = bounds.y - elementMargin
        const elBottom = bounds.y + bounds.h + elementMargin

        let g = groups.get(root)
        if (!g) {
            g = { ids: [], top: elTop, bottom: elBottom }
            groups.set(root, g)
        } else {
            g.top = Math.min(g.top, elTop)
            g.bottom = Math.max(g.bottom, elBottom)
        }
        g.ids.push(s.id)
    }

    // Phase 3: Merge components with overlapping/nearby vertical bounds
    const components = [...groups.values()].sort((a, b) => a.top - b.top)
    const merged: { ids: string[]; top: number; bottom: number }[] = []

    for (const comp of components) {
        if (merged.length > 0) {
            const last = merged[merged.length - 1]
            if (comp.top <= last.bottom + gap) {
                last.bottom = Math.max(last.bottom, comp.bottom)
                last.ids.push(...comp.ids)
                continue
            }
        }
        merged.push({ ids: [...comp.ids], top: comp.top, bottom: comp.bottom })
    }

    // Phase 4: Build clusters with stable IDs
    return merged
        .filter(c => Math.round(c.bottom - c.top) > 0)
        .map(c => ({
            id: clusterIdFromElements(c.ids),
            top: c.top,
            bottom: c.bottom,
            height: c.bottom - c.top,
        }))
}

export function DocumentDrawingLayer({ editor, children, isExternalUpdateRef }: Props) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const drawingCanvasRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawingLayerRef = useRef<HTMLDivElement>(null)

    const drawingSubTool = useAppStore(s => s.drawingSubTool)
    const drawingData = useAppStore(s => s.drawingData)

    const isDrawingToolActive = drawingSubTool !== 'draw-select'

    // Block creation is a no-op in document mode — blocks use TipTap embeds
    const onBlockCreate = useCallback(async () => {}, [])
    // In document mode, blocks are TipTap embeds — their store positions are canvas/dashboard
    // coords and must not be used as arrow routing obstacles
    const emptyBlockRects = useCallback(() => [] as Array<{ id: string; x: number; y: number; width: number; height: number }>, [])

    const {
        editorRequest,
        closeEditor,
        renderDrawing,
        eventConsumedRef,
        clearDrawingSelection,
        styleSelection,
        updateSelectedStyle,
        reorderSelected,
        alignSelected,
        multiSelected,
    } = useDrawing(
        drawingCanvasRef,
        overlayCanvasRef,
        wrapperRef,
        onBlockCreate,
        { blockRectsOverride: emptyBlockRects },
    )

    // Register clearDrawingSelection globally
    useEffect(() => {
        setClearDrawingSelection(clearDrawingSelection)
        return () => setClearDrawingSelection(null)
    }, [clearDrawingSelection])

    // Prevent text selection only when clicking on a drawing element.
    // Uses native mousedown (fires after useDrawing's pointerdown sets eventConsumedRef).
    // When clicking on text without a drawing element, let the editor handle it
    // for cursor placement and text selection.
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return
        const onMouseDown = (e: MouseEvent) => {
            if (!eventConsumedRef.current) return

            // Check if there's a drawing element under the cursor
            const rect = el.getBoundingClientRect()
            const worldX = e.clientX - rect.left
            const worldY = e.clientY - rect.top
            const drawingData = useAppStore.getState().drawingData
            let elements: DrawingElement[] = []
            try { elements = drawingData ? JSON.parse(drawingData) : [] } catch { /* */ }

            const hit = hitTest(elements, worldX, worldY)
            if (hit || isDrawingToolActive) {
                // Clicking on a drawing element or using a creation tool — block text selection
                e.preventDefault()
                // Blur the editor so keyboard events (Delete, Esc, arrows) go to
                // the drawing layer instead of the contentEditable TipTap editor
                if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) {
                    document.activeElement.blur()
                }
            }
            // Otherwise: let the editor handle it (cursor/text selection)
        }
        el.addEventListener('mousedown', onMouseDown)
        return () => el.removeEventListener('mousedown', onMouseDown)
    }, [eventConsumedRef, isDrawingToolActive])

    // Lock viewport to {0,0,1} and render
    useEffect(() => {
        renderDrawing({ x: 0, y: 0, zoom: 1 })
    }, [renderDrawing])

    // Resize canvases when wrapper size changes
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return

        const obs = new ResizeObserver(() => {
            const height = el.scrollHeight

            if (drawingCanvasRef.current) {
                drawingCanvasRef.current.style.height = `${height}px`
            }
            if (overlayCanvasRef.current) {
                overlayCanvasRef.current.style.height = `${height}px`
            }
            if (drawingLayerRef.current) {
                drawingLayerRef.current.style.height = `${height}px`
            }

            renderDrawing({ x: 0, y: 0, zoom: 1 })
        })

        obs.observe(el)
        return () => obs.disconnect()
    }, [renderDrawing])

    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Sync spacers and highlight when drawingData changes — no debounce
    useEffect(() => {
        if (!editor) return
        if (!drawingData) return

        let elements: DrawingElement[] = []
        try {
            elements = JSON.parse(drawingData)
        } catch { return }

        const clusters = computeClusters(elements)
        const wrapperEl = wrapperRef.current
        if (!wrapperEl) return

        // Show highlight on affected nodes
        highlightDisplacedNodes(editor, clusters, wrapperEl)

        // Auto-clear highlight after 300ms of no updates (i.e. drag ended)
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = setTimeout(() => {
            highlightDisplacedNodes(editor, [], wrapperEl)
        }, 300)

        if (elements.length > 0) {
            // Mark as external update so TipTap's onUpdate doesn't save/reload
            isExternalUpdateRef.current = true
            syncSpacers(editor, clusters, wrapperEl)
            // Reset after TipTap's deferred onUpdate fires (macro-task)
            setTimeout(() => { isExternalUpdateRef.current = false }, 0)
        }
    }, [editor, drawingData, isExternalUpdateRef])

    return (
        <div
            ref={wrapperRef}
            className={`doc-drawing-wrapper ${isDrawingToolActive ? 'drawing-active' : ''}`}
            style={{ cursor: isDrawingToolActive ? 'crosshair' : undefined }}
        >
            {children}

            <canvas
                ref={drawingCanvasRef}
                className="drawing-canvas"
            />

            <canvas
                ref={overlayCanvasRef}
                className="drawing-overlay"
            />

            <div ref={drawingLayerRef} className="doc-drawing-layer">
                {editorRequest && (
                    <InlineEditor
                        request={editorRequest}
                        onClose={closeEditor}
                    />
                )}
            </div>

            {styleSelection.length > 0 && (
                <StylePanel
                    elements={styleSelection}
                    onUpdate={updateSelectedStyle}
                    onReorder={reorderSelected}
                    onAlign={alignSelected}
                    multiSelected={multiSelected}
                />
            )}
        </div>
    )
}

/**
 * Synchronize spacers with drawing clusters.
 * Hides existing spacer DOM elements to measure content positions
 * without spacer interference, then rebuilds spacers in one transaction.
 */
function syncSpacers(editor: Editor, clusters: DrawingCluster[], wrapperEl: HTMLElement) {
    if (!editor.schema.nodes.drawingSpacer) return

    const { state } = editor
    const { doc } = state
    const view = editor.view

    // ── Step 1: Collect existing spacers and hide their DOM elements ──
    const spacerPositions: { pos: number; size: number }[] = []
    const hiddenEls: HTMLElement[] = []

    doc.descendants((node, pos) => {
        if (node.type.name === 'drawingSpacer') {
            spacerPositions.push({ pos, size: node.nodeSize })
            try {
                const domNode = view.nodeDOM(pos) as HTMLElement | null
                if (domNode && domNode instanceof HTMLElement) {
                    domNode.style.display = 'none'
                    hiddenEls.push(domNode)
                }
            } catch { /* skip */ }
        }
    })

    // Force synchronous reflow so measurements reflect hidden spacers
    void wrapperEl.offsetHeight

    // ── Step 2: Measure content node positions (spacer-free layout) ──
    const wrapperRect = wrapperEl.getBoundingClientRect()

    const nodePositions: { offset: number; top: number; bottom: number }[] = []
    doc.forEach((node: any, offset: number) => {
        if (node.type.name === 'drawingSpacer') return
        try {
            const domNode = view.nodeDOM(offset) as HTMLElement | null
            if (!domNode || !(domNode instanceof HTMLElement)) return
            const rect = domNode.getBoundingClientRect()
            nodePositions.push({
                offset,
                top: rect.top - wrapperRect.top,
                bottom: rect.bottom - wrapperRect.top,
            })
        } catch { /* skip */ }
    })

    // ── Step 3: Restore hidden spacer elements ──
    for (const el of hiddenEls) {
        el.style.display = ''
    }

    // ── Step 4: Transform cluster coordinates to spacer-free space ──
    // Drawing coords are in "with spacers" space. To convert to spacer-free,
    // subtract the cumulative height of PREVIOUS clusters' spacers (not existing
    // DOM spacers, which would include our own spacer and double-count).
    if (clusters.length === 0 && spacerPositions.length === 0) return

    const sortedClusters = [...clusters].sort((a, b) => a.top - b.top)

    // Compute cumulative spacer offset from previous clusters (+ padding)
    // Each spacer adds its cluster height + CSS padding to the document flow
    const spacerPadding = 32 // 16px top + 16px bottom from .drawing-spacer CSS

    const desiredSpacers: { beforeOffset: number; cluster: DrawingCluster }[] = []
    let cumulativeSpacerHeight = 0

    for (const cluster of sortedClusters) {
        if (Math.round(cluster.height) <= 0) continue

        // cleanTop = cluster position minus all spacers from clusters ABOVE this one
        const cleanTop = cluster.top - cumulativeSpacerHeight

        let targetOffset = doc.content.size
        for (const np of nodePositions) {
            if (np.bottom > cleanTop) {
                targetOffset = np.offset
                break
            }
        }
        desiredSpacers.push({ beforeOffset: targetOffset, cluster })

        // Add this cluster's spacer height to cumulative for next clusters
        cumulativeSpacerHeight += Math.round(cluster.height) + spacerPadding
    }

    // ── Step 5: Single transaction — remove old, insert new ──
    let tr = state.tr

    for (let i = spacerPositions.length - 1; i >= 0; i--) {
        const { pos, size } = spacerPositions[i]
        tr = tr.delete(pos, pos + size)
    }

    for (const { beforeOffset, cluster } of desiredSpacers) {
        const spacerNode = editor.schema.nodes.drawingSpacer.create({
            spacerId: cluster.id,
            height: Math.round(cluster.height),
        })
        const mappedPos = tr.mapping.map(beforeOffset)
        tr = tr.insert(mappedPos, spacerNode)
    }

    if (tr.docChanged) {
        editor.view.dispatch(tr)
    }
}

/**
 * Add/remove a highlight class on TipTap content nodes that overlap with drawing clusters.
 * Uses direct DOM children of the editor for reliability (view.nodeDOM can return
 * unexpected wrappers for complex nodes like block embeds).
 */
function highlightDisplacedNodes(editor: Editor, clusters: DrawingCluster[], wrapperEl: HTMLElement) {
    const editorDom = editor.view.dom
    const wrapperRect = wrapperEl.getBoundingClientRect()

    const children = editorDom.children
    for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement
        if (!child || child.classList.contains('drawing-spacer')) continue

        const nodeRect = child.getBoundingClientRect()
        const nodeTop = nodeRect.top - wrapperRect.top
        const nodeBottom = nodeRect.bottom - wrapperRect.top

        const overlaps = clusters.some(c =>
            nodeBottom > c.top && nodeTop < c.bottom
        )

        if (overlaps) {
            child.classList.add('drawing-displaced')
        } else {
            child.classList.remove('drawing-displaced')
        }
    }
}
