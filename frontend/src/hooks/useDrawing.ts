import { GRID_SIZE } from '../constants'
import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '../store'
import { setDrawingKeyHandler } from '../input'
import type { ElementTypeCategory, ElementStyleDefaults } from '../store/types'
import { pluginBus } from '../plugins/sdk/runtime/eventBus'

// Map any element type string to its style default category
function elementTypeCategory(type: string): ElementTypeCategory {
    switch (type) {
        case 'rectangle': return 'rectangle'
        case 'ellipse': return 'ellipse'
        case 'diamond': return 'diamond'
        case 'arrow': case 'ortho-arrow': case 'line': return 'arrow'
        case 'text': return 'text'
        case 'freedraw': return 'freedraw'
        default: return 'rectangle'
    }
}
import type { DrawingElement, DrawingSubTool } from '../drawing/types'
import { getElementBounds } from '../drawing/types'
import type { DrawingContext, InteractionHandler, Point, EditorRequest, BlockPreviewRect } from '../drawing/interfaces'
import { drawElement, drawSelectionUI } from '../drawing/canvasRender'
import { hitTest } from '../drawing/hitTest'
import { SelectHandler } from '../drawing/handlers/select'
import { ArrowHandler } from '../drawing/handlers/arrow'
import { ShapeHandler } from '../drawing/handlers/shape'
import { FreedrawHandler } from '../drawing/handlers/freedraw'
import { TextHandler } from '../drawing/handlers/text'
import { BlockHandler, type BlockCreationCallback } from '../drawing/handlers/block'
import { genId } from '../drawing/types'


/**
 * useDrawing — React hook that replaces CanvasDrawing class.
 * All state is in Zustand or refs. Zero DOM manipulation.
 */
export function useDrawing(
    svgRef: React.RefObject<HTMLCanvasElement | null>,
    containerRef: React.RefObject<HTMLElement | null>,
    onBlockCreate: BlockCreationCallback,
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

    /**
     * Flag set by native mousedown listener BEFORE React handlers fire.
     * Canvas checks this to know if drawing consumed the event (no pan).
     */
    const eventConsumedRef = useRef(false)

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
    // Each element's content is cached on an offscreen canvas.
    // During drag, we just blit the cached canvas at the new position.
    // Content re-renders only when element properties change.
    const elCanvasMapRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
    const elHashMapRef = useRef<Map<string, number>>(new Map())
    const lastBoardStyleRef = useRef('')
    // Live viewport ref — updated on every applyViewport call (store is only committed on mouseUp)
    const liveViewportRef = useRef(useAppStore.getState().viewport)

    /** Fast numeric fingerprint of all rendering-relevant properties (excludes x, y) */
    function fastHash(el: DrawingElement, extra: number): number {
        let h = (el.width * 7 + el.height * 13 + el.strokeWidth * 17 + extra) | 0
        h = (h * 31 + (el.opacity ?? 1) * 100 + (el.borderRadius ?? 0) * 11 + (el.fontSize ?? 14) * 19) | 0
        h = (h * 31 + (el.fontWeight ?? 400) + (el.roundness ? 23 : 0)) | 0
        h = (h * 31 + Math.round((el.labelT ?? 0.5) * 100)) | 0
        const cc = (s: string | undefined) => { if (!s) return 0; let v = s.length; for (let i = 0; i < Math.min(s.length, 8); i++) v = (v * 31 + s.charCodeAt(i)) | 0; return v }
        h = (h * 31 + cc(el.strokeColor) + cc(el.backgroundColor) * 3 + cc(el.textColor) * 5) | 0
        h = (h * 31 + cc(el.fillStyle) + cc(el.strokeDasharray) + cc(el.text) * 7 + cc(el.label) * 11) | 0
        h = (h * 31 + cc(el.fontFamily) + cc(el.textAlign) + cc(el.verticalAlign)) | 0
        h = (h * 31 + cc(el.arrowEnd) + cc(el.arrowStart)) | 0
        if (el.points && el.points.length > 0) {
            h = (h * 31 + el.points.length * 1000) | 0
            h = (h * 31 + (el.points[0][0] * 7 + el.points[0][1] * 13) | 0) | 0
            const last = el.points[el.points.length - 1]
            h = (h * 31 + (last[0] * 7 + last[1] * 13) | 0) | 0
        }
        return h
    }

    // ── Render Canvas2D ──
    const render = useCallback((viewport?: { x: number; y: number; zoom: number }) => {
        // Store the latest viewport for the RAF callback
        if (viewport) liveViewportRef.current = viewport
        if (rafRef.current !== null) return  // already scheduled
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            const canvas = svgRef.current as unknown as HTMLCanvasElement
            if (!canvas || !(canvas instanceof HTMLCanvasElement)) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return

            const sketchy = useAppStore.getState().boardStyle === 'sketchy'
            const boardStyleKey = sketchy ? 's' : 'n'

            // If board style changed, invalidate all element caches
            if (lastBoardStyleRef.current !== boardStyleKey) {
                lastBoardStyleRef.current = boardStyleKey
                elHashMapRef.current.clear()
                elCanvasMapRef.current.clear()
            }

            // Resize canvas to match layout size × devicePixelRatio
            // Use clientWidth (not getBoundingClientRect) to avoid CSS transform interference
            const dpr = window.devicePixelRatio || 1
            const cw = Math.round(canvas.clientWidth * dpr)
            const ch = Math.round(canvas.clientHeight * dpr)
            if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw
                canvas.height = ch
            }

            // Clear canvas
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, cw, ch)

            // Apply viewport transform: DPR → pan → zoom
            // Uses live viewport ref (updated on every pan frame, not just store commits)
            const vp = liveViewportRef.current
            ctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, vp.x * dpr, vp.y * dpr)

            // 1. Draw elements
            const elements = [...elementsRef.current]
            if (currentElementRef.current) elements.push(currentElementRef.current)

            const selected = selectedElementRef.current
            const multiSelected = selectedElementsRef.current

            for (const el of elements) {
                const isEditingThis = editorRequest?.elementId === el.id
                drawElement(ctx, el, selected?.id === el.id || multiSelected.has(el.id), isEditingThis, sketchy)

                // Draw red glow for elements pending deletion
                if (highlightedElementsRef.current.has(el.id)) {
                    ctx.save()
                    ctx.strokeStyle = '#ef4444'
                    ctx.lineWidth = 3
                    ctx.shadowColor = '#ef4444'
                    ctx.shadowBlur = 12
                    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(Date.now() / 300)
                    const b = getElementBounds(el)
                    const pad = 6
                    ctx.beginPath()
                    ctx.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 8)
                    ctx.stroke()
                    ctx.restore()
                }
            }

            // 2. Selection UI
            if (selected && multiSelected.size <= 1) {
                drawSelectionUI(ctx, selected)
            }
            if (multiSelected.size > 1) {
                const selEls = elements.filter(e => multiSelected.has(e.id))
                if (selEls.length > 0) {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
                    for (const el of selEls) {
                        const b = getElementBounds(el)
                        minX = Math.min(minX, b.x)
                        minY = Math.min(minY, b.y)
                        maxX = Math.max(maxX, b.x + b.w)
                        maxY = Math.max(maxY, b.y + b.h)
                    }
                    const pad = 6
                    ctx.strokeStyle = '#6366f1'
                    ctx.lineWidth = 1
                    ctx.setLineDash([4, 3])
                    ctx.beginPath()
                    ctx.roundRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 3)
                    ctx.stroke()
                    ctx.setLineDash([])
                }
            }

            // 3. Handler overlay (anchors, box select, etc.)
            const handler = activeHandlerRef.current
            if (handler?.renderOverlay) {
                handler.renderOverlay(buildContext(), ctx)
            }
        })
    }, [svgRef, editorRequest])

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
                'rectangle': 'crosshair', 'ellipse': 'crosshair', 'diamond': 'crosshair',
                'ortho-arrow': 'crosshair', 'freedraw': 'crosshair', 'text': 'text',
            }
            setDrawingCursor(toolCursors[tool] || 'default')
            render()
        },
        render,
        save,
        saveNow,
        showEditor: (request: EditorRequest) => setEditorRequest(request),
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
    }), [snap, render, save, getScreenCoords, getZoom, editorRequest])

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
        // Clear canvas render cache for the new page
        elCanvasMapRef.current.clear()
        elHashMapRef.current.clear()
        render()
    }, [drawingData])

    // ── Resize observer — re-render canvas immediately when container size changes ──
    // Without this, CSS stretches the stale pixel buffer until the next render() call.
    useEffect(() => {
        const canvas = svgRef.current
        if (!canvas) return
        const ro = new ResizeObserver(() => render())
        ro.observe(canvas)
        return () => ro.disconnect()
    }, [svgRef, render])

    // NOTE: Drawing canvas is a direct child of the container.

    // ── Event listeners on container ──
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const onMouseDown = (e: MouseEvent) => {
            // Reset consumed flag — Canvas checks this before panning
            eventConsumedRef.current = false

            // Don't handle drawing interactions while editing a block (terminal active)
            if (useAppStore.getState().editingBlockId) return

            // Only handle left mouse button (0) for drawing interactions
            if (e.button !== 0) return

            // Don't handle events on blocks or the style panel
            const target = e.target as HTMLElement
            if (target.closest('[data-role=block]') || target.closest('.style-panel')) return

            // Mark as consumed so Canvas doesn't also handle this left-click
            eventConsumedRef.current = true

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
        }

        const onMouseMove = (e: MouseEvent) => {
            // Fast check: is cursor over a block? Walk up max 3 levels instead of full closest()
            let el: HTMLElement | null = e.target as HTMLElement
            for (let i = 0; i < 4 && el && el !== container; i++) {
                if (el.dataset.role === 'block') return
                el = el.parentElement
            }

            const world = getWorldCoords(e.clientX, e.clientY)
            activeHandlerRef.current?.onMouseMove(buildContext(), world)
        }

        const onMouseUp = () => {
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

            // Let active handler try first (e.g. SelectHandler: Ctrl+C/V/D/A, Delete)
            if (activeHandlerRef.current?.onKeyDown?.(ctx, e)) {
                return true
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
            }
            switch (e.key.toLowerCase()) {
                case 'delete': case 'backspace':
                    // Only consume if there's a drawing selection, otherwise fall through to block layer
                    if (selectedElementRef.current || selectedElementsRef.current.size > 0) {
                        deleteSelected(); return true
                    }
                    return false
                case 'escape':
                    if (selectedElementRef.current) {
                        selectedElementRef.current = null
                        selectedElementsRef.current.clear()
                        render()
                        ctx.setSubTool('draw-select')
                        return true
                    }
                    // No drawing selection — let block layer handle Escape (deselect block)
                    if (blockSelected) return false
                    ctx.setSubTool('draw-select')
                    return true
            }
            return false
        })

        container.addEventListener('mousedown', onMouseDown)
        container.addEventListener('mousemove', onMouseMove)
        container.addEventListener('mouseup', onMouseUp)
        container.addEventListener('contextmenu', onContextMenu)

        return () => {
            container.removeEventListener('mousedown', onMouseDown)
            container.removeEventListener('mousemove', onMouseMove)
            container.removeEventListener('mouseup', onMouseUp)
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
        }
    }, [render])

    // Reorder selected elements in the layer stack
    const reorderSelected = useCallback((action: 'toBack' | 'backward' | 'forward' | 'toFront') => {
        const ids = selectedElementsRef.current.size > 0
            ? selectedElementsRef.current
            : selectedElementRef.current ? new Set([selectedElementRef.current.id]) : new Set<string>()
        if (ids.size === 0) return

        const arr = elementsRef.current
        const selected = arr.filter(e => ids.has(e.id))
        const rest = arr.filter(e => !ids.has(e.id))

        switch (action) {
            case 'toBack':
                elementsRef.current = [...selected, ...rest]
                break
            case 'toFront':
                elementsRef.current = [...rest, ...selected]
                break
            case 'backward': {
                // Move each selected element one step back
                for (const el of selected) {
                    const idx = elementsRef.current.indexOf(el)
                    if (idx > 0 && !ids.has(elementsRef.current[idx - 1].id)) {
                        ;[elementsRef.current[idx - 1], elementsRef.current[idx]] =
                            [elementsRef.current[idx], elementsRef.current[idx - 1]]
                    }
                }
                break
            }
            case 'forward': {
                // Move each selected element one step forward (iterate reverse)
                for (let i = selected.length - 1; i >= 0; i--) {
                    const idx = elementsRef.current.indexOf(selected[i])
                    if (idx < elementsRef.current.length - 1 && !ids.has(elementsRef.current[idx + 1].id)) {
                        ;[elementsRef.current[idx], elementsRef.current[idx + 1]] =
                            [elementsRef.current[idx + 1], elementsRef.current[idx]]
                    }
                }
                break
            }
        }
        render(); save()
    }, [render, save])

    // Align/distribute selected elements
    const alignSelected = useCallback((action: string) => {
        if (selectedElementsRef.current.size < 2) return
        const ids = selectedElementsRef.current
        const selected = elementsRef.current.filter(e => ids.has(e.id))
        if (selected.length < 2) return

        // Compute bounds
        const bounds = selected.map(e => {
            const b = getElementBounds(e)
            return { el: e, x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }
        })

        switch (action) {
            case 'align-left': {
                const minX = Math.min(...bounds.map(b => b.x))
                bounds.forEach(b => { b.el.x += minX - b.x })
                break
            }
            case 'align-center-h': {
                const avg = bounds.reduce((s, b) => s + b.cx, 0) / bounds.length
                bounds.forEach(b => { b.el.x += avg - b.cx })
                break
            }
            case 'align-right': {
                const maxR = Math.max(...bounds.map(b => b.x + b.w))
                bounds.forEach(b => { b.el.x += maxR - (b.x + b.w) })
                break
            }
            case 'align-top': {
                const minY = Math.min(...bounds.map(b => b.y))
                bounds.forEach(b => { b.el.y += minY - b.y })
                break
            }
            case 'align-center-v': {
                const avg = bounds.reduce((s, b) => s + b.cy, 0) / bounds.length
                bounds.forEach(b => { b.el.y += avg - b.cy })
                break
            }
            case 'align-bottom': {
                const maxB = Math.max(...bounds.map(b => b.y + b.h))
                bounds.forEach(b => { b.el.y += maxB - (b.y + b.h) })
                break
            }
            case 'distribute-h': {
                if (bounds.length < 3) break
                bounds.sort((a, b) => a.x - b.x)
                const totalWidth = bounds.reduce((s, b) => s + b.w, 0)
                const containerW = bounds[bounds.length - 1].x + bounds[bounds.length - 1].w - bounds[0].x
                const gap = (containerW - totalWidth) / (bounds.length - 1)
                let cx = bounds[0].x + bounds[0].w
                for (let i = 1; i < bounds.length - 1; i++) {
                    bounds[i].el.x = cx + gap
                    cx = bounds[i].el.x + bounds[i].w
                }
                break
            }
            case 'distribute-v': {
                if (bounds.length < 3) break
                bounds.sort((a, b) => a.y - b.y)
                const totalHeight = bounds.reduce((s, b) => s + b.h, 0)
                const containerH = bounds[bounds.length - 1].y + bounds[bounds.length - 1].h - bounds[0].y
                const gap = (containerH - totalHeight) / (bounds.length - 1)
                let cy = bounds[0].y + bounds[0].h
                for (let i = 1; i < bounds.length - 1; i++) {
                    bounds[i].el.y = cy + gap
                    cy = bounds[i].el.y + bounds[i].h
                }
                break
            }
        }
        render(); save()
        setStyleSelection(elementsRef.current.filter(e => ids.has(e.id)))
    }, [render, save])

    const multiSelected = selectedElementsRef.current.size > 1

    return {
        editorRequest,
        setEditorRequest,
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
    }
}
