import { type DrawingElement, type AnchorPoint, type AnchorSide, type AnchorableRect, type Connection, isArrowType } from './types'
import { computeOrthoRoute, enforceOrthogonality, type Rect } from './ortho'
import { type DrawingEngine, SHAPE_IDS } from './drawing-wasm'

const getEngine = (): DrawingEngine | null => (globalThis as any).__drawingEngine ?? null

/** Get anchor points for a shape element */
export function getAnchors(el: DrawingElement): AnchorPoint[] {
    if (el.type === 'line' || el.type === 'arrow' || el.type === 'ortho-arrow' ||
        el.type === 'freedraw' || el.type === 'text' || el.type === 'group') return []

    const engine = getEngine()
    if (engine && SHAPE_IDS[el.type] !== undefined) {
        try {
            const wasmAnchors = engine.getAnchors(el.type, el.width, el.height)
            return wasmAnchors.map(a => ({
                elementId: el.id,
                side: a.side as AnchorSide,
                t: a.t,
                x: el.x + a.x,
                y: el.y + a.y,
            }))
        } catch { /* WASM error */ }
    }

    return []
}

/** Resolve a connection to world coordinates (checks both drawing elements and optional block rects) */
export function resolveAnchor(elements: DrawingElement[], conn: Connection, blockRects?: AnchorableRect[]): { x: number; y: number } | null {
    const el = elements.find(e => e.id === conn.elementId)
    const rect: { x: number; y: number; width: number; height: number } | undefined =
        el ?? blockRects?.find(r => r.id === conn.elementId)
    if (!rect) return null
    switch (conn.side) {
        case 'top': return { x: rect.x + rect.width * conn.t, y: rect.y }
        case 'bottom': return { x: rect.x + rect.width * conn.t, y: rect.y + rect.height }
        case 'left': return { x: rect.x, y: rect.y + rect.height * conn.t }
        case 'right': return { x: rect.x + rect.width, y: rect.y + rect.height * conn.t }
    }
}

/** Get rectangular anchors for a simple rect (DOM blocks) — no WASM needed */
export function getAnchorsForRect(rect: AnchorableRect): AnchorPoint[] {
    return [
        { elementId: rect.id, side: 'top',    t: 0.5, x: rect.x + rect.width / 2, y: rect.y },
        { elementId: rect.id, side: 'bottom', t: 0.5, x: rect.x + rect.width / 2, y: rect.y + rect.height },
        { elementId: rect.id, side: 'left',   t: 0.5, x: rect.x,                  y: rect.y + rect.height / 2 },
        { elementId: rect.id, side: 'right',  t: 0.5, x: rect.x + rect.width,     y: rect.y + rect.height / 2 },
    ]
}

/** Find nearest anchor to a point (searches both drawing elements and optional DOM block rects) */
export function findNearestAnchor(elements: DrawingElement[], x: number, y: number, excludeId?: string, blockRects?: AnchorableRect[]): AnchorPoint | null {
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

    // Also check DOM block rects
    if (blockRects) {
        for (const rect of blockRects) {
            if (rect.id === excludeId) continue
            const margin = bestDist + 10
            if (x < rect.x - margin || x > rect.x + rect.width + margin ||
                y < rect.y - margin || y > rect.y + rect.height + margin) continue
            for (const a of getAnchorsForRect(rect)) {
                const d = Math.hypot(x - a.x, y - a.y)
                if (d < bestDist) {
                    bestDist = d
                    best = a
                }
            }
        }
    }

    return best
}

/** Update arrows connected to a moved element (drawing shape or DOM block).
 *  Rebuilds path via computeOrthoRoute with nearby shapes as obstacles.
 */
export function updateConnectedArrows(elements: DrawingElement[], movedElementId: string, blockRects?: AnchorableRect[]) {
    // Shapes list for lookups (computed once, filtering done per-arrow)
    const shapeElements = elements.filter(e => !isArrowType(e) && e.type !== 'group')

    for (const el of elements) {
        if (!isArrowType(el)) continue

        const startMoved = el.startConnection?.elementId === movedElementId
        const endMoved = el.endConnection?.elementId === movedElementId
        if (!startMoved && !endMoved) continue

        // Resolve current anchor positions (check both drawing elements and block rects)
        const startPt = el.startConnection ? resolveAnchor(elements, el.startConnection, blockRects) : null
        const endPt = el.endConnection ? resolveAnchor(elements, el.endConnection, blockRects) : null

        // Determine absolute start/end positions — recover from corrupted/empty points
        const hasValidPoints = el.points && el.points.length >= 2
        const absStart = startPt ?? (hasValidPoints
            ? { x: el.x + el.points![0][0], y: el.y + el.points![0][1] }
            : { x: el.x, y: el.y })
        const absEnd = endPt ?? (hasValidPoints
            ? { x: el.x + el.points![el.points!.length - 1][0], y: el.y + el.points![el.points!.length - 1][1] }
            : { x: el.x + el.width, y: el.y + el.height })

        // Update arrow origin to new start
        el.x = absStart.x
        el.y = absStart.y

        if (el.type === 'ortho-arrow') {
            const dx = absEnd.x - absStart.x
            const dy = absEnd.y - absStart.y

            // Build obstacle rects relative to arrow origin (all shapes except src/dst)
            // Search both drawing elements and block rects for connected entities
            const findRect = (id?: string): Rect | undefined => {
                if (!id) return undefined
                const s = shapeElements.find(e => e.id === id)
                if (s) return { x: s.x - absStart.x, y: s.y - absStart.y, w: s.width, h: s.height }
                const b = blockRects?.find(r => r.id === id)
                if (b) return { x: b.x - absStart.x, y: b.y - absStart.y, w: b.width, h: b.height }
                return undefined
            }
            const sR = findRect(el.startConnection?.elementId)
            const eR = findRect(el.endConnection?.elementId)

            // Collect nearby shapes + blocks as obstacles (spatial filter by route corridor)
            const excludeIds = new Set([el.startConnection?.elementId, el.endConnection?.elementId].filter(Boolean))
            const margin = 200
            const minWx = absStart.x + Math.min(0, dx) - margin
            const maxWx = absStart.x + Math.max(0, dx) + margin
            const minWy = absStart.y + Math.min(0, dy) - margin
            const maxWy = absStart.y + Math.max(0, dy) + margin

            const obstacleRects: Rect[] = []
            for (const e of shapeElements) {
                if (excludeIds.has(e.id)) continue
                if (e.x + e.width < minWx || e.x > maxWx || e.y + e.height < minWy || e.y > maxWy) continue
                obstacleRects.push({ x: e.x - absStart.x, y: e.y - absStart.y, w: e.width, h: e.height })
            }
            if (blockRects) {
                for (const r of blockRects) {
                    if (excludeIds.has(r.id)) continue
                    if (r.x + r.width < minWx || r.x > maxWx || r.y + r.height < minWy || r.y > maxWy) continue
                    obstacleRects.push({ x: r.x - absStart.x, y: r.y - absStart.y, w: r.width, h: r.height })
                }
            }

            el.points = computeOrthoRoute(dx, dy, el.startConnection?.side, el.endConnection?.side, sR, eR, obstacleRects)
            enforceOrthogonality(el)
        } else {
            // Simple arrow — just update endpoints
            if (!el.points || el.points.length < 2) {
                el.points = [[0, 0], [absEnd.x - absStart.x, absEnd.y - absStart.y]]
            } else {
                el.points[0] = [0, 0]
                el.points[el.points.length - 1] = [absEnd.x - absStart.x, absEnd.y - absStart.y]
            }
        }

        // Compute width/height from actual path bounds (not just last point)
        let maxPx = 0, maxPy = 0
        for (const p of el.points!) {
            const apx = Math.abs(p[0]), apy = Math.abs(p[1])
            if (apx > maxPx) maxPx = apx
            if (apy > maxPy) maxPy = apy
        }
        el.width = maxPx
        el.height = maxPy
    }
}
