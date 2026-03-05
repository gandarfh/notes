// ── Select Handler ─────────────────────────────────────────
// Handles: element selection (single + multi), dragging, resizing,
// arrow endpoint drag, ortho-arrow segment midpoint drag,
// box-select, group move, copy/paste/duplicate.

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'
import { DASHBOARD_COLS } from '../../constants'
import type { DrawingElement, ResizeHandle, Connection, AnchorPoint } from '../types'
import { isArrowType, genId, getElementBounds } from '../types'
import { hitTest, hitTestHandle, hitTestArrowEndpoint, hitTestSegmentMidpoint, findNearestSegment, isPointInElement } from '../hitTest'
import { getArrowLabelPos, drawAnchors, drawBoxSelection } from '../canvasRender'
import { getAnchors, getAnchorsForRect, resolveAnchor, findNearestAnchor, updateConnectedArrows, updateSimpleConnectedArrows } from '../connections'
import { computeOrthoRoute, simplifyOrthoPoints, enforceOrthogonality } from '../ortho'

/** Clamp a drawing element's position to board boundaries */
function clampToBoard(el: { x: number; y: number; width?: number; height?: number }, grid: { colW: number; rowH: number }) {
    const maxW = grid.colW * DASHBOARD_COLS
    const elW = el.width ?? 0
    el.x = Math.max(0, Math.min(el.x, maxW - elW))
    el.y = Math.max(0, el.y)
}

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

export function cloneElement(el: DrawingElement): DrawingElement {
    return JSON.parse(JSON.stringify(el))
}

// ── Box intersection check ────────────────────────────────

export function boxIntersects(el: { x: number; y: number; width: number; height: number; points?: number[][]; type?: string }, x1: number, y1: number, x2: number, y2: number): boolean {
    const bx = Math.min(x1, x2), by = Math.min(y1, y2)
    const bw = Math.abs(x2 - x1), bh = Math.abs(y2 - y1)

    // For arrow types, check if any point is inside the box
    if (el.type && isArrowType(el as DrawingElement) && el.points) {
        for (const p of el.points) {
            const px = el.x + p[0], py = el.y + p[1]
            if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) return true
        }
        return false
    }

    // For shapes/text/blocks: AABB overlap
    const ex = el.x, ey = el.y, ew = el.width || 0, eh = el.height || 0
    return !(ex + ew < bx || ex > bx + bw || ey + eh < by || ey > by + bh)
}

// ── SelectHandler ─────────────────────────────────────────

export class SelectHandler implements InteractionHandler {
    private s = createSelectState()
    private lastRouteTime = 0
    private readonly ROUTE_THROTTLE = 16  // ms (~60fps cap for WASM ortho routing)

    setShiftKey(shift: boolean) {
        this.s.shiftDown = shift
    }

    /** Returns the current group-drag delta (for live bounding box rendering) */
    getGroupDragDelta(): Point | null {
        if (!this.s.isGroupDragging || !this.s.groupDragStart) return null
        return {
            x: this.s.lastMouseWorld.x - this.s.groupDragStart.x,
            y: this.s.lastMouseWorld.y - this.s.groupDragStart.y,
        }
    }

    /** Returns IDs being group-dragged (for offset calculation) */
    getGroupDragIds(): Set<string> {
        return new Set(this.s.groupOrigPositions.keys())
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
        console.log(`[SelectHandler MOUSE] world=(${world.x.toFixed(0)},${world.y.toFixed(0)}) hit=${hit?.id ?? 'none'} shift=${this.s.shiftDown} shapes=[${[...ctx.selectedElements]}] blocks=[${ctx.getSelectedBlockIds()}] blockRects=${ctx.blockRects.length}`)

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
                // Sync unified selection: drawing shapes + store blocks
                const allIds = [...ctx.selectedElements, ...ctx.getSelectedBlockIds()]
                console.log(`[SelectHandler] shift+click shape → sync [${allIds}]`)
                ctx.onSelectEntities?.(allIds)
                ctx.render()
                return
            }

            // Click on already-selected element in multi-selection → start group drag
            if ((ctx.selectedElements.has(hit.id) && ctx.selectedElements.size > 1) ||
                (ctx.selectedElements.has(hit.id) && ctx.getSelectedBlockIds().length > 0)) {
                console.log(`[SelectHandler] click selected shape in multi → group drag`)
                this.startGroupDrag(ctx, world)
                return
            }

            // Normal click → select only this element
            ctx.selectedElements.clear()
            ctx.selectedElements.add(hit.id)
            ctx.selectedElement = hit
            // Sync to unified store (clears block selection too)
            console.log(`[SelectHandler] normal click shape → sync [${hit.id}]`)
            ctx.onSelectEntities?.([hit.id])

            const isConnected = isArrowType(hit) && (hit.startConnection || hit.endConnection)
            if (!isConnected) {
                this.s.isDragging = true
                this.s.hasDragged = false
                this.s.dragOffset = { x: world.x - hit.x, y: world.y - hit.y }
            }
        } else {
            // Check if click landed on a DOM block
            const hitBlock = ctx.blockRects.find(r =>
                world.x >= r.x && world.x <= r.x + r.width &&
                world.y >= r.y && world.y <= r.y + r.height
            )

            if (hitBlock) {
                const blockIds = ctx.getSelectedBlockIds()
                const isInSelection = blockIds.includes(hitBlock.id)
                console.log(`[SelectHandler] hitBlock=${hitBlock.id} isInSelection=${isInSelection} shift=${this.s.shiftDown} shapes=[${[...ctx.selectedElements]}] blockIds=[${blockIds}]`)

                if (this.s.shiftDown) {
                    // Shift+click on block: toggle in unified selection
                    if (isInSelection) {
                        const allIds = [...ctx.selectedElements].concat(blockIds.filter(id => id !== hitBlock.id))
                        console.log(`[SelectHandler] shift+click block (remove) → sync [${allIds}]`)
                        ctx.onSelectEntities?.(allIds)
                    } else {
                        const allIds = [...ctx.selectedElements, ...blockIds, hitBlock.id]
                        console.log(`[SelectHandler] shift+click block (add) → sync [${allIds}]`)
                        ctx.onSelectEntities?.(allIds)
                    }
                    ctx.render()
                    return
                }

                if (isInSelection && (ctx.selectedElements.size > 0 || blockIds.length > 1)) {
                    console.log(`[SelectHandler] click block in multi → group drag`)
                    this.startGroupDrag(ctx, world)
                    return
                }

                // Normal click on block → select only this block
                console.log(`[SelectHandler] normal click block → sync [${hitBlock.id}]`)
                ctx.selectedElement = null
                ctx.selectedElements.clear()
                ctx.onSelectEntities?.([hitBlock.id])
                ctx.render()
                return
            }

            if (!this.s.shiftDown) {
                // Click on empty space → clear ALL selection (shapes + blocks)
                ctx.selectedElement = null
                ctx.selectedElements.clear()
                ctx.onSelectEntities?.([])
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
            // Compute preview: which elements (shapes + blocks) are inside the box
            this.s.boxPreviewIds.clear()
            for (const el of ctx.elements) {
                if (boxIntersects(el, this.s.boxStart.x, this.s.boxStart.y, world.x, world.y)) {
                    this.s.boxPreviewIds.add(el.id)
                }
            }
            for (const rect of ctx.blockRects) {
                if (boxIntersects(rect, this.s.boxStart.x, this.s.boxStart.y, world.x, world.y)) {
                    this.s.boxPreviewIds.add(rect.id)
                }
            }
            ctx.render()
            return
        }

        // Group drag (shapes + blocks)
        if (this.s.isGroupDragging && this.s.groupDragStart) {
            ctx.setCursor('move')
            const dx = world.x - this.s.groupDragStart.x
            const dy = world.y - this.s.groupDragStart.y
            const blockIdSet = new Set(ctx.getSelectedBlockIds())
            // Build live blockRects with dragged positions for arrow routing
            const liveBlockRects = ctx.blockRects.map(r => {
                if (blockIdSet.has(r.id)) {
                    const orig = this.s.groupOrigPositions.get(r.id)
                    return orig ? { ...r, x: orig.x + dx, y: orig.y + dy } : r
                }
                return r
            })
            for (const [id, orig] of this.s.groupOrigPositions) {
                if (blockIdSet.has(id)) {
                    // Move block via DOM for zero re-renders during drag
                    const el = document.querySelector(`[data-block-id="${id}"]`) as HTMLElement
                    if (el) {
                        el.style.left = `${orig.x + dx}px`
                        el.style.top = `${orig.y + dy}px`
                    }
                } else {
                    const el = ctx.elements.find(e => e.id === id)
                    if (el) {
                        el.x = orig.x + dx
                        el.y = orig.y + dy
                        const dg = ctx.getDashboardGrid?.()
                        if (dg) clampToBoard(el, dg)
                    }
                }
            }
            // Simple arrows: update endpoints every frame (cheap, no WASM)
            for (const [id] of this.s.groupOrigPositions) {
                updateSimpleConnectedArrows(ctx.elements, id, liveBlockRects)
            }
            // Ortho arrows: full WASM re-route, throttled
            const now = performance.now()
            if (now - this.lastRouteTime >= this.ROUTE_THROTTLE) {
                this.lastRouteTime = now
                for (const [id] of this.s.groupOrigPositions) {
                    updateConnectedArrows(ctx.elements, id, liveBlockRects)
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
            updateConnectedArrows(ctx.elements, ctx.selectedElement.id, ctx.blockRects)
            ctx.render()
            return
        }

        // Single-element drag
        if (this.s.isDragging && ctx.selectedElement) {
            ctx.setCursor('move')
            this.s.hasDragged = true
            ctx.selectedElement.x = world.x - this.s.dragOffset.x
            ctx.selectedElement.y = world.y - this.s.dragOffset.y
            const dgDrag = ctx.getDashboardGrid?.()
            if (dgDrag) clampToBoard(ctx.selectedElement, dgDrag)
            // Simple arrows: instant endpoint update (no WASM)
            updateSimpleConnectedArrows(ctx.elements, ctx.selectedElement.id, ctx.blockRects)
            // Ortho arrows: throttled WASM re-route
            const now = performance.now()
            if (now - this.lastRouteTime >= this.ROUTE_THROTTLE) {
                this.lastRouteTime = now
                updateConnectedArrows(ctx.elements, ctx.selectedElement.id, ctx.blockRects)
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
                const allSelectedIds: string[] = []
                for (const el of ctx.elements) {
                    if (boxIntersects(el, x1, y1, x2, y2)) {
                        ctx.selectedElements.add(el.id)
                        allSelectedIds.push(el.id)
                    }
                }
                // Also include DOM blocks in the box
                for (const rect of ctx.blockRects) {
                    if (boxIntersects(rect, x1, y1, x2, y2)) {
                        allSelectedIds.push(rect.id)
                    }
                }
                // Sync all selected IDs (shapes + blocks) to unified store
                console.log(`[SelectHandler] box-select commit: shapes=[${[...ctx.selectedElements]}] allIds=[${allSelectedIds}]`)
                if (allSelectedIds.length > 0) {
                    ctx.onSelectEntities?.(allSelectedIds)
                }
                // Set selectedElement to first in selection (shapes only)
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

        // Group drag release → snap shapes first, then update connected arrows
        if (this.s.isGroupDragging) {
            this.s.isGroupDragging = false
            this.s.groupDragStart = null
            const blockIdSet = new Set(ctx.getSelectedBlockIds())

            // Pass 1: snap all non-arrow drawing elements to grid
            const dgSnap = ctx.getDashboardGrid?.()
            for (const id of ctx.selectedElements) {
                const el = ctx.elements.find(e => e.id === id)
                if (el && !isArrowType(el)) {
                    el.x = ctx.snap(el.x)
                    el.y = ctx.snap(el.y)
                    if (dgSnap) clampToBoard(el, dgSnap)
                }
            }

            // Pass 1b: commit block positions (read final pos from DOM, snap to grid)
            if (blockIdSet.size > 0 && ctx.onMoveBlocks) {
                const moves: Array<{id: string, x: number, y: number}> = []
                for (const id of blockIdSet) {
                    const el = document.querySelector(`[data-block-id="${id}"]`) as HTMLElement
                    if (el) {
                        moves.push({
                            id,
                            x: ctx.snap(parseFloat(el.style.left)),
                            y: ctx.snap(parseFloat(el.style.top)),
                        })
                    }
                }
                if (moves.length > 0) ctx.onMoveBlocks(moves)
            }

            // Pass 2: recalculate connected arrows (shapes + blocks are in final positions)
            const updatedArrows = new Set<string>()
            const allMovedIds = new Set([...ctx.selectedElements, ...blockIdSet])
            for (const id of allMovedIds) {
                if (ctx.selectedElements.has(id) && isArrowType(ctx.elements.find(e => e.id === id)!)) continue
                for (const el of ctx.elements) {
                    if (isArrowType(el) && (el.startConnection?.elementId === id || el.endConnection?.elementId === id)) {
                        updatedArrows.add(el.id)
                    }
                }
                updateConnectedArrows(ctx.elements, id, ctx.blockRects)
            }

            // Pass 3: snap unconnected arrows that weren't recalculated
            for (const id of ctx.selectedElements) {
                const el = ctx.elements.find(e => e.id === id)
                if (el && isArrowType(el) && !updatedArrows.has(el.id)) {
                    el.x = ctx.snap(el.x)
                    el.y = ctx.snap(el.y)
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
            updateConnectedArrows(ctx.elements, el.id, ctx.blockRects)
            ctx.render(); ctx.save()
            return
        }

        // Drag release → snap
        if (this.s.isDragging && ctx.selectedElement) {
            this.s.isDragging = false
            if (this.s.hasDragged) {
                ctx.selectedElement.x = ctx.snap(ctx.selectedElement.x)
                ctx.selectedElement.y = ctx.snap(ctx.selectedElement.y)
                const dgDrop = ctx.getDashboardGrid?.()
                if (dgDrop) clampToBoard(ctx.selectedElement, dgDrop)
                updateConnectedArrows(ctx.elements, ctx.selectedElement.id, ctx.blockRects)
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
            const resolvedFont = "'Architects Daughter'"
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

        // Group label editing — positioned at top-left on the border (matching canvas render)
        if (hit.type === 'group') {
            const currentLabel = hit.text || ''
            const resolvedFont = "'Architects Daughter'"
            const baseFontSize = hit.fontSize || 14
            const resolvedSize = ctx.isSketchy ? Math.round(baseFontSize * 1.3) : baseFontSize
            const isLight = document.documentElement.dataset.theme === 'light'
            ctx.showEditor({
                worldX: hit.x + 12,
                worldY: hit.y - 2,
                initialText: currentLabel,
                elementId: hit.id,
                fontSize: Math.max(resolvedSize, 12),
                fontFamily: resolvedFont,
                fontWeight: 600,
                textColor: isLight ? '#e8e8f0' : '#1e1e2e',
                textAlign: 'left',
                background: isLight ? '#1e1e2e' : '#e8e8f0',
                onCommit: (text) => {
                    hit.text = text || undefined
                    ctx.save(); ctx.render()
                },
            })
            return
        }

        // Text/shape label editing
        const wx = hit.type === 'text' ? hit.x : hit.x + hit.width / 2
        const wy = hit.type === 'text' ? hit.y : hit.y + hit.height / 2
        const currentLabel = hit.text || ''
        const resolvedFont = "'Architects Daughter'"
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

        // Delete selected elements + blocks
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const blockIds = ctx.getSelectedBlockIds()
            let acted = false

            // Delete drawing shapes
            if (ctx.selectedElements.size > 0) {
                ctx.elements = ctx.elements.filter(el => !ctx.selectedElements.has(el.id))
                ctx.selectedElements.clear()
                ctx.selectedElement = null
                acted = true
            } else if (ctx.selectedElement) {
                ctx.elements = ctx.elements.filter(el => el.id !== ctx.selectedElement!.id)
                ctx.selectedElement = null
                acted = true
            }

            // Delete blocks
            if (blockIds.length > 0 && ctx.onDeleteBlocks) {
                ctx.onDeleteBlocks(blockIds)
                acted = true
            }

            if (acted) { ctx.render(); ctx.saveNow() }
            return acted
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

        // Arrow keys: nudge selected elements + blocks (1px, 10px with Shift)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const shapeIds = ctx.selectedElements.size > 0
                ? ctx.selectedElements
                : ctx.selectedElement ? new Set([ctx.selectedElement.id]) : new Set<string>()
            const blockIds = ctx.getSelectedBlockIds()

            if (shapeIds.size === 0 && blockIds.length === 0) return false

            e.preventDefault()
            const dashGrid = ctx.getDashboardGrid?.()
            const step = dashGrid
                ? 1  // 1 grid cell
                : (e.shiftKey ? 10 : 1)
            const stepX = dashGrid ? dashGrid.colW * step : step
            const stepY = dashGrid ? dashGrid.rowH * step : step
            const dx = e.key === 'ArrowLeft' ? -stepX : e.key === 'ArrowRight' ? stepX : 0
            const dy = e.key === 'ArrowUp' ? -stepY : e.key === 'ArrowDown' ? stepY : 0

            // Move drawing elements
            const dgNudge = dashGrid
            for (const id of shapeIds) {
                const el = ctx.elements.find(e => e.id === id)
                if (el) {
                    el.x += dx
                    el.y += dy
                    if (dgNudge) clampToBoard(el, dgNudge)
                    updateConnectedArrows(ctx.elements, el.id, ctx.blockRects)
                }
            }

            // Move blocks via store callback (skip in board mode — RGL controls position)
            if (blockIds.length > 0 && ctx.onMoveBlocks && !dashGrid) {
                const moves: Array<{id: string, x: number, y: number}> = []
                for (const id of blockIds) {
                    const rect = ctx.blockRects.find(r => r.id === id)
                    if (rect) moves.push({ id, x: rect.x + dx, y: rect.y + dy })
                }
                if (moves.length > 0) ctx.onMoveBlocks(moves)
            }

            if (shapeIds.size > 0) { ctx.render(); ctx.save() }
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

    renderOverlay(ctx: DrawingContext, canvas: CanvasRenderingContext2D): void {
        // Anchor overlay
        const showAnchors = this.s.isDraggingEndpoint !== null || (ctx.selectedElement && isArrowType(ctx.selectedElement))
        if (showAnchors) {
            drawAnchorsCanvas(canvas, ctx, this.s.hoveredElement, this.s.hoveredAnchor)
        }

        // Box selection rectangle
        if (this.s.isBoxSelecting && this.s.boxStart && this.s.boxEnd) {
            drawBoxSelection(canvas, this.s.boxStart, this.s.boxEnd, this.s.boxPreviewIds, ctx.elements, ctx.blockRects)
        }
    }

    // ── Private helpers ────────────────────────────────────

    private startGroupDrag(ctx: DrawingContext, world: Point) {
        this.s.isGroupDragging = true
        this.s.groupDragStart = { ...world }
        this.s.groupOrigPositions.clear()
        // Drawing elements
        for (const id of ctx.selectedElements) {
            const el = ctx.elements.find(e => e.id === id)
            if (el) this.s.groupOrigPositions.set(id, { x: el.x, y: el.y })
        }
        // DOM blocks (from unified selection)
        for (const id of ctx.getSelectedBlockIds()) {
            const rect = ctx.blockRects.find(r => r.id === id)
            if (rect) this.s.groupOrigPositions.set(id, { x: rect.x, y: rect.y })
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
        const resolvedFont = "'Architects Daughter'"
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
                // Collect obstacles (all shapes except src/dst)
                const excludeIds = new Set([effectiveConn?.elementId, el.endConnection?.elementId])
                const obstacles = ctx.elements
                    .filter(e => !isArrowType(e) && e.type !== 'group' && !excludeIds.has(e.id))
                    .map(e => ({ x: e.x - usePt.x, y: e.y - usePt.y, w: e.width, h: e.height }))
                // Compute src/dst rects for obstacle-aware routing
                const srcEl = effectiveConn ? ctx.elements.find(e => e.id === effectiveConn.elementId) : undefined
                const dstEl = el.endConnection ? ctx.elements.find(e => e.id === el.endConnection!.elementId) : undefined
                const sRect = srcEl ? { x: srcEl.x - usePt.x, y: srcEl.y - usePt.y, w: srcEl.width, h: srcEl.height } : undefined
                const eRect = dstEl ? { x: dstEl.x - usePt.x, y: dstEl.y - usePt.y, w: dstEl.width, h: dstEl.height } : undefined
                el.points = computeOrthoRoute(dx, dy, effectiveConn?.side, el.endConnection?.side, sRect, eRect, obstacles)
            }
            el.startConnection = effectiveConn
        } else {
            const usePt = effectiveConn && !conn && origin ? { x: origin.x, y: origin.y } : pt
            if (el.type === 'ortho-arrow' && el.points) {
                const dx = usePt.x - el.x, dy = usePt.y - el.y
                // Collect obstacles (all shapes except src/dst)
                const excludeIds = new Set([el.startConnection?.elementId, effectiveConn?.elementId])
                const obstacles = ctx.elements
                    .filter(e => !isArrowType(e) && e.type !== 'group' && !excludeIds.has(e.id))
                    .map(e => ({ x: e.x - el.x, y: e.y - el.y, w: e.width, h: e.height }))
                // Compute src/dst rects for obstacle-aware routing
                const srcEl = el.startConnection ? ctx.elements.find(e => e.id === el.startConnection!.elementId) : undefined
                const dstEl = effectiveConn ? ctx.elements.find(e => e.id === effectiveConn.elementId) : undefined
                const sRect = srcEl ? { x: srcEl.x - el.x, y: srcEl.y - el.y, w: srcEl.width, h: srcEl.height } : undefined
                const eRect = dstEl ? { x: dstEl.x - el.x, y: dstEl.y - el.y, w: dstEl.width, h: dstEl.height } : undefined
                el.points = computeOrthoRoute(dx, dy, el.startConnection?.side, effectiveConn?.side, sRect, eRect, obstacles)
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

function drawAnchorsCanvas(
    canvas: CanvasRenderingContext2D,
    _ctx: DrawingContext,
    hoveredElement: DrawingElement | null,
    hoveredAnchor: AnchorPoint | null,
): void {
    drawAnchors(canvas, hoveredElement, hoveredAnchor, (el) => {
        if ('strokeColor' in el) return getAnchors(el as DrawingElement)
        return getAnchorsForRect(el)
    })
}
