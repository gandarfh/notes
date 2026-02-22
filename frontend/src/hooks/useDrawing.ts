import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '../store'
import { setDrawingKeyHandler } from '../input'
import type { ElementTypeCategory } from '../store/types'

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
import { renderElement, renderSelectionUI, getSketchyDefs } from '../drawing/render'
import { hitTest } from '../drawing/hitTest'
import { SelectHandler } from '../drawing/handlers/select'
import { ArrowHandler } from '../drawing/handlers/arrow'
import { ShapeHandler } from '../drawing/handlers/shape'
import { FreedrawHandler } from '../drawing/handlers/freedraw'
import { TextHandler } from '../drawing/handlers/text'
import { BlockHandler, type BlockCreationCallback } from '../drawing/handlers/block'
import { genId } from '../drawing/types'

const GRID_SIZE = 30

/**
 * useDrawing — React hook that replaces CanvasDrawing class.
 * All state is in Zustand or refs. Zero DOM manipulation.
 */
export function useDrawing(
    svgRef: React.RefObject<SVGSVGElement | null>,
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
    const drawingDataLoadedRef = useRef('')
    const lastClickTimeRef = useRef(0)
    const lastClickPosRef = useRef({ x: 0, y: 0 })

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

    // ── Render SVG ──
    const render = useCallback(() => {
        const svg = svgRef.current
        if (!svg) return

        const elements = [...elementsRef.current]
        if (currentElementRef.current) elements.push(currentElementRef.current)

        let svgContent = ''

        // Board style mode
        const sketchy = useAppStore.getState().boardStyle === 'sketchy'
        if (sketchy) svgContent += getSketchyDefs()

        // Handler overlay (anchors, previews, etc.)
        const handler = activeHandlerRef.current
        if (handler?.renderOverlay) {
            svgContent += handler.renderOverlay(buildContext()) ?? ''
        }

        const selected = selectedElementRef.current
        const multiSelected = selectedElementsRef.current

        for (const el of elements) {
            const isEditingThis = editorRequest?.elementId === el.id
            const isSel = selected?.id === el.id || multiSelected.has(el.id)
            svgContent += renderElement(el, isSel, isEditingThis, sketchy)
        }

        // Selection UI for single selected element
        if (selected && multiSelected.size <= 1) {
            svgContent += renderSelectionUI(selected)
        }

        // Multi-selection bounding box
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
                svgContent += `<rect x="${minX - pad}" y="${minY - pad}" width="${maxX - minX + pad * 2}" height="${maxY - minY + pad * 2}" fill="none" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="4 3" rx="3" />`
            }
        }

        svg.innerHTML = svgContent
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
                'draw-select': 'default', 'block': 'crosshair', 'db-block': 'crosshair',
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
        render()
    }, [drawingData])

    // NOTE: Drawing SVG is INSIDE the viewport transform layer,
    // so CSS transform handles pan/zoom visually — no re-render needed.

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

            // Global drawing shortcuts (skip if shift is held — those are different shortcuts)
            if (!e.shiftKey) switch (e.key.toLowerCase()) {
                case '1': ctx.setSubTool('draw-select'); return true
                case '2': ctx.setSubTool('rectangle'); return true
                case '3': ctx.setSubTool('ellipse'); return true
                case '4': ctx.setSubTool('diamond'); return true
                case '5': ctx.setSubTool('ortho-arrow'); return true
                case '6': ctx.setSubTool('freedraw'); return true
                case 't': ctx.setSubTool('text'); return true
                case 'm': ctx.setSubTool('block'); return true
                case 'd': ctx.setSubTool('db-block'); return true
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
                    }
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
            useAppStore.getState().setStyleDefaults(cat, patch as any)
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
