import { GRID_SIZE, DASHBOARD_COLS, DASHBOARD_ROW_HEIGHT } from '../constants'
import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '../store'
import { setDrawingKeyHandler } from '../input'
import type { ElementStyleDefaults } from '../store/types'
import { pluginBus } from '../plugins/sdk/runtime/eventBus'

import type { DrawingElement, DrawingSubTool } from '../drawing/types'
import { elementTypeCategory } from '../drawing/types'
import { getElementBounds } from '../drawing/types'
import { alignElements, reorderElements } from '../drawing/layout'
import type { DrawingContext, InteractionHandler, Point, EditorRequest, BlockPreviewRect } from '../drawing/interfaces'
import { drawSelectionUI } from '../drawing/canvasRender'
import { DrawingWorkerProxy, type RenderState } from '../drawing/drawing-worker-proxy'
import { hitTest, hitTestHandle } from '../drawing/hitTest'
import { SelectHandler } from '../drawing/handlers/select'
import { ArrowHandler } from '../drawing/handlers/arrow'
import { ShapeHandler } from '../drawing/handlers/shape'
import { FreedrawHandler } from '../drawing/handlers/freedraw'
import { TextHandler } from '../drawing/handlers/text'
import { BlockHandler, type BlockCreationCallback } from '../drawing/handlers/block'
import { genId } from '../drawing/types'
import { updateConnectedArrows } from '../drawing/connections'
import { getDrawingEngine } from '../drawing/drawing-wasm'
import { setOnBlockMoved } from '../input/drawingBridge'

// Eagerly load WASM engine on main thread so ortho routing can use Dijkstra
getDrawingEngine().catch(() => { /* WASM load failure is non-fatal */ })


/**
 * useDrawing — React hook that replaces CanvasDrawing class.
 * All state is in Zustand or refs. Zero DOM manipulation.
 */
interface UseDrawingOptions {
    /** Override blockRects (e.g. return empty in document mode where blocks are TipTap embeds) */
    blockRectsOverride?: () => Array<{ id: string; x: number; y: number; width: number; height: number }>
}

export function useDrawing(
    svgRef: React.RefObject<HTMLCanvasElement | null>,
    overlayRef: React.RefObject<HTMLCanvasElement | null>,
    containerRef: React.RefObject<HTMLElement | null>,
    onBlockCreate: BlockCreationCallback,
    options?: UseDrawingOptions,
) {
    // ── Local state (transient, not in store) ──
    const currentElementRef = useRef<DrawingElement | null>(null)
    const elementsRef = useRef<DrawingElement[]>([])
    const selectedElementRef = useRef<DrawingElement | null>(null)
    const selectedElementsRef = useRef<Set<string>>(new Set())
    const clipboardRef = useRef<DrawingElement[]>([])
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const rafRef = useRef<number | null>(null)
    const drawingDataLoadedRef = useRef('')
    const lastClickTimeRef = useRef(0)
    const lastClickPosRef = useRef({ x: 0, y: 0 })
    const highlightedElementsRef = useRef<Set<string>>(new Set())
    // Tracks whether a pointer interaction is in progress (drag, draw, resize)
    const isInteractingRef = useRef(false)

    /**
     * Flag set by native mousedown listener BEFORE React handlers fire.
     * Canvas checks this to know if drawing consumed the event (no pan).
     */
    const eventConsumedRef = useRef(false)

    // Ref for immediate worker sync — avoids stale closure in RAF callback
    const editingElementIdRef = useRef<string | null>(null)

    // ── React state for overlays ──
    const [editorRequest, setEditorRequest] = useState<EditorRequest | null>(null)
    const [blockPreview, setBlockPreview] = useState<BlockPreviewRect | null>(null)
    const [drawingCursor, setDrawingCursor] = useState('default')

    // ── Handlers (registered once) ──
    const handlersRef = useRef<Map<DrawingSubTool, InteractionHandler>>(new Map())
    const activeHandlerRef = useRef<InteractionHandler | null>(null)

    // Initialize handlers
    useEffect(() => {
        const selectHandler = new SelectHandler()
        handlersRef.current = new Map<DrawingSubTool, InteractionHandler>([
            ['draw-select', selectHandler],
            ['block', new BlockHandler(onBlockCreate)],
            ['db-block', new BlockHandler(onBlockCreate, 'database', 600, 450)],
            ['code-block', new BlockHandler(onBlockCreate, 'code', 500, 350)],
            ['localdb-block', new BlockHandler(onBlockCreate, 'localdb', 700, 450)],
            ['chart-block', new BlockHandler(onBlockCreate, 'chart', 500, 350)],
            ['etl-block', new BlockHandler(onBlockCreate, 'etl', 420, 280)],
            ['http-block', new BlockHandler(onBlockCreate, 'http', 520, 400)],
            ['ortho-arrow', new ArrowHandler()],
            ['rectangle', new ShapeHandler('rectangle')],
            ['ellipse', new ShapeHandler('ellipse')],
            ['diamond', new ShapeHandler('diamond')],
            ['group', new ShapeHandler('group')],
            ['freedraw', new FreedrawHandler()],
            ['text', new TextHandler()],
        ])
        activeHandlerRef.current = selectHandler
    }, [onBlockCreate])

    // ── Helpers ──
    const snap = useCallback((v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE, [])

    const getWorldCoords = useCallback((sx: number, sy: number): Point => {
        const container = containerRef.current
        if (!container) return { x: sx, y: sy }
        const v = useAppStore.getState().viewport
        const rect = container.getBoundingClientRect()
        return {
            x: (sx - rect.left - v.x) / v.zoom,
            y: (sy - rect.top - v.y) / v.zoom,
        }
    }, [containerRef])

    const getScreenCoords = useCallback((wx: number, wy: number): Point => {
        const v = useAppStore.getState().viewport
        return { x: wx * v.zoom + v.x, y: wy * v.zoom + v.y }
    }, [])

    const getZoom = useCallback(() => useAppStore.getState().viewport.zoom, [])

    // ── Canvas2D Render State ──
    // Worker proxy — handles all element rendering in a Web Worker thread
    const workerProxyRef = useRef<DrawingWorkerProxy | null>(null)
    // Live viewport ref — updated on every applyViewport call (store is only committed on mouseUp)
    const liveViewportRef = useRef(useAppStore.getState().viewport)
    // Viewport at which the canvas was last rendered (for CSS compensation of Worker latency)
    const renderedViewportRef = useRef(useAppStore.getState().viewport)

    // Initialize worker when canvas is ready
    useEffect(() => {
        const canvas = svgRef.current
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) return
        if (workerProxyRef.current) return // already initialized

        try {
            const proxy = new DrawingWorkerProxy(canvas)
            proxy.onFrame = (vp) => {
                renderedViewportRef.current = vp
                // Recalculate CSS compensation immediately so stale offset doesn't persist.
                // Only compensate pure pan (zoom unchanged) — zoom compensation would
                // misalign rasterized content without also scaling.
                const v = liveViewportRef.current
                const zoomUnchanged = Math.abs(v.zoom - vp.zoom) < 0.001
                const dx = v.x - vp.x
                const dy = v.y - vp.y
                const needsCompensation = zoomUnchanged && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
                const transform = needsCompensation ? `translate3d(${dx}px, ${dy}px, 0)` : ''
                if (svgRef.current) (svgRef.current as HTMLCanvasElement).style.transform = transform
                if (overlayRef.current) (overlayRef.current as HTMLCanvasElement).style.transform = transform
            }
            workerProxyRef.current = proxy
        } catch (e) {
            console.warn('OffscreenCanvas not supported, falling back to main thread rendering')
        }

        return () => {
            workerProxyRef.current?.dispose()
            workerProxyRef.current = null
        }
    }, [svgRef])

    // ── Render ──
    const render = useCallback((viewport?: { x: number; y: number; zoom: number }) => {
        // Store the latest viewport for the RAF callback
        if (viewport) liveViewportRef.current = viewport
        if (rafRef.current !== null) return  // already scheduled
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null

            const sketchy = useAppStore.getState().boardStyle === 'sketchy'
            const dpr = window.devicePixelRatio || 1
            const vp = liveViewportRef.current
            const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' as const : 'dark' as const

            // ── 1. Worker: element rendering ──
            const workerProxy = workerProxyRef.current
            if (workerProxy) {
                const canvas = svgRef.current
                if (canvas) {
                    const cw = Math.round(canvas.clientWidth * dpr)
                    const ch = Math.round(canvas.clientHeight * dpr)

                    const cs = getComputedStyle(document.documentElement)
                    const state: RenderState = {
                        elements: elementsRef.current,
                        viewport: vp,
                        selectedId: selectedElementRef.current?.id ?? null,
                        multiSelectedIds: Array.from(selectedElementsRef.current),
                        currentElement: currentElementRef.current,
                        highlightedIds: Array.from(highlightedElementsRef.current),
                        sketchy,
                        canvasWidth: cw,
                        canvasHeight: ch,
                        dpr,
                        theme,
                        canvasBg: cs.getPropertyValue('--color-app').trim(),
                        defaultStroke: cs.getPropertyValue('--color-text-primary').trim(),
                        highlightColor: cs.getPropertyValue('--color-error').trim(),
                        editingElementId: editingElementIdRef.current,
                    }
                    workerProxy.requestRender(state)
                }
            }

            // ── 2. Overlay canvas: selection UI + handler overlay (main thread, no WASM) ──
            const overlayCanvas = overlayRef.current
            if (overlayCanvas && overlayCanvas instanceof HTMLCanvasElement) {
                const oCw = Math.round(overlayCanvas.clientWidth * dpr)
                const oCh = Math.round(overlayCanvas.clientHeight * dpr)
                if (overlayCanvas.width !== oCw || overlayCanvas.height !== oCh) {
                    overlayCanvas.width = oCw
                    overlayCanvas.height = oCh
                }
                const oCtx = overlayCanvas.getContext('2d')
                if (oCtx) {
                    oCtx.setTransform(1, 0, 0, 1, 0, 0)
                    oCtx.clearRect(0, 0, oCw, oCh)
                    oCtx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, vp.x * dpr, vp.y * dpr)

                    // Selection UI
                    const selected = selectedElementRef.current
                    const multiSelected = selectedElementsRef.current
                    if (selected && multiSelected.size <= 1) {
                        drawSelectionUI(oCtx, selected)
                    }
                    // Unified multi-selection bounding box (shapes + blocks)
                    {
                        const { selectedIds, blocks } = useAppStore.getState()
                        const totalSelected = selectedIds.size
                        if (totalSelected > 1) {
                            // Get live drag delta from SelectHandler (if group-dragging)
                            const selectHandler = handlersRef.current.get('draw-select') as import('../drawing/handlers/select').SelectHandler | undefined
                            const dragDelta = selectHandler?.getGroupDragDelta?.()
                            const dragIds = selectHandler?.getGroupDragIds?.() ?? new Set<string>()

                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
                            let count = 0
                            // Include selected drawing shapes (positions already live in refs)
                            for (const el of elementsRef.current) {
                                if (multiSelected.has(el.id)) {
                                    const b = getElementBounds(el)
                                    minX = Math.min(minX, b.x)
                                    minY = Math.min(minY, b.y)
                                    maxX = Math.max(maxX, b.x + b.w)
                                    maxY = Math.max(maxY, b.y + b.h)
                                    count++
                                }
                            }
                            // Include selected blocks (apply drag delta for live position)
                            for (const id of selectedIds) {
                                const block = blocks.get(id)
                                if (block) {
                                    const dx = (dragDelta && dragIds.has(id)) ? dragDelta.x : 0
                                    const dy = (dragDelta && dragIds.has(id)) ? dragDelta.y : 0
                                    minX = Math.min(minX, block.x + dx)
                                    minY = Math.min(minY, block.y + dy)
                                    maxX = Math.max(maxX, block.x + block.width + dx)
                                    maxY = Math.max(maxY, block.y + block.height + dy)
                                    count++
                                }
                            }
                            if (count > 0) {
                                const pad = 6
                                oCtx.strokeStyle = '#6366f1'
                                oCtx.lineWidth = 1
                                oCtx.setLineDash([4, 3])
                                oCtx.beginPath()
                                oCtx.roundRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 3)
                                oCtx.stroke()
                                oCtx.setLineDash([])
                            }
                        }
                    }

                    // Handler overlay (anchors, box select, etc.)
                    const handler = activeHandlerRef.current
                    if (handler?.renderOverlay) {
                        handler.renderOverlay(buildContext(), oCtx)
                    }
                }
            }

            // ── 3. Lightweight store sync (no DB persist) for live spacer updates ──
            // Only runs during active interactions (drag/draw/resize) to avoid
            // overwriting store data on cold renders (initial load).
            // No debounce — runs every RAF for immediate highlight feedback.
            if (isInteractingRef.current) {
                const data = JSON.stringify(elementsRef.current)
                if (data !== drawingDataLoadedRef.current) {
                    drawingDataLoadedRef.current = data
                    useAppStore.getState().setDrawingData(data)
                }
            }
        })
    }, [svgRef, overlayRef])

    // ── Save (debounced) ──
    const saveNow = useCallback(() => {
        if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null }
        const data = JSON.stringify(elementsRef.current)
        drawingDataLoadedRef.current = data
        useAppStore.getState().setDrawingData(data)
        useAppStore.getState().saveDrawingData()
    }, [])

    const save = useCallback(() => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = setTimeout(() => {
            saveNow()
            saveTimeoutRef.current = null
        }, 300)
    }, [saveNow])

    const closeEditor = useCallback(() => {
        editingElementIdRef.current = null
        setEditorRequest(null)
        render()
    }, [render])

    // ── Build DrawingContext ──
    const buildContext = useCallback((): DrawingContext => ({
        get elements() { return elementsRef.current },
        set elements(v) { elementsRef.current = v },
        get selectedElement() { return selectedElementRef.current },
        set selectedElement(v) { selectedElementRef.current = v },
        get currentElement() { return currentElementRef.current },
        set currentElement(v) { currentElementRef.current = v },
        get selectedElements() { return selectedElementsRef.current },
        set selectedElements(v) { selectedElementsRef.current = v },
        get clipboard() { return clipboardRef.current },
        set clipboard(v) { clipboardRef.current = v },
        get blockRects() {
            if (options?.blockRectsOverride) return options.blockRectsOverride()
            const blocks = useAppStore.getState().blocks
            const rects: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
            for (const b of blocks.values()) {
                rects.push({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height })
            }
            return rects
        },
        snap,
        grid: () => GRID_SIZE,
        setSubTool: (tool: DrawingSubTool) => {
            const oldHandler = activeHandlerRef.current
            if (oldHandler?.deactivate) oldHandler.deactivate(buildContext())
            activeHandlerRef.current = handlersRef.current.get(tool) ?? activeHandlerRef.current
            useAppStore.getState().setDrawingSubTool(tool)
            // Set cursor based on tool
            const toolCursors: Record<string, string> = {
                'draw-select': 'default', 'block': 'crosshair', 'db-block': 'crosshair', 'code-block': 'crosshair', 'localdb-block': 'crosshair', 'chart-block': 'crosshair', 'etl-block': 'crosshair', 'http-block': 'crosshair',
                'rectangle': 'crosshair', 'ellipse': 'crosshair', 'diamond': 'crosshair', 'group': 'crosshair',
                'ortho-arrow': 'crosshair', 'freedraw': 'crosshair', 'text': 'text',
            }
            setDrawingCursor(toolCursors[tool] || 'default')
            render()
        },
        render,
        save,
        saveNow,
        showEditor: (request: EditorRequest) => {
            editingElementIdRef.current = request.elementId ?? null
            setEditorRequest(request)
            render()
        },
        isEditing: editorRequest !== null,
        isSketchy: useAppStore.getState().boardStyle === 'sketchy',
        getScreenCoords,
        getZoom,
        setBlockPreview: (rect) => setBlockPreview(rect),
        setCursor: (cursor) => setDrawingCursor(cursor),
        getDefaults: (type) => {
            const cat = elementTypeCategory(type)
            return useAppStore.getState().getStyleDefaults(cat)
        },
        setDefaults: (type, patch) => {
            const cat = elementTypeCategory(type)
            useAppStore.getState().setStyleDefaults(cat, patch)
        },
        getSelectedBlockIds: () => {
            const { selectedIds, blocks } = useAppStore.getState()
            const result: string[] = []
            for (const id of selectedIds) {
                if (blocks.has(id)) result.push(id)
            }
            console.log(`[getSelectedBlockIds] selectedIds=[${[...selectedIds]}] blocks.size=${blocks.size} result=[${result}]`)
            return result
        },
        onCanvasConnectionCreated: (fromEntityId, toEntityId) => {
            useAppStore.getState().createCanvasConnection(fromEntityId, toEntityId)
        },
        getDashboardGrid: () => {
            const store = useAppStore.getState()
            if (store.activePageType !== 'board') return null
            return { colW: store.canvasContainerWidth / DASHBOARD_COLS, rowH: DASHBOARD_ROW_HEIGHT }
        },
        onMoveBlocks: (moves) => {
            const store = useAppStore.getState()
            // In board mode, RGL controls block positions — skip block moves
            const isDash = store.activePageType === 'board'
            for (const { id, x, y } of moves) {
                if (isDash) continue
                store.moveBlock(id, x, y)
                store.saveBlockPosition(id)
                // Update connected arrows
                const blockRects: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
                for (const b of store.blocks.values()) {
                    blockRects.push({ id: b.id, x: b.id === id ? x : b.x, y: b.id === id ? y : b.y, width: b.width, height: b.height })
                }
                updateConnectedArrows(elementsRef.current, id, blockRects)
            }
            render()
            save()
        },
        onDeleteBlocks: (ids) => {
            const store = useAppStore.getState()
            for (const id of ids) store.deleteBlock(id)
        },
        onSelectEntities: (ids) => {
            console.log(`[onSelectEntities] ids=[${ids}]`)
            useAppStore.getState().selectMultiple(ids)
            console.log(`[onSelectEntities] store.selectedIds=[${[...useAppStore.getState().selectedIds]}]`)
        },
    }), [snap, render, save, getScreenCoords, getZoom, editorRequest, saveNow])

    // ── Sync subtool from store ──
    const drawingSubTool = useAppStore(s => s.drawingSubTool)
    useEffect(() => {
        const handler = handlersRef.current.get(drawingSubTool)
        if (handler && handler !== activeHandlerRef.current) {
            const old = activeHandlerRef.current
            if (old?.deactivate) old.deactivate(buildContext())
            activeHandlerRef.current = handler
            render()
        }
    }, [drawingSubTool, buildContext, render])

    // ── Highlight elements pending approval (red glow on canvas) ──
    const highlightIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        const startPulse = () => {
            if (highlightIntervalRef.current) return
            highlightIntervalRef.current = setInterval(() => render(), 33) // ~30fps pulse
        }

        const stopPulse = () => {
            if (highlightIntervalRef.current) {
                clearInterval(highlightIntervalRef.current)
                highlightIntervalRef.current = null
            }
        }

        const unsubRequired = pluginBus.on('mcp:approval-required', (data: any) => {
            try {
                const meta = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata
                if (meta?.elementIds?.length) {
                    for (const id of meta.elementIds) {
                        highlightedElementsRef.current.add(id)
                    }
                    startPulse()
                }
            } catch { /* ignore parse errors */ }
        })

        const clearHighlights = () => {
            if (highlightedElementsRef.current.size > 0) {
                highlightedElementsRef.current.clear()
                stopPulse()
                render()
            }
        }

        const unsubDismissed = pluginBus.on('mcp:approval-dismissed', clearHighlights)

        return () => {
            unsubRequired()
            unsubDismissed()
            stopPulse()
        }
    }, [render])

    // ── Load drawing data when store changes (page switch) ──
    const drawingData = useAppStore(s => s.drawingData)
    useEffect(() => {
        // Only reload if drawingData actually changed from an external source (page switch)
        // Skip if it matches what we last saved (to avoid overwriting in-memory changes)
        if (drawingData === drawingDataLoadedRef.current) return
        // Never overwrite in-memory elements during active interaction (drag/draw/resize).
        // The store may receive stale data from spacer sync or other side effects.
        if (isInteractingRef.current) {
            drawingDataLoadedRef.current = drawingData
            return
        }
        // Cancel any pending debounced save from the previous page
        if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null }
        drawingDataLoadedRef.current = drawingData
        try {
            const parsed = drawingData ? JSON.parse(drawingData) : []
            elementsRef.current = Array.isArray(parsed) ? parsed : []
        } catch {
            elementsRef.current = []
        }
        selectedElementRef.current = null
        currentElementRef.current = null
        selectedElementsRef.current.clear()
        // Invalidate proxy cache — force full sync for new page
        workerProxyRef.current?.invalidate()
        render()
    }, [drawingData])

    // ── Resize observer — re-render canvas immediately when container size changes ──
    // Without this, CSS stretches the stale pixel buffer until the next render() call.
    useEffect(() => {
        const canvas = svgRef.current
        if (!canvas) return
        const ro = new ResizeObserver(() => render())
        ro.observe(canvas)
        const onThemeChange = () => render()
        window.addEventListener('theme-change', onThemeChange)
        return () => { ro.disconnect(); window.removeEventListener('theme-change', onThemeChange) }
    }, [svgRef, render])

    // NOTE: Drawing canvas is a direct child of the container.

    // ── Event listeners on container ──
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const onPointerDown = (e: PointerEvent) => {
            // Reset consumed flag — Canvas checks this before panning
            eventConsumedRef.current = false

            // Don't handle drawing interactions while editing a block (terminal active)
            if (useAppStore.getState().editingBlockId) return

            // Only handle left mouse button (0) for drawing interactions
            if (e.button !== 0) return

            // Don't handle events on the style panel
            const target = e.target as HTMLElement
            if (target.closest('.style-panel')) return

            // In board mode, don't handle events on RGL elements (resize handles, grid items)
            // — RGL manages its own drag/resize interactions
            if (useAppStore.getState().activePageType === 'board') {
                if (target.closest('.react-grid-item') || target.closest('.react-resizable-handle')) return
            }

            // Don't handle events on blocks UNLESS it's a block in a multi-selection
            // (the block lets the event propagate so SelectHandler can handle group drag)
            const blockEl = target.closest('[data-role=block]')
            if (blockEl) {
                const { selectedIds } = useAppStore.getState()
                const clickedBlockId = (blockEl as HTMLElement).dataset.blockId
                const isInMultiSelection = selectedIds.size > 1 && clickedBlockId && selectedIds.has(clickedBlockId)
                console.log(`[Layer3 MOUSE] click on block=${clickedBlockId} selectedIds=[${[...selectedIds]}] isInMulti=${isInMultiSelection}`)
                if (!isInMultiSelection) return
            }

            // Mark as consumed so Canvas doesn't also handle this left-click
            eventConsumedRef.current = true

            // Capture pointer so all subsequent move/up events come to the container,
            // even when cursor is over a block or outside the window (critical for box-select)
            container.setPointerCapture(e.pointerId)

            const world = getWorldCoords(e.clientX, e.clientY)
            const ctx = buildContext()
            const currentSubTool = useAppStore.getState().drawingSubTool

            // Double-click detection
            const now = Date.now()
            const timeDelta = now - lastClickTimeRef.current
            const distDelta = Math.hypot(world.x - lastClickPosRef.current.x, world.y - lastClickPosRef.current.y)
            const isDoubleClick = timeDelta < 500 && distDelta < 15
            lastClickTimeRef.current = now
            lastClickPosRef.current = { x: world.x, y: world.y }

            if (editorRequest) return

            if (isDoubleClick) {
                eventConsumedRef.current = true
                activeHandlerRef.current?.onDoubleClick?.(ctx, world)
                return
            }

            // Pass shift key to select handler for multi-selection
            if (currentSubTool === 'draw-select') {
                const handler = activeHandlerRef.current
                if (handler && 'setShiftKey' in handler) {
                    (handler as unknown as { setShiftKey: (v: boolean) => void }).setShiftKey(e.shiftKey)
                }
            }

            activeHandlerRef.current?.onMouseDown(ctx, world)
            isInteractingRef.current = true
        }

        const onPointerMove = (e: PointerEvent) => {
            // When pointer is NOT captured: skip events over blocks (let them handle their own interactions)
            if (!container.hasPointerCapture(e.pointerId)) {
                let el: HTMLElement | null = e.target as HTMLElement
                for (let i = 0; i < 4 && el && el !== container; i++) {
                    if (el.dataset.role === 'block') return
                    el = el.parentElement
                }
            }

            const world = getWorldCoords(e.clientX, e.clientY)
            activeHandlerRef.current?.onMouseMove(buildContext(), world)
        }

        const onPointerUp = (e: PointerEvent) => {
            isInteractingRef.current = false
            if (container.hasPointerCapture(e.pointerId)) {
                container.releasePointerCapture(e.pointerId)
            }
            activeHandlerRef.current?.onMouseUp(buildContext())
        }

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault()
            const world = getWorldCoords(e.clientX, e.clientY)
            activeHandlerRef.current?.onRightClick?.(buildContext(), world)
        }

        // Register drawing keyboard handler with InputManager (Layer 3)
        const unregisterKeys = setDrawingKeyHandler((e: KeyboardEvent) => {
            if (editorRequest) return false

            const ctx = buildContext()
            const _debugKey = e.key
            const _debugShapes = [...ctx.selectedElements]
            const _debugBlocks = ctx.getSelectedBlockIds()
            const _debugTool = useAppStore.getState().drawingSubTool
            const _debugHandler = activeHandlerRef.current?.constructor?.name ?? 'unknown'

            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Backspace'].includes(_debugKey)) {
                console.log(`[Layer3 KEY] key=${_debugKey} tool=${_debugTool} handler=${_debugHandler} shapes=[${_debugShapes}] blocks=[${_debugBlocks}] selectedIds=[${[...useAppStore.getState().selectedIds]}]`)
            }

            // Let active handler try first (e.g. SelectHandler: Ctrl+C/V/D/A, Delete)
            if (activeHandlerRef.current?.onKeyDown?.(ctx, e)) {
                console.log(`[Layer3 KEY] → consumed by active handler (${_debugHandler})`)
                return true
            }

            // Fallback: if active handler is NOT SelectHandler, try SelectHandler
            // for unified keys (arrow nudge, delete) that work across all tools
            const selectHandler = handlersRef.current.get('draw-select')
            if (selectHandler && activeHandlerRef.current !== selectHandler) {
                console.log(`[Layer3 KEY] → trying SelectHandler fallback`)
                if (selectHandler.onKeyDown?.(ctx, e)) {
                    console.log(`[Layer3 KEY] → consumed by SelectHandler fallback`)
                    return true
                }
            }

            // Global drawing shortcuts (skip if shift or meta/ctrl is held)
            // Keys 'd' and 'l' conflict with block layer (delete / nav-right),
            // so yield them when a block is selected. Other tool-switch keys
            // (m, t, c, 1-6) don't conflict and always work.
            const mod = e.ctrlKey || e.metaKey
            const blockSelected = !!useAppStore.getState().selectedBlockId
            if (!e.shiftKey && !mod) switch (e.key.toLowerCase()) {
                case '1': ctx.setSubTool('draw-select'); return true
                case '2': ctx.setSubTool('rectangle'); return true
                case '3': ctx.setSubTool('ellipse'); return true
                case '4': ctx.setSubTool('diamond'); return true
                case '5': ctx.setSubTool('ortho-arrow'); return true
                case '6': ctx.setSubTool('freedraw'); return true
                case 't': ctx.setSubTool('text'); return true
                case 'm': ctx.setSubTool('block'); return true
                case 'c': ctx.setSubTool('code-block'); return true
                // 'd' and 'l' conflict with block layer — skip when a block is selected
                case 'd': if (!blockSelected) { ctx.setSubTool('db-block'); return true } break
                case 'l': if (!blockSelected) { ctx.setSubTool('localdb-block'); return true } break
                case 'g': ctx.setSubTool('group'); return true
            }
            switch (e.key.toLowerCase()) {
                case 'delete': case 'backspace':
                    // Handled by SelectHandler (active or fallback above)
                    return false
                case 'escape': {
                    // Unified escape: clear everything
                    const hadDrawing = !!selectedElementRef.current || selectedElementsRef.current.size > 0
                    const hadBlock = !!useAppStore.getState().selectedBlockId || useAppStore.getState().selectedIds.size > 0
                    selectedElementRef.current = null
                    selectedElementsRef.current.clear()
                    useAppStore.getState().selectBlock(null)
                    useAppStore.getState().clearSelection()
                    if (hadDrawing || hadBlock) {
                        render()
                        ctx.setSubTool('draw-select')
                        return true
                    }
                    ctx.setSubTool('draw-select')
                    return true
                }
            }
            return false
        })

        container.addEventListener('pointerdown', onPointerDown)
        container.addEventListener('pointermove', onPointerMove)
        container.addEventListener('pointerup', onPointerUp)
        container.addEventListener('contextmenu', onContextMenu)

        return () => {
            container.removeEventListener('pointerdown', onPointerDown)
            container.removeEventListener('pointermove', onPointerMove)
            container.removeEventListener('pointerup', onPointerUp)
            container.removeEventListener('contextmenu', onContextMenu)
            unregisterKeys()
        }
    }, [containerRef, getWorldCoords, buildContext, editorRequest, render])

    // ── Delete selected ──
    const deleteSelected = useCallback(() => {
        if (!selectedElementRef.current) return
        const id = selectedElementRef.current.id
        elementsRef.current = elementsRef.current.filter(el => el.id !== id)
        for (const el of elementsRef.current) {
            if (el.startConnection?.elementId === id) el.startConnection = undefined
            if (el.endConnection?.elementId === id) el.endConnection = undefined
        }
        selectedElementRef.current = null
        render(); save()
    }, [render, save])

    // ── Flush pending save ──
    const flushSave = useCallback(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current)
            saveTimeoutRef.current = null
            const data = JSON.stringify(elementsRef.current)
            useAppStore.getState().setDrawingData(data)
            useAppStore.getState().saveDrawingData()
        }
    }, [])



    // ── Re-render on board style change ──
    const boardStyle = useAppStore(s => s.boardStyle)
    useEffect(() => { render() }, [boardStyle, render])

    // ── Selection state for StylePanel ──
    const [styleSelection, setStyleSelection] = useState<DrawingElement[]>([])
    const renderVersionRef = useRef(0)
    // Sync selection state after each render (low overhead — runs post-render)
    useEffect(() => {
        const interval = setInterval(() => {
            const currVersion = renderVersionRef.current
            // Build current selection list
            const sel: DrawingElement[] = []
            if (selectedElementsRef.current.size > 0) {
                for (const el of elementsRef.current) {
                    if (selectedElementsRef.current.has(el.id)) sel.push(el)
                }
            } else if (selectedElementRef.current) {
                sel.push(selectedElementRef.current)
            }
            // Only update state if selection changed
            const prevIds = styleSelection.map(e => e.id).join(',')
            const newIds = sel.map(e => e.id).join(',')
            if (prevIds !== newIds || currVersion !== renderVersionRef.current) {
                setStyleSelection(sel)
                // Sync drawing selection → unified selectionSlice
                // Preserve any block IDs already in the store — this interval
                // only knows about drawing shapes, not DOM blocks.
                const { selectedIds: storeIds, blocks } = useAppStore.getState()
                const shapeIds = sel.map(e => e.id)
                const blockIdsInStore: string[] = []
                for (const id of storeIds) {
                    if (blocks.has(id)) blockIdsInStore.push(id)
                }
                const mergedIds = [...shapeIds, ...blockIdsInStore]
                const same = mergedIds.length === storeIds.size && mergedIds.every(id => storeIds.has(id))
                if (!same) {
                    if (mergedIds.length > 0) {
                        useAppStore.getState().selectMultiple(mergedIds)
                    } else if (storeIds.size > 0 && !useAppStore.getState().selectedBlockId) {
                        useAppStore.getState().clearSelection()
                    }
                }
            }
        }, 100)
        return () => clearInterval(interval)
    }, [styleSelection])

    // Called by StylePanel to apply a style patch to selected elements
    const updateSelectedStyle = useCallback((patch: Partial<DrawingElement>) => {
        const ids = selectedElementsRef.current.size > 0
            ? selectedElementsRef.current
            : selectedElementRef.current ? new Set([selectedElementRef.current.id]) : new Set<string>()
        if (ids.size === 0) return
        const affectedTypes = new Set<string>()
        for (const el of elementsRef.current) {
            if (!ids.has(el.id)) continue
            Object.assign(el, patch)
            affectedTypes.add(el.type)
        }
        render(); save()
        // Persist as per-type defaults
        for (const t of affectedTypes) {
            const cat = elementTypeCategory(t)
            useAppStore.getState().setStyleDefaults(cat, patch as Partial<ElementStyleDefaults>)
        }
        // Update style selection state immediately
        setStyleSelection(elementsRef.current.filter(e => ids.has(e.id)))
    }, [render, save])

    // Clear drawing selection — called by Canvas when clicking on empty space or blocks
    const clearDrawingSelection = useCallback(() => {
        if (selectedElementRef.current || selectedElementsRef.current.size > 0) {
            selectedElementRef.current = null
            selectedElementsRef.current.clear()
            render()
            // Sync: remove drawing shapes from unified selection, but preserve block IDs
            const { selectedIds, blocks, selectedBlockId } = useAppStore.getState()
            const blockIdsToKeep: string[] = []
            for (const id of selectedIds) {
                if (blocks.has(id)) blockIdsToKeep.push(id)
            }
            if (blockIdsToKeep.length > 0) {
                useAppStore.getState().selectMultiple(blockIdsToKeep)
            } else if (!selectedBlockId) {
                useAppStore.getState().clearSelection()
            }
        }
    }, [render])

    // Reorder selected elements in the layer stack
    const reorderSelected = useCallback((action: 'toBack' | 'backward' | 'forward' | 'toFront') => {
        const ids = selectedElementsRef.current.size > 0
            ? selectedElementsRef.current
            : selectedElementRef.current ? new Set([selectedElementRef.current.id]) : new Set<string>()
        if (ids.size === 0) return

        elementsRef.current = reorderElements(elementsRef.current, ids, action)
        render(); save()

        // Sync: persist z-order to entity store
        const orderedIDs = elementsRef.current.map(el => el.id)
        useAppStore.getState().updateEntityZOrder(orderedIDs)
    }, [render, save])

    // Align/distribute selected elements
    const alignSelected = useCallback((action: string) => {
        if (selectedElementsRef.current.size < 2) return
        const ids = selectedElementsRef.current
        const selected = elementsRef.current.filter(e => ids.has(e.id))
        if (selected.length < 2) return

        alignElements(selected, action)
        render(); save()
        setStyleSelection(elementsRef.current.filter(e => ids.has(e.id)))
    }, [render, save])

    // Register block-moved bridge so arrows connected to blocks update when blocks are dragged
    useEffect(() => {
        setOnBlockMoved((blockId: string, liveX?: number, liveY?: number) => {
            const blockRects: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
            for (const b of useAppStore.getState().blocks.values()) {
                // Use live position for the moving block (DOM is ahead of store during drag)
                if (b.id === blockId && liveX !== undefined && liveY !== undefined) {
                    blockRects.push({ id: b.id, x: liveX, y: liveY, width: b.width, height: b.height })
                } else {
                    blockRects.push({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height })
                }
            }
            updateConnectedArrows(elementsRef.current, blockId, blockRects)
            render()
            // Only save on final position (not during drag) — caller passes liveX during drag
            if (liveX === undefined) save()
        })
        return () => setOnBlockMoved(null)
    }, [render, save])

    const multiSelected = selectedElementsRef.current.size > 1

    return {
        editorRequest,
        setEditorRequest,
        closeEditor,
        blockPreview,
        drawingCursor,
        flushSave,
        /** Trigger a canvas re-render (call on viewport pan/zoom changes) */
        renderDrawing: render,
        /** True if the drawing layer consumed the last mousedown. Check before panning. */
        eventConsumedRef,
        /** Currently selected drawing elements (for StylePanel) */
        styleSelection,
        /** Apply style changes to selected elements */
        updateSelectedStyle,
        /** Clear any drawing selection (for click-to-deselect) */
        clearDrawingSelection,
        /** Reorder selected elements in layer stack */
        reorderSelected,
        /** Align/distribute selected elements */
        alignSelected,
        /** True when multiple elements are selected (box select) */
        multiSelected,
        /** Viewport at which the canvas was last rendered (for CSS compensation) */
        renderedViewportRef,
    }
}
