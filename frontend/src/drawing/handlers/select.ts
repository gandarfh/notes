// ── Select Handler ─────────────────────────────────────────
// Handles: element selection (single + multi), dragging, resizing,
// arrow endpoint drag, ortho-arrow segment midpoint drag,
// box-select, group move, copy/paste/duplicate.

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'
import type { DrawingElement, ResizeHandle, Connection, AnchorPoint } from '../types'
import { isArrowType, genId, getElementBounds } from '../types'
import { hitTest, hitTestHandle, hitTestArrowEndpoint, hitTestSegmentMidpoint, findNearestSegment, isPointInElement } from '../hitTest'
import { getArrowLabelPos } from '../render'
import { getAnchors, resolveAnchor, findNearestAnchor, updateConnectedArrows } from '../connections'
import { computeOrthoRoute, simplifyOrthoPoints, enforceOrthogonality } from '../ortho'

// ── Internal state (owned by this handler, not shared) ─────

interface SelectState {
    isDragging: boolean
    hasDragged: boolean
    dragOffset: Point
    isResizing: boolean
    resizeHandle: ResizeHandle | null
    resizeOrigin: { x: number; y: number; w: number; h: number }
    isDraggingEndpoint: 'start' | 'end' | null
    endpointDragOrigin: { x: number; y: number; conn: Connection | undefined } | null
    isDraggingSegment: number | null
    hoveredAnchor: AnchorPoint | null
    hoveredElement: DrawingElement | null
    // ── Multi-selection ──
    isBoxSelecting: boolean
    boxStart: Point | null
    boxEnd: Point | null
    isGroupDragging: boolean
    groupDragStart: Point | null
    groupOrigPositions: Map<string, { x: number; y: number }>
    shiftDown: boolean
    boxPreviewIds: Set<string>
    lastMouseWorld: Point
}

function createSelectState(): SelectState {
    return {
        isDragging: false,
        hasDragged: false,
        dragOffset: { x: 0, y: 0 },
        isResizing: false,
        resizeHandle: null,
        resizeOrigin: { x: 0, y: 0, w: 0, h: 0 },
        isDraggingEndpoint: null,
        endpointDragOrigin: null,
        isDraggingSegment: null,
        hoveredAnchor: null,
        hoveredElement: null,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        isGroupDragging: false,
        groupDragStart: null,
        groupOrigPositions: new Map(),
        shiftDown: false,
        boxPreviewIds: new Set(),
        lastMouseWorld: { x: 0, y: 0 },
    }
}

// ── Snap arrow preserving connections ──────────────────────

function snapArrowPreservingConnections(ctx: DrawingContext, el: DrawingElement) {
    if (!el.points || el.points.length < 2) return

    for (let i = 1; i < el.points.length - 1; i++) {
        el.points[i][0] = ctx.snap(el.points[i][0] + el.x) - el.x
        el.points[i][1] = ctx.snap(el.points[i][1] + el.y) - el.y
    }

    if (el.startConnection) {
        const pt = resolveAnchor(ctx.elements, el.startConnection)
        if (pt) {
            const dx = pt.x - el.x, dy = pt.y - el.y
            for (const p of el.points) { p[0] -= dx; p[1] -= dy }
            el.x = pt.x; el.y = pt.y
            el.points[0] = [0, 0]
        }
    } else {
        el.points[0][0] = ctx.snap(el.points[0][0] + el.x) - el.x
        el.points[0][1] = ctx.snap(el.points[0][1] + el.y) - el.y
    }

    if (el.endConnection) {
        const pt = resolveAnchor(ctx.elements, el.endConnection)
        if (pt) {
            const last = el.points[el.points.length - 1]
            last[0] = pt.x - el.x
            last[1] = pt.y - el.y
        }
    } else {
        const last = el.points[el.points.length - 1]
        last[0] = ctx.snap(last[0] + el.x) - el.x
        last[1] = ctx.snap(last[1] + el.y) - el.y
    }
}

// ── Deep clone helper ─────────────────────────────────────

function cloneElement(el: DrawingElement): DrawingElement {
    return JSON.parse(JSON.stringify(el))
}

// ── Box intersection check ────────────────────────────────

function boxIntersects(el: DrawingElement, x1: number, y1: number, x2: number, y2: number): boolean {
    const bx = Math.min(x1, x2), by = Math.min(y1, y2)
    const bw = Math.abs(x2 - x1), bh = Math.abs(y2 - y1)

    // For arrow types, check if any point is inside the box
    if (isArrowType(el) && el.points) {
        for (const p of el.points) {
            const px = el.x + p[0], py = el.y + p[1]
            if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) return true
        }
        return false
    }

    // For shapes/text: AABB overlap
    const ex = el.x, ey = el.y, ew = el.width || 0, eh = el.height || 0
    return !(ex + ew < bx || ex > bx + bw || ey + eh < by || ey > by + bh)
}

// ── SelectHandler ─────────────────────────────────────────

export class SelectHandler implements InteractionHandler {
    private s = createSelectState()
    private lastRouteTime = 0
    private readonly ROUTE_THROTTLE = 32  // ms (~30fps cap for routing)

    setShiftKey(shift: boolean) {
        this.s.shiftDown = shift
    }

    deactivate(ctx: DrawingContext) {
        this.s = createSelectState()
        ctx.selectedElement = null
        ctx.selectedElements.clear()
    }

    // ── Mouse Down ─────────────────────────────────────────

    onMouseDown(ctx: DrawingContext, world: Point) {
        // shiftDown is set by setShiftKey() before this method is called

        // Arrow endpoint handles (single-select only)
        if (ctx.selectedElement && isArrowType(ctx.selectedElement) && ctx.selectedElements.size <= 1) {
            const ep = hitTestArrowEndpoint(world.x, world.y, ctx.selectedElement)
            if (ep) {
                this.s.isDraggingEndpoint = ep
                const origConn = ep === 'start' ? ctx.selectedElement.startConnection : ctx.selectedElement.endConnection
                const pts = ctx.selectedElement.points!
                const ptIdx = ep === 'start' ? 0 : pts.length - 1
                this.s.endpointDragOrigin = {
                    x: ctx.selectedElement.x + pts[ptIdx][0],
                    y: ctx.selectedElement.y + pts[ptIdx][1],
                    conn: origConn ? { ...origConn } : undefined,
                }
                return
            }
            if (ctx.selectedElement.type === 'ortho-arrow') {
                const seg = hitTestSegmentMidpoint(world.x, world.y, ctx.selectedElement)
                if (seg !== null) {
                    this.s.isDraggingSegment = seg
                    return
                }
            }
        }

        // Resize handles (single-select only)
        if (ctx.selectedElement && ctx.selectedElements.size <= 1) {
            const handle = hitTestHandle(world.x, world.y, ctx.selectedElement)
            if (handle) {
                this.s.isResizing = true
                this.s.resizeHandle = handle
                this.s.resizeOrigin = {
                    x: ctx.selectedElement.x, y: ctx.selectedElement.y,
                    w: ctx.selectedElement.width, h: ctx.selectedElement.height,
                }
                return
            }
        }

        // Hit test elements
        const hit = hitTest(ctx.elements, world.x, world.y)

        if (hit) {
            if (this.s.shiftDown) {
                // Shift+click: toggle in multi-selection
                if (ctx.selectedElements.has(hit.id)) {
                    ctx.selectedElements.delete(hit.id)
                    if (ctx.selectedElement?.id === hit.id) {
                        ctx.selectedElement = null
                    }
                } else {
                    ctx.selectedElements.add(hit.id)
                    ctx.selectedElement = hit
                }
                ctx.render()
                return
            }

            // Click on already-selected element in multi-selection → start group drag
            if (ctx.selectedElements.has(hit.id) && ctx.selectedElements.size > 1) {
                this.startGroupDrag(ctx, world)
                return
            }

            // Normal click → select only this element
            ctx.selectedElements.clear()
            ctx.selectedElements.add(hit.id)
            ctx.selectedElement = hit

            const isConnected = isArrowType(hit) && (hit.startConnection || hit.endConnection)
            if (!isConnected) {
                this.s.isDragging = true
                this.s.hasDragged = false
                this.s.dragOffset = { x: world.x - hit.x, y: world.y - hit.y }
            }
        } else {
            if (!this.s.shiftDown) {
                // Click on empty space → clear selection and start box select
                ctx.selectedElement = null
                ctx.selectedElements.clear()
            }
            // Start box selection
            this.s.isBoxSelecting = true
            this.s.boxStart = { ...world }
            this.s.boxEnd = { ...world }
        }
        ctx.render()
    }

    // ── Mouse Move ─────────────────────────────────────────

    onMouseMove(ctx: DrawingContext, world: Point) {
        // Track mouse position for paste-at-cursor
        this.s.lastMouseWorld = { ...world }
        // Box selection
        if (this.s.isBoxSelecting && this.s.boxStart) {
            ctx.setCursor('crosshair')
            this.s.boxEnd = { ...world }
            // Compute preview: which elements are inside the box
            this.s.boxPreviewIds.clear()
            for (const el of ctx.elements) {
                if (boxIntersects(el, this.s.boxStart.x, this.s.boxStart.y, world.x, world.y)) {
                    this.s.boxPreviewIds.add(el.id)
                }
            }
            ctx.render()
            return
        }

        // Group drag
        if (this.s.isGroupDragging && this.s.groupDragStart) {
            ctx.setCursor('move')
            const dx = world.x - this.s.groupDragStart.x
            const dy = world.y - this.s.groupDragStart.y
            for (const [id, orig] of this.s.groupOrigPositions) {
                const el = ctx.elements.find(e => e.id === id)
                if (el) {
                    el.x = orig.x + dx
                    el.y = orig.y + dy
                }
            }
            ctx.render()
            return
        }

        // Update hovered anchor — show when arrow is selected or endpoint is being dragged
        const showAnchors = this.s.isDraggingEndpoint !== null || (ctx.selectedElement && isArrowType(ctx.selectedElement))
        if (showAnchors) {
            this.s.hoveredAnchor = findNearestAnchor(ctx.elements, world.x, world.y)
            this.s.hoveredElement = null
            for (const el of ctx.elements) {
                if (isPointInElement(world.x, world.y, el) && getAnchors(el).length > 0) {
                    this.s.hoveredElement = el; break
                }
            }
        } else {
            this.s.hoveredAnchor = null
            this.s.hoveredElement = null
        }

        // Segment midpoint drag
        if (this.s.isDraggingSegment !== null && ctx.selectedElement?.type === 'ortho-arrow' && ctx.selectedElement.points) {
            this.handleSegmentDrag(ctx, world)
            enforceOrthogonality(ctx.selectedElement)
            ctx.render()
            return
        }

        // Endpoint drag
        if (this.s.isDraggingEndpoint && ctx.selectedElement) {
            this.handleEndpointDrag(ctx, world)
            if (ctx.selectedElement.type === 'ortho-arrow') enforceOrthogonality(ctx.selectedElement)
            ctx.render()
            return
        }

        // Resize drag
        if (this.s.isResizing && ctx.selectedElement) {
            // Keep resize cursor during active resize
            this.handleResize(ctx, world)
            updateConnectedArrows(ctx.elements, ctx.selectedElement.id)
            ctx.render()
            return
        }

        // Single-element drag
        if (this.s.isDragging && ctx.selectedElement) {
            ctx.setCursor('move')
            this.s.hasDragged = true
            ctx.selectedElement.x = world.x - this.s.dragOffset.x
            ctx.selectedElement.y = world.y - this.s.dragOffset.y
            const now = performance.now()
            if (now - this.lastRouteTime >= this.ROUTE_THROTTLE) {
                this.lastRouteTime = now
                updateConnectedArrows(ctx.elements, ctx.selectedElement.id)
            }
            ctx.render()
            return
        }

        // ── Hover cursor detection (no active drag) ──
        // Check arrow endpoints
        if (ctx.selectedElement && ctx.selectedElements.size <= 1 && isArrowType(ctx.selectedElement)) {
            const ep = hitTestArrowEndpoint(world.x, world.y, ctx.selectedElement)
            if (ep) {
                ctx.setCursor('grab')
                return
            }
            if (ctx.selectedElement.type === 'ortho-arrow') {
                const seg = hitTestSegmentMidpoint(world.x, world.y, ctx.selectedElement)
                if (seg !== null) {
                    ctx.setCursor('grab')
                    return
                }
            }
        }
        // Check resize handles (shapes only)
        if (ctx.selectedElement && ctx.selectedElements.size <= 1 && !isArrowType(ctx.selectedElement)) {
            const handle = hitTestHandle(world.x, world.y, ctx.selectedElement)
            if (handle) {
                const cursorMap: Record<string, string> = {
                    'nw': 'nwse-resize', 'se': 'nwse-resize',
                    'ne': 'nesw-resize', 'sw': 'nesw-resize',
                    'n': 'ns-resize', 's': 'ns-resize',
                    'e': 'ew-resize', 'w': 'ew-resize',
                }
                ctx.setCursor(cursorMap[handle] || 'pointer')
                return
            }
        }
        // Check element hover
        const hovered = hitTest(ctx.elements, world.x, world.y)
        if (hovered) {
            ctx.setCursor('move')
        } else {
            ctx.setCursor('default')
        }
    }

    // ── Mouse Up ───────────────────────────────────────────

    onMouseUp(ctx: DrawingContext) {
        // Box select release
        if (this.s.isBoxSelecting && this.s.boxStart && this.s.boxEnd) {
            this.s.isBoxSelecting = false
            const x1 = this.s.boxStart.x, y1 = this.s.boxStart.y
            const x2 = this.s.boxEnd.x, y2 = this.s.boxEnd.y

            // Only select if box has meaningful size
            if (Math.abs(x2 - x1) > 3 || Math.abs(y2 - y1) > 3) {
                for (const el of ctx.elements) {
                    if (boxIntersects(el, x1, y1, x2, y2)) {
                        ctx.selectedElements.add(el.id)
                    }
                }
                // Set selectedElement to first in selection
                if (ctx.selectedElements.size === 1) {
                    const id = ctx.selectedElements.values().next().value
                    ctx.selectedElement = ctx.elements.find(e => e.id === id) ?? null
                } else if (ctx.selectedElements.size > 1) {
                    ctx.selectedElement = null
                }
            }
            this.s.boxStart = null
            this.s.boxEnd = null
            ctx.render()
            return
        }

        // Group drag release → snap all
        if (this.s.isGroupDragging) {
            this.s.isGroupDragging = false
            this.s.groupDragStart = null
            for (const id of ctx.selectedElements) {
                const el = ctx.elements.find(e => e.id === id)
                if (el) {
                    el.x = ctx.snap(el.x)
                    el.y = ctx.snap(el.y)
                    updateConnectedArrows(ctx.elements, el.id)
                }
            }
            this.s.groupOrigPositions.clear()
            ctx.render(); ctx.save()
            return
        }

        // Segment midpoint release
        if (this.s.isDraggingSegment !== null && ctx.selectedElement) {
            this.s.isDraggingSegment = null
            snapArrowPreservingConnections(ctx, ctx.selectedElement)
            enforceOrthogonality(ctx.selectedElement)
            simplifyOrthoPoints(ctx.selectedElement)
            ctx.render(); ctx.save()
            return
        }

        // Endpoint drag release
        if (this.s.isDraggingEndpoint && ctx.selectedElement) {
            this.s.isDraggingEndpoint = null
            this.s.endpointDragOrigin = null
            snapArrowPreservingConnections(ctx, ctx.selectedElement)
            enforceOrthogonality(ctx.selectedElement)
            simplifyOrthoPoints(ctx.selectedElement)
            ctx.render(); ctx.save()
            return
        }

        // Resize release → snap
        if (this.s.isResizing && ctx.selectedElement) {
            this.s.isResizing = false; this.s.resizeHandle = null
            const el = ctx.selectedElement
            el.x = ctx.snap(el.x); el.y = ctx.snap(el.y)
            el.width = Math.max(ctx.grid(), ctx.snap(el.width))
            el.height = Math.max(ctx.grid(), ctx.snap(el.height))
            updateConnectedArrows(ctx.elements, el.id)
            ctx.render(); ctx.save()
            return
        }

        // Drag release → snap
        if (this.s.isDragging && ctx.selectedElement) {
            this.s.isDragging = false
            if (this.s.hasDragged) {
                ctx.selectedElement.x = ctx.snap(ctx.selectedElement.x)
                ctx.selectedElement.y = ctx.snap(ctx.selectedElement.y)
                updateConnectedArrows(ctx.elements, ctx.selectedElement.id)
                ctx.render(); ctx.save()
            }
            this.s.hasDragged = false
            return
        }
        ctx.setCursor('default')
    }

    // ── Double Click ───────────────────────────────────────

    onDoubleClick(ctx: DrawingContext, world: Point) {
        if (ctx.isEditing) return
        const hit = hitTest(ctx.elements, world.x, world.y)

        if (!hit) {
            return
        }

        ctx.selectedElement = hit
        ctx.selectedElements.clear()
        ctx.selectedElements.add(hit.id)

        // Arrow label editing
        if (isArrowType(hit) && hit.points && hit.points.length >= 2) {
            const lp = getArrowLabelPos(hit)
            if (!lp) return
            const currentLabel = hit.label || ''
            const resolvedFont = ctx.isSketchy ? "'Architects Daughter', Caveat, cursive" : hit.fontFamily
            const baseFontSize = hit.fontSize || 14
            const resolvedSize = ctx.isSketchy ? Math.round(baseFontSize * 1.3) : baseFontSize
            ctx.showEditor({
                worldX: lp.x, worldY: lp.y,
                initialText: currentLabel,
                elementId: hit.id,
                fontSize: resolvedSize,
                fontFamily: resolvedFont,
                fontWeight: hit.fontWeight,
                textColor: hit.textColor || hit.strokeColor,
                textAlign: 'center',
                onCommit: (text) => {
                    hit.label = text || undefined
                    ctx.save(); ctx.render()
                },
            })
            return
        }

        // Text/shape label editing
        const wx = hit.type === 'text' ? hit.x : hit.x + hit.width / 2
        const wy = hit.type === 'text' ? hit.y : hit.y + hit.height / 2
        const currentLabel = hit.text || ''
        const resolvedFont = ctx.isSketchy ? "'Architects Daughter', Caveat, cursive" : hit.fontFamily
        const resolvedSize = ctx.isSketchy ? Math.round((hit.fontSize || 14) * 1.3) : hit.fontSize
        const isShape = hit.type !== 'text'
        ctx.showEditor({
            worldX: isShape ? hit.x : wx,
            worldY: isShape ? hit.y : wy,
            initialText: currentLabel,
            elementId: hit.id,
            fontSize: resolvedSize,
            fontFamily: resolvedFont,
            fontWeight: hit.fontWeight,
            textColor: hit.textColor || hit.strokeColor,
            textAlign: isShape ? 'center' : 'left',
            shapeWidth: isShape ? hit.width : undefined,
            shapeHeight: isShape ? hit.height : undefined,
            onCommit: (text) => {
                hit.text = text || undefined
                ctx.save(); ctx.render()
            },
        })
    }

    // ── Key Down ───────────────────────────────────────────

    onKeyDown(ctx: DrawingContext, e: KeyboardEvent): boolean {
        const mod = e.ctrlKey || e.metaKey

        // Delete selected elements
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (ctx.selectedElements.size > 0) {
                ctx.elements = ctx.elements.filter(el => !ctx.selectedElements.has(el.id))
                ctx.selectedElements.clear()
                ctx.selectedElement = null
                ctx.render(); ctx.saveNow()
                return true
            }
            if (ctx.selectedElement) {
                ctx.elements = ctx.elements.filter(el => el.id !== ctx.selectedElement!.id)
                ctx.selectedElement = null
                ctx.render(); ctx.saveNow()
                return true
            }
            return false
        }

        // Ctrl+A: select all
        if (mod && e.key === 'a') {
            e.preventDefault()
            ctx.selectedElements.clear()
            for (const el of ctx.elements) ctx.selectedElements.add(el.id)
            ctx.selectedElement = null
            ctx.render()
            return true
        }

        // Ctrl+C: copy drawing elements (let pass through if nothing selected for native text copy)
        if (mod && e.key === 'c') {
            const ids = ctx.selectedElements.size > 0
                ? ctx.selectedElements
                : ctx.selectedElement ? new Set([ctx.selectedElement.id]) : new Set<string>()
            if (ids.size > 0) {
                e.preventDefault()
                ctx.clipboard = ctx.elements.filter(el => ids.has(el.id)).map(cloneElement)
                return true
            }
            return false
        }

        // Ctrl+V: paste drawing elements (let propagate if clipboard empty for image paste)
        if (mod && e.key === 'v') {
            if (ctx.clipboard.length > 0) {
                e.preventDefault()
                this.pasteClipboard(ctx, 30, 30)
                return true
            }
            return false // Let event propagate for image paste handler
        }

        // Ctrl+D: duplicate
        if (mod && e.key === 'd') {
            e.preventDefault()
            const ids = ctx.selectedElements.size > 0
                ? ctx.selectedElements
                : ctx.selectedElement ? new Set([ctx.selectedElement.id]) : new Set<string>()
            if (ids.size > 0) {
                const toDup = ctx.elements.filter(el => ids.has(el.id)).map(cloneElement)
                ctx.clipboard = toDup
                this.pasteClipboard(ctx, 30, 30)
            }
            return true
        }

        // Arrow keys: nudge selected elements (1px, 10px with Shift)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const ids = ctx.selectedElements.size > 0
                ? ctx.selectedElements
                : ctx.selectedElement ? new Set([ctx.selectedElement.id]) : new Set<string>()
            if (ids.size === 0) return false

            e.preventDefault()
            const step = e.shiftKey ? 10 : 1
            const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
            const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0

            for (const id of ids) {
                const el = ctx.elements.find(e => e.id === id)
                if (el) {
                    el.x += dx
                    el.y += dy
                    updateConnectedArrows(ctx.elements, el.id)
                }
            }
            ctx.render(); ctx.save()
            return true
        }

        return false
    }

    // ── Right Click ────────────────────────────────────────

    onRightClick(ctx: DrawingContext, world: Point) {
        const hit = hitTest(ctx.elements, world.x, world.y)

        // Ortho-arrow segment splitting
        if (hit?.type === 'ortho-arrow' && hit.points && hit.points.length >= 2) {
            const seg = findNearestSegment(world.x, world.y, hit)
            if (seg !== null && seg < hit.points.length - 1) {
                const p1 = hit.points[seg], p2 = hit.points[seg + 1]
                const isHorizontal = Math.abs(p1[1] - p2[1]) < 1
                const cx = ctx.snap(world.x - hit.x)
                const cy = ctx.snap(world.y - hit.y)
                if (isHorizontal) {
                    hit.points.splice(seg + 1, 0, [cx, p1[1]], [cx, p2[1]])
                } else {
                    hit.points.splice(seg + 1, 0, [p1[0], cy], [p2[0], cy])
                }
                ctx.selectedElement = hit
                ctx.save(); ctx.render()
                return
            }
        }

        // Arrowhead toggle
        if (hit && isArrowType(hit)) {
            const styles: DrawingElement['arrowEnd'][] = ['arrow', 'triangle', 'dot', 'bar', 'diamond', 'none']
            const curEnd = hit.arrowEnd || 'arrow'
            const idx = styles.indexOf(curEnd)
            hit.arrowEnd = styles[(idx + 1) % styles.length]
            ctx.save(); ctx.render()
        }
    }

    // ── Overlay (anchors + box select) ────────────────────

    renderOverlay(ctx: DrawingContext): string {
        let svg = ''

        // Anchor overlay
        const showAnchors = this.s.isDraggingEndpoint !== null || (ctx.selectedElement && isArrowType(ctx.selectedElement))
        if (showAnchors) {
            svg += renderAnchorsOverlay(ctx, this.s.hoveredElement, this.s.hoveredAnchor)
        }

        // Box selection rectangle
        if (this.s.isBoxSelecting && this.s.boxStart && this.s.boxEnd) {
            const x = Math.min(this.s.boxStart.x, this.s.boxEnd.x)
            const y = Math.min(this.s.boxStart.y, this.s.boxEnd.y)
            const w = Math.abs(this.s.boxEnd.x - this.s.boxStart.x)
            const h = Math.abs(this.s.boxEnd.y - this.s.boxStart.y)
            svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(99,102,241,0.08)" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="4 2" rx="2" />`

            // Preview highlights on elements inside the box
            for (const el of ctx.elements) {
                if (this.s.boxPreviewIds.has(el.id)) {
                    const pad = 4
                    const b = getElementBounds(el)
                    svg += `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" fill="rgba(99,102,241,0.06)" stroke="var(--color-accent)" stroke-width="1.5" stroke-dasharray="4 2" rx="3" />`
                }
            }
        }

        return svg
    }

    // ── Private helpers ────────────────────────────────────

    private startGroupDrag(ctx: DrawingContext, world: Point) {
        this.s.isGroupDragging = true
        this.s.groupDragStart = { ...world }
        this.s.groupOrigPositions.clear()
        for (const id of ctx.selectedElements) {
            const el = ctx.elements.find(e => e.id === id)
            if (el) this.s.groupOrigPositions.set(id, { x: el.x, y: el.y })
        }
    }

    private pasteClipboard(ctx: DrawingContext, offsetX: number, offsetY: number) {
        ctx.selectedElements.clear()
        ctx.selectedElement = null

        if (ctx.clipboard.length === 0) return

        // Compute bounding box of clipboard elements to find their center
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const el of ctx.clipboard) {
            const b = getElementBounds(el)
            minX = Math.min(minX, b.x)
            minY = Math.min(minY, b.y)
            maxX = Math.max(maxX, b.x + b.w)
            maxY = Math.max(maxY, b.y + b.h)
        }
        const clipCenterX = (minX + maxX) / 2
        const clipCenterY = (minY + maxY) / 2

        // Paste at mouse cursor position
        const targetX = ctx.snap(this.s.lastMouseWorld.x)
        const targetY = ctx.snap(this.s.lastMouseWorld.y)

        // Offset: move clipboard center to mouse cursor
        const dx = targetX - clipCenterX
        const dy = targetY - clipCenterY

        for (const src of ctx.clipboard) {
            const newEl = cloneElement(src)
            newEl.id = genId()
            newEl.x += dx + offsetX
            newEl.y += dy + offsetY
            // Clear connections for pasted elements
            newEl.startConnection = undefined
            newEl.endConnection = undefined
            ctx.elements.push(newEl)
            ctx.selectedElements.add(newEl.id)
        }
        ctx.render(); ctx.saveNow()
    }

    private createInlineText(ctx: DrawingContext, world: Point) {
        const tx = ctx.snap(world.x), ty = ctx.snap(world.y)
        const d = ctx.getDefaults('text')
        const resolvedFont = ctx.isSketchy ? "'Architects Daughter', Caveat, cursive" : d.fontFamily
        const resolvedSize = ctx.isSketchy ? Math.round((d.fontSize || 14) * 1.3) : d.fontSize
        ctx.showEditor({
            worldX: tx,
            worldY: ty,
            initialText: '',
            fontSize: resolvedSize,
            fontFamily: resolvedFont,
            fontWeight: d.fontWeight,
            textColor: d.textColor,
            textAlign: 'left',
            onCommit: (text) => {
                if (text) {
                    ctx.elements.push({
                        id: genId(), type: 'text',
                        x: tx, y: ty, width: 0, height: 0,
                        text, fontSize: d.fontSize,
                        strokeColor: d.strokeColor, strokeWidth: 1,
                        backgroundColor: 'transparent',
                        fontFamily: d.fontFamily, fontWeight: d.fontWeight,
                        textColor: d.textColor, opacity: d.opacity,
                    })
                    ctx.save(); ctx.render()
                }
            },
        })
    }

    private handleSegmentDrag(ctx: DrawingContext, world: Point) {
        const el = ctx.selectedElement!
        const pts = el.points!
        const segIdx = this.s.isDraggingSegment!

        if (segIdx >= pts.length - 1) return
        const p1 = pts[segIdx], p2 = pts[segIdx + 1]
        const isHorizontal = Math.abs(p1[1] - p2[1]) < 1

        if (segIdx === 0 && el.startConnection && pts.length === 3) {
            if (isHorizontal) {
                const newY = world.y - el.y
                pts.splice(1, 0, [p1[0], newY])
                pts[2][1] = newY
            } else {
                const newX = world.x - el.x
                pts.splice(1, 0, [newX, p1[1]])
                pts[2][0] = newX
            }
            this.s.isDraggingSegment = 1
        } else if (segIdx === pts.length - 2 && el.endConnection && pts.length === 3) {
            if (isHorizontal) {
                const newY = world.y - el.y
                pts.splice(segIdx + 1, 0, [p1[0], newY])
                p1[1] = newY
            } else {
                const newX = world.x - el.x
                pts.splice(segIdx + 1, 0, [newX, p2[1]])
                p1[0] = newX
            }
        } else {
            if (isHorizontal) {
                const newY = world.y - el.y
                p1[1] = newY; p2[1] = newY
            } else {
                const newX = world.x - el.x
                p1[0] = newX; p2[0] = newX
            }
        }
    }

    private handleEndpointDrag(ctx: DrawingContext, world: Point) {
        const el = ctx.selectedElement!
        const nearAnchor = findNearestAnchor(ctx.elements, world.x, world.y)
        const pt = nearAnchor ? { x: nearAnchor.x, y: nearAnchor.y } : { x: world.x, y: world.y }
        const conn = nearAnchor ? { elementId: nearAnchor.elementId, side: nearAnchor.side, t: nearAnchor.t } : undefined

        const origin = this.s.endpointDragOrigin
        const dragDist = origin ? Math.hypot(world.x - origin.x, world.y - origin.y) : Infinity
        const effectiveConn = conn ?? (dragDist < 20 ? origin?.conn : undefined)

        if (this.s.isDraggingEndpoint === 'start') {
            const usePt = effectiveConn && !conn && origin ? { x: origin.x, y: origin.y } : pt
            if (el.type === 'ortho-arrow' && el.points) {
                const endAbs = { x: el.x + el.points[el.points.length - 1][0], y: el.y + el.points[el.points.length - 1][1] }
                el.x = usePt.x; el.y = usePt.y
                const dx = endAbs.x - usePt.x, dy = endAbs.y - usePt.y
                el.points = computeOrthoRoute(dx, dy, effectiveConn?.side, el.endConnection?.side)
            }
            el.startConnection = effectiveConn
        } else {
            const usePt = effectiveConn && !conn && origin ? { x: origin.x, y: origin.y } : pt
            if (el.type === 'ortho-arrow' && el.points) {
                const dx = usePt.x - el.x, dy = usePt.y - el.y
                el.points = computeOrthoRoute(dx, dy, el.startConnection?.side, effectiveConn?.side)
            }
            el.endConnection = effectiveConn
        }
    }

    private handleResize(ctx: DrawingContext, world: Point) {
        const el = ctx.selectedElement!
        const { x: ox, y: oy, w: ow, h: oh } = this.s.resizeOrigin
        const g = ctx.grid()

        switch (this.s.resizeHandle) {
            case 'se': el.width = Math.max(g, world.x - ox); el.height = Math.max(g, world.y - oy); break
            case 'e': el.width = Math.max(g, world.x - ox); break
            case 's': el.height = Math.max(g, world.y - oy); break
            case 'nw':
                el.x = Math.min(world.x, ox + ow - g); el.y = Math.min(world.y, oy + oh - g)
                el.width = ox + ow - el.x; el.height = oy + oh - el.y; break
            case 'n': el.y = Math.min(world.y, oy + oh - g); el.height = oy + oh - el.y; break
            case 'ne':
                el.y = Math.min(world.y, oy + oh - g); el.width = Math.max(g, world.x - ox); el.height = oy + oh - el.y; break
            case 'sw':
                el.x = Math.min(world.x, ox + ow - g); el.width = ox + ow - el.x; el.height = Math.max(g, world.y - oy); break
            case 'w': el.x = Math.min(world.x, ox + ow - g); el.width = ox + ow - el.x; break
        }
    }
}

// ── Anchor overlay rendering ──────────────────────────────

import { renderAnchors } from '../render'

function renderAnchorsOverlay(
    ctx: DrawingContext,
    hoveredElement: DrawingElement | null,
    hoveredAnchor: AnchorPoint | null,
): string {
    return renderAnchors(hoveredElement, hoveredAnchor, getAnchors)
}
