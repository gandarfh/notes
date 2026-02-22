// ── Arrow Handler ──────────────────────────────────────────
// Handles: ortho-arrow click-to-connect workflow (2 clicks).

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'
import type { DrawingElement, Connection, AnchorPoint } from '../types'
import { genId, isArrowType } from '../types'
import { isPointInElement } from '../hitTest'
import { computeOrthoRoute, type Rect } from '../ortho'
import { getAnchors, findNearestAnchor } from '../connections'
import { renderAnchors } from '../render'

interface ArrowState {
    pending: { connection: Connection; worldPt: Point } | null
    hoveredAnchor: AnchorPoint | null
    hoveredElement: DrawingElement | null
}

/** Get element bounding rect relative to arrow origin (0,0 = arrow start) */
function elRect(el: DrawingElement | undefined, arrowX: number, arrowY: number, elements: DrawingElement[]): Rect | undefined {
    if (!el) return undefined
    const target = elements.find(e => e.id === el.id) || el
    return { x: target.x - arrowX, y: target.y - arrowY, w: target.width, h: target.height }
}

function findElById(elements: DrawingElement[], id?: string): DrawingElement | undefined {
    return id ? elements.find(e => e.id === id) : undefined
}

export class ArrowHandler implements InteractionHandler {
    private s: ArrowState = { pending: null, hoveredAnchor: null, hoveredElement: null }
    private lastRouteTime = 0
    private readonly ROUTE_THROTTLE = 32  // ms (~30fps cap for routing)

    deactivate(ctx: DrawingContext) {
        this.s = { pending: null, hoveredAnchor: null, hoveredElement: null }
        ctx.currentElement = null
    }

    onMouseDown(ctx: DrawingContext, world: Point) {
        const nearAnchor = findNearestAnchor(ctx.elements, world.x, world.y)

        if (!this.s.pending) {
            // First click — set start
            const connection: Connection | undefined = nearAnchor
                ? { elementId: nearAnchor.elementId, side: nearAnchor.side, t: nearAnchor.t }
                : undefined
            const startPt = nearAnchor
                ? { x: nearAnchor.x, y: nearAnchor.y }
                : { x: ctx.snap(world.x), y: ctx.snap(world.y) }

            this.s.pending = {
                connection: connection || { elementId: '', side: 'top', t: 0.5 },
                worldPt: startPt,
            }

            const d = ctx.getDefaults('arrow')
            ctx.currentElement = {
                id: genId(), type: 'ortho-arrow',
                x: startPt.x, y: startPt.y, width: 0, height: 0,
                points: [[0, 0], [0, 0]],
                strokeColor: d.strokeColor,
                strokeWidth: d.strokeWidth,
                backgroundColor: 'transparent',
                startConnection: connection,
                arrowEnd: 'arrow', arrowStart: 'none',
                opacity: d.opacity,
                fontSize: d.fontSize,
                fontFamily: d.fontFamily,
                fontWeight: d.fontWeight,
                textColor: d.textColor,
            }
        } else {
            // Second click — complete arrow
            if (!ctx.currentElement) return

            const endConn: Connection | undefined = nearAnchor
                ? { elementId: nearAnchor.elementId, side: nearAnchor.side, t: nearAnchor.t }
                : undefined
            const endPt = nearAnchor
                ? { x: nearAnchor.x, y: nearAnchor.y }
                : { x: ctx.snap(world.x), y: ctx.snap(world.y) }

            ctx.currentElement.endConnection = endConn

            const dx = endPt.x - ctx.currentElement.x
            const dy = endPt.y - ctx.currentElement.y
            const sSide = ctx.currentElement.startConnection?.side
            const eSide = endConn?.side

            // Compute obstacle rects
            const startEl = findElById(ctx.elements, ctx.currentElement.startConnection?.elementId)
            const endEl = findElById(ctx.elements, endConn?.elementId)
            const sRect = elRect(startEl, ctx.currentElement.x, ctx.currentElement.y, ctx.elements)
            const eRect = elRect(endEl, ctx.currentElement.x, ctx.currentElement.y, ctx.elements)

            ctx.currentElement.points = computeOrthoRoute(dx, dy, sSide, eSide, sRect, eRect)

            ctx.currentElement.width = Math.abs(dx)
            ctx.currentElement.height = Math.abs(dy)

            ctx.elements.push(ctx.currentElement)
            ctx.selectedElement = ctx.currentElement
            ctx.currentElement = null
            this.s.pending = null
            ctx.save()
            ctx.setSubTool('draw-select')
        }
        ctx.render()
    }

    onMouseMove(ctx: DrawingContext, world: Point) {
        // Update hovered anchor
        this.s.hoveredAnchor = findNearestAnchor(ctx.elements, world.x, world.y)
        this.s.hoveredElement = null
        for (const el of ctx.elements) {
            if (isPointInElement(world.x, world.y, el) && getAnchors(el).length > 0) {
                this.s.hoveredElement = el; break
            }
        }

        // Arrow preview (first click placed, cursor moving)
        if (this.s.pending && ctx.currentElement) {
            const nearAnchor = this.s.hoveredAnchor
            const pt = nearAnchor ? { x: nearAnchor.x, y: nearAnchor.y } : { x: world.x, y: world.y }

            const dx = pt.x - ctx.currentElement.x
            const dy = pt.y - ctx.currentElement.y
            const sSide = ctx.currentElement.startConnection?.side
            const eSide = nearAnchor?.side

            // Compute obstacle rects for preview
            const startEl = findElById(ctx.elements, ctx.currentElement.startConnection?.elementId)
            const endEl = nearAnchor ? findElById(ctx.elements, nearAnchor.elementId) : undefined
            const sRect = elRect(startEl, ctx.currentElement.x, ctx.currentElement.y, ctx.elements)
            const eRect = elRect(endEl, ctx.currentElement.x, ctx.currentElement.y, ctx.elements)

            // Throttle expensive routing computation
            const now = performance.now()
            if (now - this.lastRouteTime >= this.ROUTE_THROTTLE) {
                this.lastRouteTime = now
                ctx.currentElement.points = computeOrthoRoute(dx, dy, sSide, eSide, sRect, eRect)
            }
        }

        // Always render to show anchor hover feedback
        ctx.render()
    }

    onMouseUp(_ctx: DrawingContext) {
        // Arrow uses click-to-connect, not drag — no release logic needed
    }

    onKeyDown(ctx: DrawingContext, e: KeyboardEvent): boolean {
        if (e.key === 'Escape' && this.s.pending) {
            this.s.pending = null
            ctx.currentElement = null
            ctx.render()
            return true
        }
        return false
    }

    renderOverlay(_ctx: DrawingContext): string {
        return renderAnchors(this.s.hoveredElement, this.s.hoveredAnchor, getAnchors)
    }
}
