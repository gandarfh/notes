import { type DrawingElement, type AnchorPoint, type AnchorSide, type Connection, GRID, isArrowType } from './types'
import { computeOrthoRoute, enforceOrthogonality, type Rect } from './ortho'

/** Get anchor points for a shape element */
export function getAnchors(el: DrawingElement): AnchorPoint[] {
    if (el.type === 'line' || el.type === 'arrow' || el.type === 'ortho-arrow' ||
        el.type === 'freedraw' || el.type === 'text') return []

    const anchors: AnchorPoint[] = []
    const sides: { side: AnchorSide; x1: number; y1: number; x2: number; y2: number }[] = [
        { side: 'top', x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y },
        { side: 'bottom', x1: el.x, y1: el.y + el.height, x2: el.x + el.width, y2: el.y + el.height },
        { side: 'left', x1: el.x, y1: el.y, x2: el.x, y2: el.y + el.height },
        { side: 'right', x1: el.x + el.width, y1: el.y, x2: el.x + el.width, y2: el.y + el.height },
    ]

    for (const s of sides) {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
        const count = Math.max(1, Math.floor(len / GRID))
        for (let i = 0; i <= count; i++) {
            const t = count === 0 ? 0.5 : i / count
            anchors.push({
                elementId: el.id, side: s.side, t,
                x: s.x1 + (s.x2 - s.x1) * t,
                y: s.y1 + (s.y2 - s.y1) * t,
            })
        }
    }
    return anchors
}

/** Resolve a connection to world coordinates */
export function resolveAnchor(elements: DrawingElement[], conn: Connection): { x: number; y: number } | null {
    const el = elements.find(e => e.id === conn.elementId)
    if (!el) return null
    switch (conn.side) {
        case 'top': return { x: el.x + el.width * conn.t, y: el.y }
        case 'bottom': return { x: el.x + el.width * conn.t, y: el.y + el.height }
        case 'left': return { x: el.x, y: el.y + el.height * conn.t }
        case 'right': return { x: el.x + el.width, y: el.y + el.height * conn.t }
    }
}

/** Find nearest anchor to a point */
export function findNearestAnchor(elements: DrawingElement[], x: number, y: number, excludeId?: string): AnchorPoint | null {
    let best: AnchorPoint | null = null
    let bestDist = 20 // max snap distance

    for (const el of elements) {
        if (el.id === excludeId) continue
        // Early-exit: skip elements whose bounding box is too far
        const margin = bestDist + 10
        if (x < el.x - margin || x > el.x + el.width + margin ||
            y < el.y - margin || y > el.y + el.height + margin) continue
        for (const a of getAnchors(el)) {
            const d = Math.hypot(x - a.x, y - a.y)
            if (d < bestDist) {
                bestDist = d
                best = a
            }
        }
    }
    return best
}

/** Update arrows connected to a moved element.
 *  Always does a full path rebuild via computeOrthoRoute with all shapes as obstacles.
 */
export function updateConnectedArrows(elements: DrawingElement[], movedElementId: string) {
    // Collect all non-arrow shape rects once (reused for every arrow)
    const shapeElements = elements.filter(e => !isArrowType(e))

    for (const el of elements) {
        if (!isArrowType(el)) continue

        const startMoved = el.startConnection?.elementId === movedElementId
        const endMoved = el.endConnection?.elementId === movedElementId
        if (!startMoved && !endMoved) continue
        if (!el.points || el.points.length < 2) continue

        // Resolve current anchor positions
        const startPt = el.startConnection ? resolveAnchor(elements, el.startConnection) : null
        const endPt = el.endConnection ? resolveAnchor(elements, el.endConnection) : null

        // Determine absolute start/end positions
        const absStart = startPt ?? { x: el.x + el.points[0][0], y: el.y + el.points[0][1] }
        const absEnd = endPt ?? { x: el.x + el.points[el.points.length - 1][0], y: el.y + el.points[el.points.length - 1][1] }

        // Update arrow origin to new start
        el.x = absStart.x
        el.y = absStart.y

        if (el.type === 'ortho-arrow') {
            const dx = absEnd.x - absStart.x
            const dy = absEnd.y - absStart.y

            // Build obstacle rects relative to arrow origin (all shapes, not just start/end)
            const sR: Rect | undefined = el.startConnection
                ? (() => { const s = shapeElements.find(e => e.id === el.startConnection!.elementId); return s ? { x: s.x - absStart.x, y: s.y - absStart.y, w: s.width, h: s.height } : undefined })()
                : undefined
            const eR: Rect | undefined = el.endConnection
                ? (() => { const s = shapeElements.find(e => e.id === el.endConnection!.elementId); return s ? { x: s.x - absStart.x, y: s.y - absStart.y, w: s.width, h: s.height } : undefined })()
                : undefined

            el.points = computeOrthoRoute(dx, dy, el.startConnection?.side, el.endConnection?.side, sR, eR)
            enforceOrthogonality(el)
        } else {
            // Simple arrow — just update endpoints
            el.points[0] = [0, 0]
            el.points[el.points.length - 1] = [absEnd.x - absStart.x, absEnd.y - absStart.y]
        }

        el.width = Math.abs((el.points[el.points.length - 1]?.[0] ?? 0))
        el.height = Math.abs((el.points[el.points.length - 1]?.[1] ?? 0))
    }
}
