import { useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store'
import { useDrawing } from '../../hooks/useDrawing'
import { InlineEditor } from '../Drawing/InlineEditor'
import { StylePanel } from '../StylePanel/StylePanel'
import { setClearDrawingSelection } from '../../input/drawingBridge'
import type { Editor } from '@tiptap/react'
import type { DrawingElement } from '../../drawing/types'
import { getElementBounds } from '../../drawing/types'

interface Props {
    editor: Editor | null
    children: React.ReactNode
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
 */
function computeClusters(elements: DrawingElement[], gap = 20): DrawingCluster[] {
    if (elements.length === 0) return []

    const boxes = elements.map(el => {
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
            clusters.push({
                id: `cluster-${clusters.length}`,
                top: current.top,
                bottom: current.bottom,
                height: current.bottom - current.top,
            })
            current = { top: boxes[i].top, bottom: boxes[i].bottom }
        }
    }

    clusters.push({
        id: `cluster-${clusters.length}`,
        top: current.top,
        bottom: current.bottom,
        height: current.bottom - current.top,
    })

    return clusters
}

export function DocumentDrawingLayer({ editor, children }: Props) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const drawingSvgRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawingLayerRef = useRef<HTMLDivElement>(null)

    const drawingSubTool = useAppStore(s => s.drawingSubTool)
    const drawingData = useAppStore(s => s.drawingData)

    const isDrawingToolActive = drawingSubTool !== 'draw-select'

    const onBlockCreate = useCallback(async () => {}, [])

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
        drawingSvgRef,
        overlayCanvasRef,
        wrapperRef,
        onBlockCreate,
    )

    // Suppress unused variable warning — eventConsumedRef is used by the drawing layer
    void eventConsumedRef

    // Register clearDrawingSelection globally
    useEffect(() => {
        setClearDrawingSelection(clearDrawingSelection)
        return () => setClearDrawingSelection(null)
    }, [clearDrawingSelection])

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

            if (drawingSvgRef.current) {
                drawingSvgRef.current.style.height = `${height}px`
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

    // Sync spacers when drawing data changes
    useEffect(() => {
        if (!editor) return
        if (!drawingData) return

        let elements: DrawingElement[] = []
        try {
            elements = JSON.parse(drawingData)
        } catch { return }

        if (elements.length === 0) return

        const clusters = computeClusters(elements)
        syncSpacers(editor, clusters)
    }, [editor, drawingData])

    return (
        <div
            ref={wrapperRef}
            className={`doc-drawing-wrapper ${isDrawingToolActive ? 'drawing-active' : ''}`}
            style={{ cursor: isDrawingToolActive ? 'crosshair' : undefined }}
        >
            {children}

            <canvas
                ref={drawingSvgRef}
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
 * Synchronize drawing spacer nodes in the TipTap editor with computed clusters.
 */
function syncSpacers(editor: Editor, clusters: DrawingCluster[]) {
    const { state } = editor
    const { doc } = state

    const existingSpacers: { pos: number; node: any; spacerId: string }[] = []
    doc.descendants((node, pos) => {
        if (node.type.name === 'drawingSpacer') {
            existingSpacers.push({ pos, node, spacerId: node.attrs.spacerId })
        }
    })

    const existingIds = new Set(existingSpacers.map(s => s.spacerId))
    const clusterIds = new Set(clusters.map(c => c.id))

    let tr = state.tr

    // Remove orphan spacers (reverse order to preserve positions)
    const toRemove = existingSpacers
        .filter(s => !clusterIds.has(s.spacerId))
        .reverse()

    for (const spacer of toRemove) {
        tr = tr.delete(spacer.pos, spacer.pos + spacer.node.nodeSize)
    }

    // Update existing spacers' height
    for (const spacer of existingSpacers) {
        if (!clusterIds.has(spacer.spacerId)) continue
        const cluster = clusters.find(c => c.id === spacer.spacerId)
        if (!cluster) continue
        if (spacer.node.attrs.height !== Math.round(cluster.height)) {
            tr = tr.setNodeMarkup(tr.mapping.map(spacer.pos), undefined, {
                ...spacer.node.attrs,
                height: Math.round(cluster.height),
            })
        }
    }

    // Insert new spacers
    const newClusters = clusters.filter(c => !existingIds.has(c.id))
    for (const cluster of newClusters) {
        const spacerNode = editor.schema.nodes.drawingSpacer.create({
            spacerId: cluster.id,
            height: Math.round(cluster.height),
        })
        const endPos = tr.doc.content.size
        tr = tr.insert(endPos, spacerNode)
    }

    if (tr.docChanged) {
        editor.view.dispatch(tr)
    }
}
