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

/**
 * Groups drawing elements into vertical clusters.
 * Elements within `gap` pixels of each other vertically are merged.
 * Cluster IDs are derived from spatial position for stability.
 */
function computeClusters(elements: DrawingElement[], gap = 20): DrawingCluster[] {
    // Exclude arrows from clustering — their waypoints span between shapes
    // and would merge separate groups into one giant cluster
    const shapes = elements.filter(el => !isArrowType(el))
    if (shapes.length === 0) return []

    const boxes = shapes.map(el => {
        const bounds = getElementBounds(el)
        return { top: bounds.y, bottom: bounds.y + bounds.h }
    })

    boxes.sort((a, b) => a.top - b.top)

    const clusters: DrawingCluster[] = []
    let current = { top: boxes[0].top, bottom: boxes[0].bottom }

    for (let i = 1; i < boxes.length; i++) {
        if (boxes[i].top <= current.bottom + gap) {
            current.bottom = Math.max(current.bottom, boxes[i].bottom)
        } else {
            const top = current.top
            clusters.push({
                id: `cluster-y${Math.round(top)}`,
                top,
                bottom: current.bottom,
                height: current.bottom - top,
            })
            current = { top: boxes[i].top, bottom: boxes[i].bottom }
        }
    }

    const top = current.top
    clusters.push({
        id: `cluster-y${Math.round(top)}`,
        top,
        bottom: current.bottom,
        height: current.bottom - top,
    })

    return clusters
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

    // ── Step 4: Build desired spacer set ──
    if (clusters.length === 0 && spacerPositions.length === 0) return

    const sortedClusters = [...clusters].sort((a, b) => a.top - b.top)

    const desiredSpacers: { beforeOffset: number; cluster: DrawingCluster }[] = []
    for (const cluster of sortedClusters) {
        if (Math.round(cluster.height) <= 0) continue
        let targetOffset = doc.content.size
        for (const np of nodePositions) {
            if (np.bottom > cluster.top && np.top < cluster.bottom) {
                targetOffset = np.offset
                break
            }
        }
        desiredSpacers.push({ beforeOffset: targetOffset, cluster })
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
