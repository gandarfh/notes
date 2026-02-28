import { GRID_SIZE } from '../../constants'
import { useRef, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '../../store'
import type { ElementTypeCategory, ElementStyleDefaults } from '../../store/types'
import { api } from '../../bridge/wails'
import { BlockContainer } from '../Block/BlockContainer'
import { InlineEditor } from '../Drawing/InlineEditor'
import { StylePanel } from '../StylePanel/StylePanel'
import { useDrawing } from '../../hooks/useDrawing'
import { usePerfMonitor } from '../../hooks/usePerfMonitor'
import { setClearDrawingSelection, closeEditorGlobal } from '../../input/drawingBridge'

// ── Connection Layer ───────────────────────────────────────

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function ConnectionLayer({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
    const connections = useAppStore(s => s.connections)
    const blocks = useAppStore(s => s.blocks)

    useEffect(() => {
        const svg = svgRef.current
        if (!svg) return

        const viewport = useAppStore.getState().viewport

        let html = ''
        for (const conn of connections) {
            const from = blocks.get(conn.fromBlockId)
            const to = blocks.get(conn.toBlockId)
            if (!from || !to) continue

            const fx = (from.x + from.width / 2) * viewport.zoom + viewport.x
            const fy = (from.y + from.height / 2) * viewport.zoom + viewport.y
            const tx = (to.x + to.width / 2) * viewport.zoom + viewport.x
            const ty = (to.y + to.height / 2) * viewport.zoom + viewport.y

            html += `<path class="connector-path" d="M${fx},${fy} L${tx},${ty}" />`

            const angle = Math.atan2(ty - fy, tx - fx)
            const headLen = 10
            const ax1 = tx - headLen * Math.cos(angle - 0.4)
            const ay1 = ty - headLen * Math.sin(angle - 0.4)
            const ax2 = tx - headLen * Math.cos(angle + 0.4)
            const ay2 = ty - headLen * Math.sin(angle + 0.4)
            html += `<polygon class="connector-arrowhead" points="${tx},${ty} ${ax1},${ay1} ${ax2},${ay2}" />`

            if (conn.label) {
                const mx = (fx + tx) / 2, my = (fy + ty) / 2
                html += `<text x="${mx}" y="${my - 6}" fill="var(--color-text-muted)" font-size="11" text-anchor="middle" font-family="var(--font-sans)">${escapeHtml(conn.label)}</text>`
            }
        }

        svg.innerHTML = html
    }, [connections, blocks, svgRef])

    return null
}

// ── Phantom StylePanel (pre-style tools before placing) ────

const TOOL_TO_ELEMENT: Record<string, string> = {
    'rectangle': 'rectangle', 'ellipse': 'ellipse', 'diamond': 'diamond',
    'ortho-arrow': 'ortho-arrow', 'freedraw': 'freedraw', 'text': 'text',
}
const ELEMENT_TO_CAT: Record<string, ElementTypeCategory> = {
    'rectangle': 'rectangle', 'ellipse': 'ellipse', 'diamond': 'diamond',
    'ortho-arrow': 'arrow', 'freedraw': 'freedraw', 'text': 'text',
}

function PhantomStylePanel({ drawingSubTool }: { drawingSubTool: string }) {
    const elType = TOOL_TO_ELEMENT[drawingSubTool]
    const cat = elType ? ELEMENT_TO_CAT[elType] : null
    const defaults = useAppStore(s => cat ? s.styleDefaults[cat] : null)

    if (!elType || !cat || !defaults) return null

    const phantom: any = {
        id: '__phantom__', type: elType, x: 0, y: 0, width: 100, height: 100,
        ...defaults,
    }

    return (
        <StylePanel
            elements={[phantom]}
            onUpdate={(patch) => {
                useAppStore.getState().setStyleDefaults(cat, patch as Partial<ElementStyleDefaults>)
            }}
        />
    )
}

// ── Canvas ─────────────────────────────────────────────────

interface CanvasProps {
    onEditBlock: (blockId: string, lineNumber: number) => void
}


export function Canvas({ onEditBlock }: CanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const connectorSvgRef = useRef<SVGSVGElement>(null)
    const drawingSvgRef = useRef<HTMLCanvasElement>(null)
    const drawingLayerRef = useRef<HTMLDivElement>(null)
    const blockLayerRef = useRef<HTMLDivElement>(null)
    const drawingSubTool = useAppStore(s => s.drawingSubTool)

    const blocks = useAppStore(s => s.blocks)
    const selectBlock = useAppStore(s => s.selectBlock)

    const isPanningRef = useRef(false)
    const lastMouseRef = useRef({ x: 0, y: 0 })
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const viewportRef = useRef(useAppStore.getState().viewport)
    // Track block layer zoom mode: 'scale' = transform scale, 'css-zoom' = CSS zoom property
    const blockZoomModeRef = useRef<'scale' | 'css-zoom'>(useAppStore.getState().viewport.zoom > 1 ? 'css-zoom' : 'scale')
    const lastAppliedZoomRef = useRef(useAppStore.getState().viewport.zoom)
    const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)


    // ── Drawing hook ──
    const onBlockCreate = useCallback(async (type: string, x: number, y: number, w: number, h: number) => {
        const block = await useAppStore.getState().createBlock(type, x, y, w, h)
        if (block) useAppStore.getState().selectBlock(block.id)
    }, [])

    const { editorRequest, setEditorRequest, blockPreview, drawingCursor, renderDrawing, eventConsumedRef, styleSelection, updateSelectedStyle, clearDrawingSelection, reorderSelected, alignSelected, multiSelected } = useDrawing(
        drawingSvgRef,
        containerRef,
        onBlockCreate,
    )

    // Register clearDrawingSelection globally so BlockContainer can use it
    useEffect(() => {
        setClearDrawingSelection(clearDrawingSelection)
        return () => setClearDrawingSelection(null)
    }, [clearDrawingSelection])

    usePerfMonitor()

    // ── Apply viewport directly to DOM (no React re-render) ──
    const applyViewport = useCallback((v: { x: number; y: number; zoom: number }) => {
        const w = window as any
        w.__perfMark?.('applyViewport')

        // Drawing layer: always transform: scale() — canvas context handles its own resolution
        if (drawingLayerRef.current) {
            drawingLayerRef.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.zoom})`
        }

        // Block layer: deferred settle strategy
        // During active zoom gestures → always scale() for smooth GPU animation
        // After gesture settles (200ms) → switch to CSS zoom if >100% for crisp text
        if (blockLayerRef.current) {
            const zoomChanged = Math.abs(v.zoom - lastAppliedZoomRef.current) > 0.001
            lastAppliedZoomRef.current = v.zoom

            if (zoomChanged) {
                // Zoom is actively changing → use scale() for smooth animation (no layout thrash)
                blockZoomModeRef.current = 'scale'
                blockLayerRef.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.zoom})`
                blockLayerRef.current.style.setProperty('zoom', '1')

                // Schedule settle: switch to CSS zoom after gesture ends
                if (settleRef.current) clearTimeout(settleRef.current)
                if (v.zoom > 1) {
                    settleRef.current = setTimeout(() => {
                        const cur = viewportRef.current
                        if (blockLayerRef.current && cur.zoom > 1) {
                            blockLayerRef.current.style.transform = `translate3d(${cur.x / cur.zoom}px, ${cur.y / cur.zoom}px, 0)`
                            blockLayerRef.current.style.setProperty('zoom', String(cur.zoom))
                            blockZoomModeRef.current = 'css-zoom'
                        }
                        settleRef.current = null
                    }, 200)
                }
            } else {
                // Only panning (zoom unchanged) → keep current mode
                if (blockZoomModeRef.current === 'css-zoom') {
                    blockLayerRef.current.style.transform = `translate3d(${v.x / v.zoom}px, ${v.y / v.zoom}px, 0)`
                } else {
                    blockLayerRef.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.zoom})`
                }
            }
        }

        // Canvas re-render needed — canvas is not CSS-transformed, viewport is in the context
        renderDrawing(v)
        w.__perfEnd?.('applyViewport')
    }, [renderDrawing])

    // Keep viewportRef in sync with store (for external viewport changes like double-click zoom)
    useEffect(() => {
        const unsub = useAppStore.subscribe((s, prev) => {
            // Only react when viewport actually changed — ignore unrelated store updates
            // (e.g. block saves, selection) that would re-apply stale viewport values
            if (s.viewport === prev.viewport) return

            const v = s.viewport
            const cur = viewportRef.current
            // Skip if we already applied this viewport (avoids double-paint from our own commits)
            if (v.x === cur.x && v.y === cur.y && v.zoom === cur.zoom) return
            viewportRef.current = v
            applyViewport(v)
        })
        return unsub
    }, [applyViewport])

    // ── Debounced store commit (non-blocking) ──
    const commitViewport = useCallback(() => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = setTimeout(() => {
            // Always commit the LATEST viewport, not a stale captured value
            const v = viewportRef.current
            useAppStore.getState().setViewport(v.x, v.y, v.zoom)
            useAppStore.getState().saveViewport()
            saveTimeoutRef.current = null
        }, 200)
    }, [])

    // ── Pan via middle-click drag ──
    const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement
        const isOnBlock = !!target.closest('[data-role=block]')

        // Close editor on any left-click outside the currently-edited block
        if (e.button === 0) {
            const { editingBlockId } = useAppStore.getState()
            if (editingBlockId) {
                // Only close if clicking outside the editing block
                const editingEl = target.closest(`[data-block-id="${editingBlockId}"]`)
                if (!editingEl) {
                    closeEditorGlobal()
                }
            }
        }

        // Always deselect block on left-click unless clicking on a block
        if (e.button === 0 && !isOnBlock) {
            selectBlock(null)
        }

        // Always clear drawing selection when clicking on a block
        if (isOnBlock) {
            clearDrawingSelection()
        }

        // Don't initiate pan or other canvas actions if drawing consumed the event
        if (eventConsumedRef.current || isOnBlock) return

        if (e.button === 1) {
            isPanningRef.current = true
            lastMouseRef.current = { x: e.clientX, y: e.clientY }
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
            e.preventDefault()
        }
    }, [selectBlock, eventConsumedRef, clearDrawingSelection])

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!isPanningRef.current) return
            const w = window as any
            w.__perfMark?.('onMove')
            const dx = e.clientX - lastMouseRef.current.x
            const dy = e.clientY - lastMouseRef.current.y
            lastMouseRef.current = { x: e.clientX, y: e.clientY }

            const v = viewportRef.current
            const newV = { x: v.x + dx, y: v.y + dy, zoom: v.zoom }
            viewportRef.current = newV
            applyViewport(newV)
            commitViewport()
            w.__perfEnd?.('onMove')
        }

        const onUp = () => {
            if (isPanningRef.current) {
                isPanningRef.current = false
                if (containerRef.current) containerRef.current.style.cursor = ''
            }
        }

        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    }, [applyViewport, commitViewport])

    // ── Paste image from clipboard ──
    useEffect(() => {
        const onPaste = async (e: ClipboardEvent) => {
            // Don't intercept paste in text inputs
            const target = e.target as HTMLElement
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return

            const items = e.clipboardData?.items
            if (!items) return

            for (const item of Array.from(items)) {
                if (!item.type.startsWith('image/')) continue

                e.preventDefault()
                const blob = item.getAsFile()
                if (!blob) continue

                // Read blob as base64 data URL
                const dataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result as string)
                    reader.readAsDataURL(blob)
                })

                // Calculate viewport center in world coords
                const container = containerRef.current
                const v = viewportRef.current
                const cx = container ? container.clientWidth / 2 : 400
                const cy = container ? container.clientHeight / 2 : 300
                const worldX = Math.round((cx - v.x) / v.zoom / GRID_SIZE) * GRID_SIZE
                const worldY = Math.round((cy - v.y) / v.zoom / GRID_SIZE) * GRID_SIZE

                // Get image natural dimensions
                const { width: natW, height: natH } = await new Promise<{ width: number; height: number }>((resolve) => {
                    const img = new Image()
                    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
                    img.onerror = () => resolve({ width: 300, height: 200 })
                    img.src = dataUrl
                })

                // Scale to fit max 400px wide, snapped to grid
                const maxW = 400
                const scale = natW > maxW ? maxW / natW : 1
                const blockW = Math.round(natW * scale / GRID_SIZE) * GRID_SIZE || 300
                const blockH = Math.round(natH * scale / GRID_SIZE) * GRID_SIZE || 200

                // Create image block and save image as file
                const store = useAppStore.getState()
                const block = await store.createBlock('image', worldX, worldY, blockW, blockH)
                if (block) {
                    // Immediately show the image using data URL
                    store.updateBlock(block.id, { content: dataUrl })
                    store.resizeBlock(block.id, blockW, blockH)
                    store.selectBlock(block.id)

                    // Save image to disk (Go saves file, stores URL path in DB, clears content in DB)
                    try {
                        const filePath = await api.saveImageFile(block.id, dataUrl)
                        store.updateBlock(block.id, { filePath })
                    } catch (err) {
                        console.error('[PASTE] failed to save image file:', err)
                    }
                    store.saveBlockPosition(block.id)
                }
                break
            }
        }

        document.addEventListener('paste', onPaste)
        return () => document.removeEventListener('paste', onPaste)
    }, [])

    // ── Wheel: native listener ──

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const onWheel = (e: WheelEvent) => {
            // Only intercept scroll for blocks that are focused (user clicked into them)
            const target = e.target as HTMLElement
            let el: HTMLElement | null = target
            while (el && el !== container) {
                const isScrollable = el.dataset.scrollable !== undefined || (el.scrollHeight > el.clientHeight + 2 && el.style.overflowY !== 'visible')
                const isHScrollable = el.scrollWidth > el.clientWidth + 2
                if (isScrollable || isHScrollable) {
                    // Check if this block is focused (contains activeElement)
                    const blockEl = el.closest('[data-block-id]') as HTMLElement | null
                    const isFocused = blockEl ? blockEl.contains(document.activeElement) : false
                    if (isFocused) {
                        e.preventDefault()
                        // Horizontal scroll: use native deltaX from trackpad
                        if (Math.abs(e.deltaX) > 0 && isHScrollable) {
                            let hTarget: HTMLElement | null = el
                            // Walk up past cells to find the actual scroll container
                            while (hTarget && (hTarget.tagName === 'TD' || hTarget.tagName === 'TH' || hTarget.tagName === 'TR' || hTarget.tagName === 'TBODY' || hTarget.tagName === 'THEAD' || hTarget.tagName === 'TABLE')) {
                                hTarget = hTarget.parentElement
                            }
                            if (hTarget && hTarget.scrollWidth > hTarget.clientWidth + 2) {
                                hTarget.scrollLeft += e.deltaX
                            }
                        }
                        // Vertical scroll within block
                        if (Math.abs(e.deltaY) > 0 && isScrollable) {
                            const canScrollDown = e.deltaY > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 1
                            const canScrollUp = e.deltaY < 0 && el.scrollTop > 1
                            if (canScrollDown || canScrollUp) {
                                el.scrollTop += e.deltaY
                            }
                        }
                        return
                    }
                    // Block not focused → fall through to canvas zoom/pan
                    break
                }
                el = el.parentElement
            }

            e.preventDefault()
            const v = viewportRef.current

            if (e.ctrlKey) {
                // Pinch-to-zoom (macOS trackpad sets ctrlKey for pinch gestures)
                if (Math.abs(e.deltaY) < 1) return

                const rect = container.getBoundingClientRect()
                const cx = e.clientX - rect.left
                const cy = e.clientY - rect.top
                const delta = -e.deltaY * 0.005
                const newZoom = Math.min(5, Math.max(0.1, v.zoom * (1 + delta)))
                const ratio = newZoom / v.zoom
                const newV = {
                    x: cx - (cx - v.x) * ratio,
                    y: cy - (cy - v.y) * ratio,
                    zoom: newZoom,
                }
                viewportRef.current = newV
                applyViewport(newV)
                commitViewport()
            } else {
                // Two-finger scroll → Pan (standard macOS/trackpad behavior)
                const newV = {
                    x: v.x - e.deltaX,
                    y: v.y - e.deltaY,
                    zoom: v.zoom,
                }
                viewportRef.current = newV
                applyViewport(newV)
                commitViewport()
            }
        }

        container.addEventListener('wheel', onWheel, { passive: false })
        return () => container.removeEventListener('wheel', onWheel)
    }, [applyViewport, commitViewport])

    const initV = viewportRef.current
    const initDrawingTransform = `translate3d(${initV.x}px, ${initV.y}px, 0) scale(${initV.zoom})`
    // Hybrid: CSS zoom for >100%, scale for ≤100%
    const initBlockTransform = initV.zoom > 1
        ? `translate3d(${initV.x / initV.zoom}px, ${initV.y / initV.zoom}px, 0)`
        : `translate3d(${initV.x}px, ${initV.y}px, 0) scale(${initV.zoom})`
    const initBlockZoom = initV.zoom > 1 ? initV.zoom : 1
    const blockIds = useMemo(() => Array.from(blocks.keys()), [blocks])

    return (
        <div
            ref={containerRef}
            data-role="canvas-container"
            className="flex-1 relative overflow-hidden bg-app"
            style={{ cursor: isPanningRef.current ? 'grabbing' : drawingCursor, contain: 'layout style paint' }}
            onMouseDown={onCanvasMouseDown}
        >

            {/* Connectors — screen space */}
            <svg ref={connectorSvgRef} className="absolute inset-0 w-full h-full pointer-events-none z-[2]" />

            {/* Drawing canvas — direct child of container (canvas can't overflow like SVG).
                Viewport transform is applied in the canvas context instead of CSS. */}
            <canvas
                ref={drawingSvgRef}
                className="drawing-canvas absolute inset-0 z-[1]"
                style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
            />

            {/* Drawing overlay layer — INSIDE viewport transform (for inline editor) */}
            <div
                ref={drawingLayerRef}
                className="absolute inset-0 z-[1]"
                style={{ transform: initDrawingTransform, transformOrigin: '0 0', pointerEvents: 'none', willChange: 'transform', backfaceVisibility: 'hidden' as const }}
            >
                {/* Inline text editor — inside viewport transform for pixel-perfect alignment */}
                {editorRequest && (
                    <InlineEditor
                        request={editorRequest}
                        onClose={() => setEditorRequest(null)}
                    />
                )}
            </div>

            {/* Block layer — INSIDE viewport transform */}
            <div
                ref={blockLayerRef}
                id="block-layer"
                className="absolute inset-0 z-[3]"
                style={{ transform: initBlockTransform, zoom: initBlockZoom, transformOrigin: '0 0', pointerEvents: 'none', willChange: 'transform', backfaceVisibility: 'hidden' as const } as React.CSSProperties}
            >
                {blockIds.map(id => (
                    <BlockContainer key={id} blockId={id} onEditBlock={onEditBlock} />
                ))}

                {blockPreview && (
                    <div
                        className="absolute pointer-events-none z-[999] border-2 border-dashed border-accent rounded-md"
                        style={{
                            left: blockPreview.x,
                            top: blockPreview.y,
                            width: blockPreview.width,
                            height: blockPreview.height,
                            background: 'rgba(99, 102, 241, 0.06)',
                        }}
                    />
                )}
            </div>

            <ConnectionLayer svgRef={connectorSvgRef} />

            {/* Style panel for selected elements OR active draw tool (pre-style) */}
            {styleSelection.length > 0 ? (
                <StylePanel elements={styleSelection} onUpdate={updateSelectedStyle} onReorder={reorderSelected} onAlign={alignSelected} multiSelected={multiSelected} />
            ) : (
                <PhantomStylePanel drawingSubTool={drawingSubTool} />
            )}
        </div>
    )
}
