import { GRID_SIZE, DASHBOARD_COLS, DASHBOARD_ROW_HEIGHT, DASHBOARD_GAP } from '../../constants'
import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import type { ElementTypeCategory, ElementStyleDefaults } from '../../store/types'
import { api } from '../../bridge/wails'
import { BlockContainer } from '../Block/BlockContainer'
import { InlineEditor } from '../Drawing/InlineEditor'
import { StylePanel } from '../StylePanel/StylePanel'
import { useDrawing } from '../../hooks/useDrawing'
import { usePerfMonitor } from '../../hooks/usePerfMonitor'
import { setClearDrawingSelection, closeEditorGlobal } from '../../input/drawingBridge'
import { nextPosition, dashboardSnap } from '../../layout/dashboardLayout'
import type { Rect } from '../../layout/dashboardLayout'
import { toLayoutItem, layoutToPixelUpdates, GridUnitCache } from '../../layout/gridConvert'
import { ReactGridLayout, verticalCompactor } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

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

// ── Module-level cache: grid units survive component unmount ──
const gridUnitCache = new GridUnitCache()

// ── Canvas ─────────────────────────────────────────────────

interface CanvasProps {
    onEditBlock: (blockId: string, lineNumber: number) => void
}


export function Canvas({ onEditBlock }: CanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const connectorSvgRef = useRef<SVGSVGElement>(null)
    const drawingSvgRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawingLayerRef = useRef<HTMLDivElement>(null)
    const blockLayerRef = useRef<HTMLDivElement>(null)
    const drawingSubTool = useAppStore(s => s.drawingSubTool)

    const blocks = useAppStore(s => s.blocks)
    const selectBlock = useAppStore(s => s.selectBlock)
    const activePageType = useAppStore(s => s.activePageType)
    const canvasContainerWidth = useAppStore(s => s.canvasContainerWidth)

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
        const store = useAppStore.getState()
        let finalX = x, finalY = y, finalW = w, finalH = h

        if (store.activePageType === 'board') {
            const containerEl = containerRef.current
            const measuredW = containerEl ? containerEl.getBoundingClientRect().width : store.canvasContainerWidth
            const colW = measuredW / DASHBOARD_COLS
            const snapped = dashboardSnap(x, y, w, h, colW)
            finalW = snapped.w
            finalH = snapped.h

            // Collect existing block rects
            const existing: Rect[] = []
            for (const b of store.blocks.values()) {
                existing.push({ x: b.x, y: b.y, w: b.width, h: b.height })
            }

            const pos = nextPosition(existing, finalW, finalH, colW)
            finalX = pos.x
            finalY = pos.y
        }

        const block = await store.createBlock(type, finalX, finalY, finalW, finalH, 'dashboard')
        if (block) {
            store.selectBlock(block.id)
        }
    }, [])

    const { editorRequest, closeEditor, blockPreview, drawingCursor, renderDrawing, eventConsumedRef, styleSelection, updateSelectedStyle, clearDrawingSelection, reorderSelected, alignSelected, multiSelected, renderedViewportRef } = useDrawing(
        drawingSvgRef,
        overlayCanvasRef,
        containerRef,
        onBlockCreate,
    )

    // Register clearDrawingSelection globally so BlockContainer can use it
    useEffect(() => {
        setClearDrawingSelection(clearDrawingSelection)
        return () => setClearDrawingSelection(null)
    }, [clearDrawingSelection])

    // ── Track container width for dashboard grid snapping ──
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const obs = new ResizeObserver(entries => {
            const w = entries[0]?.contentRect.width
            if (w && w > 0) useAppStore.getState().setCanvasContainerWidth(w)
        })
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    const isDashboard = activePageType === 'board'

    usePerfMonitor()

    // ── Apply viewport directly to DOM (no React re-render) ──
    const applyViewport = useCallback((v: { x: number; y: number; zoom: number }) => {
        // In board mode, viewport is locked — skip all transforms
        if (useAppStore.getState().activePageType === 'board') {
            renderDrawing({ x: 0, y: 0, zoom: 1 })
            return
        }

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

        // CSS compensation: shift stale canvas image to match block layer position
        // until the Worker delivers a fresh frame. Only applies during pure pan
        // (zoom unchanged) — during zoom, translate-only compensation would misalign
        // the rasterized content, causing visible flicker.
        const rv = renderedViewportRef.current
        const zoomUnchanged = Math.abs(v.zoom - rv.zoom) < 0.001
        const dx = v.x - rv.x
        const dy = v.y - rv.y
        const needsCompensation = zoomUnchanged && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
        const canvasTransform = needsCompensation ? `translate3d(${dx}px, ${dy}px, 0)` : ''
        if (drawingSvgRef.current) {
            drawingSvgRef.current.style.transform = canvasTransform
        }
        if (overlayCanvasRef.current) {
            overlayCanvasRef.current.style.transform = canvasTransform
        }

        // Canvas re-render needed — Worker applies viewport via Canvas2D context
        renderDrawing(v)
        w.__perfEnd?.('applyViewport')
    }, [renderDrawing, renderedViewportRef])

    // ── Lock viewport on entering board mode ──
    useEffect(() => {
        if (!isDashboard) return
        const v = { x: 0, y: 0, zoom: 1 }
        viewportRef.current = v
        const store = useAppStore.getState()
        store.setViewport(0, 0, 1)
    }, [isDashboard])

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

        // Deselect block on left-click outside blocks — but ONLY if the drawing
        // layer didn't consume the event (it manages unified selectedIds itself)
        if (e.button === 0 && !isOnBlock && !eventConsumedRef.current) {
            selectBlock(null)
        }

        // Clear drawing selection when clicking on a block (unless drawing consumed it,
        // which means it's a multi-selection group drag from the drawing layer)
        if (isOnBlock && !eventConsumedRef.current) {
            clearDrawingSelection()
        }

        // Don't initiate pan or other canvas actions if drawing consumed the event
        if (eventConsumedRef.current || isOnBlock) return

        if (e.button === 1 && !isDashboard) {
            isPanningRef.current = true
            lastMouseRef.current = { x: e.clientX, y: e.clientY }
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
            e.preventDefault()
        }
    }, [selectBlock, eventConsumedRef, clearDrawingSelection, isDashboard])

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
                const block = await store.createBlock('image', worldX, worldY, blockW, blockH, 'dashboard')
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

            // In board mode, let native scroll handle vertical scrolling
            const isDash = useAppStore.getState().activePageType === 'board'
            if (isDash) return // native scroll-y handles it

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
    const initDrawingTransform = isDashboard ? 'none' : `translate3d(${initV.x}px, ${initV.y}px, 0) scale(${initV.zoom})`
    // Hybrid: CSS zoom for >100%, scale for ≤100%
    const initBlockTransform = isDashboard
        ? 'none'
        : initV.zoom > 1
            ? `translate3d(${initV.x / initV.zoom}px, ${initV.y / initV.zoom}px, 0)`
            : `translate3d(${initV.x}px, ${initV.y}px, 0) scale(${initV.zoom})`
    const initBlockZoom = isDashboard ? 1 : initV.zoom > 1 ? initV.zoom : 1
    // ── Viewport culling: only render blocks near the viewport ──
    const CULL_MARGIN = 1500 // px margin around viewport in world coords
    const cullVersionRef = useRef(0)
    const [cullVersion, setCullVersion] = useState(0)
    const cullRegionRef = useRef(() => {
        const v = viewportRef.current
        const w = window.innerWidth
        const h = window.innerHeight
        const z = v.zoom || 1
        return { left: -v.x / z - CULL_MARGIN, top: -v.y / z - CULL_MARGIN, right: -v.x / z + w / z + CULL_MARGIN, bottom: -v.y / z + h / z + CULL_MARGIN }
    })

    // Recompute cull region from current viewport (no state object — just bump version)
    const refreshCullRegion = useCallback(() => {
        const v = viewportRef.current
        const w = window.innerWidth
        const h = window.innerHeight
        const z = v.zoom || 1
        const compute = () => ({ left: -v.x / z - CULL_MARGIN, top: -v.y / z - CULL_MARGIN, right: -v.x / z + w / z + CULL_MARGIN, bottom: -v.y / z + h / z + CULL_MARGIN })
        cullRegionRef.current = compute
        cullVersionRef.current += 1
        setCullVersion(cullVersionRef.current)
    }, [CULL_MARGIN])

    // Poll viewport changes — only trigger React re-render when blocks might enter/leave
    useEffect(() => {
        if (isDashboard) return
        let lastLeft = 0, lastTop = 0
        const id = setInterval(() => {
            const v = viewportRef.current
            const z = v.zoom || 1
            const newLeft = -v.x / z
            const newTop = -v.y / z
            const threshold = Math.min(window.innerWidth, window.innerHeight) / (z * 2)
            if (Math.abs(newLeft - lastLeft) > threshold || Math.abs(newTop - lastTop) > threshold) {
                lastLeft = newLeft
                lastTop = newTop
                refreshCullRegion()
            }
        }, 300)
        return () => clearInterval(id)
    }, [isDashboard, refreshCullRegion])

    // Refresh on page switch (blocks change)
    useEffect(() => { refreshCullRegion() }, [blocks, refreshCullRegion])

    const blockIds = useMemo(() => {
        if (isDashboard) {
            return Array.from(blocks.values())
                .filter(b => b.viewMode === 'dashboard')
                .map(b => b.id)
        }
        // Canvas mode: viewport culling
        void cullVersion // dependency trigger
        const region = cullRegionRef.current()
        const all = Array.from(blocks.values())
        return all.filter(b =>
            b.x + b.width > region.left &&
            b.x < region.right &&
            b.y + b.height > region.top &&
            b.y < region.bottom
        ).map(b => b.id)
    }, [blocks, isDashboard, cullVersion])

    // ── RGL layout for board mode ──
    // Grid units are cached in a module-level Map (survives component unmount).
    // Only recompute from pixels when a block has no cached entry (new block).
    // colW is NOT a dependency — container resizes don't cause rounding drift.
    const colW = canvasContainerWidth / DASHBOARD_COLS

    const rglLayout = useMemo(() => {
        if (!isDashboard) return []
        const cw = useAppStore.getState().canvasContainerWidth / DASHBOARD_COLS
        return gridUnitCache.buildLayout(
            blockIds,
            id => blocks.get(id),
            cw,
            DASHBOARD_ROW_HEIGHT,
        )
    }, [isDashboard, blockIds, blocks])

    const handleLayoutChange = useCallback((layout: readonly import('react-grid-layout').LayoutItem[]) => {
        if (!isDashboard) return

        // Update cache with RGL's authoritative grid units
        gridUnitCache.updateFromLayout(layout)

        // Persist to store in pixels using current colW
        const currentColW = useAppStore.getState().canvasContainerWidth / DASHBOARD_COLS
        if (currentColW <= 0) return
        const pixelUpdates = layoutToPixelUpdates(layout, currentColW, DASHBOARD_ROW_HEIGHT)
        const store = useAppStore.getState()
        for (const [id, pos] of pixelUpdates) {
            const block = store.blocks.get(id)
            if (!block) continue
            const moved = block.x !== pos.x || block.y !== pos.y
            const resized = block.width !== pos.width || block.height !== pos.height
            if (moved) store.moveBlock(id, pos.x, pos.y)
            if (resized) store.resizeBlock(id, pos.width, pos.height)
            if (moved || resized) store.saveBlockPosition(id)
        }
    }, [isDashboard])

    return (
        <div
            ref={containerRef}
            data-role="canvas-container"
            className={`flex-1 relative bg-app ${isDashboard ? 'overflow-x-hidden overflow-y-auto' : 'overflow-hidden'}`}
            style={{ cursor: isPanningRef.current ? 'grabbing' : drawingCursor, contain: isDashboard ? undefined : 'layout style paint' }}
            onMouseDown={onCanvasMouseDown}
        >

            {/* Connectors — screen space */}
            <svg ref={connectorSvgRef} className="absolute inset-0 w-full h-full pointer-events-none z-[2]" />

            {/* Drawing canvas — transferred to Web Worker via OffscreenCanvas.
                Worker handles all element rendering (WASM). */}
            <canvas
                ref={drawingSvgRef}
                className="drawing-canvas absolute inset-0 z-[1]"
                style={{ width: '100%', height: '100%', pointerEvents: 'none', willChange: 'transform', transformOrigin: '0 0' }}
            />

            {/* Overlay canvas — stays on main thread for selection UI + handler overlays.
                No WASM calls, just lightweight Canvas2D (handles, box select, anchors). */}
            {/* Overlay canvas — above blocks (z-[4]) for selection UI visibility.
                pointer-events:none so it doesn't interfere with block interactions. */}
            <canvas
                ref={overlayCanvasRef}
                className="drawing-overlay absolute inset-0 z-[4]"
                style={{ width: '100%', height: '100%', pointerEvents: 'none', willChange: 'transform', transformOrigin: '0 0' }}
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
                        onClose={closeEditor}
                    />
                )}
            </div>

            {/* Board mode: RGL-managed block layer */}
            {isDashboard && colW > 0 && (
                <div className="z-[3] relative" style={{ pointerEvents: 'auto' }}>
                    <ReactGridLayout
                        width={canvasContainerWidth}
                        layout={rglLayout}
                        gridConfig={{ cols: DASHBOARD_COLS, rowHeight: DASHBOARD_ROW_HEIGHT, margin: [DASHBOARD_GAP, DASHBOARD_GAP] as readonly [number, number] }}
                        dragConfig={{ enabled: true, handle: '.block-header' }}
                        resizeConfig={{ enabled: true, handles: ['se'] as const }}
                        compactor={verticalCompactor}
                        autoSize={true}
                        onLayoutChange={handleLayoutChange}
                    >
                        {blockIds.map(id => (
                            <div key={id}>
                                <BlockContainer blockId={id} onEditBlock={onEditBlock} />
                            </div>
                        ))}
                    </ReactGridLayout>
                </div>
            )}

            {/* Canvas mode: free-positioned block layer */}
            {!isDashboard && (
                <div
                    ref={blockLayerRef}
                    id="block-layer"
                    className="z-[3] absolute inset-0"
                    style={{
                        transform: initBlockTransform,
                        zoom: initBlockZoom,
                        transformOrigin: '0 0',
                        pointerEvents: 'none',
                        willChange: 'transform',
                        backfaceVisibility: 'hidden' as const,
                    } as React.CSSProperties}
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
            )}

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
