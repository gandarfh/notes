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

/** Update arrows connected to a moved element */
export function updateConnectedArrows(elements: DrawingElement[], movedElementId: string) {
    for (const el of elements) {
        if (!isArrowType(el)) continue
        let changed = false

        if (el.startConnection?.elementId === movedElementId) {
            const pt = resolveAnchor(elements, el.startConnection)
            if (pt && el.points && el.points.length >= 2) {
                if (el.type === 'ortho-arrow' && el.points.length > 3) {
                    // Preserve custom routing — only move start point
                    const oldStartAbs = { x: el.x + el.points[0][0], y: el.y + el.points[0][1] }
                    el.x = pt.x; el.y = pt.y
                    for (const p of el.points) {
                        p[0] = p[0] + oldStartAbs.x - pt.x
                        p[1] = p[1] + oldStartAbs.y - pt.y
                    }
                    el.points[0] = [0, 0]
                    if (el.points.length >= 2) {
                        const p1 = el.points[1]
                        if (Math.abs(el.points[0][1] - p1[1]) > 1) {
                            p1[0] = 0
                        }
                    }
                } else {
                    // Simple arrow or basic 3-point ortho — rebuild
                    const endAbs = { x: el.x + el.points[el.points.length - 1][0], y: el.y + el.points[el.points.length - 1][1] }
                    el.x = pt.x; el.y = pt.y
                    el.points[0] = [0, 0]
                    if (el.type === 'ortho-arrow') {
                        const dx = endAbs.x - pt.x, dy = endAbs.y - pt.y
                        const sEl = elements.find(e => e.id === el.startConnection?.elementId)
                        const eEl = elements.find(e => e.id === el.endConnection?.elementId)
                        const sR: Rect | undefined = sEl ? { x: sEl.x - pt.x, y: sEl.y - pt.y, w: sEl.width, h: sEl.height } : undefined
                        const eR: Rect | undefined = eEl ? { x: eEl.x - pt.x, y: eEl.y - pt.y, w: eEl.width, h: eEl.height } : undefined
                        el.points = computeOrthoRoute(dx, dy, el.startConnection?.side, el.endConnection?.side, sR, eR)
                    } else {
                        el.points[el.points.length - 1] = [endAbs.x - pt.x, endAbs.y - pt.y]
                    }
                }
                changed = true
            }
        }

        if (el.endConnection?.elementId === movedElementId) {
            const pt = resolveAnchor(elements, el.endConnection)
            if (pt && el.points) {
                if (el.type === 'ortho-arrow' && el.points.length > 3) {
                    // Preserve custom routing — only move end point
                    const lastIdx = el.points.length - 1
                    const newEndRel = [pt.x - el.x, pt.y - el.y]
                    el.points[lastIdx] = newEndRel
                    if (lastIdx >= 2) {
                        const pPrev = el.points[lastIdx - 1]
                        if (Math.abs(pPrev[1] - newEndRel[1]) > 1) {
                            pPrev[0] = newEndRel[0]
                        } else {
                            pPrev[1] = newEndRel[1]
                        }
                    }
                } else {
                    // Simple arrow or basic 3-point ortho — rebuild
                    if (el.type === 'ortho-arrow') {
                        const dx = pt.x - el.x, dy = pt.y - el.y
                        const sEl = elements.find(e => e.id === el.startConnection?.elementId)
                        const eEl = elements.find(e => e.id === el.endConnection?.elementId)
                        const sR: Rect | undefined = sEl ? { x: sEl.x - el.x, y: sEl.y - el.y, w: sEl.width, h: sEl.height } : undefined
                        const eR: Rect | undefined = eEl ? { x: eEl.x - el.x, y: eEl.y - el.y, w: eEl.width, h: eEl.height } : undefined
                        el.points = computeOrthoRoute(dx, dy, el.startConnection?.side, el.endConnection?.side, sR, eR)
                    } else if (el.points.length >= 2) {
                        el.points[el.points.length - 1] = [pt.x - el.x, pt.y - el.y]
                    }
                }
                changed = true
            }
        }

        if (changed) {
            if (el.type === 'ortho-arrow') enforceOrthogonality(el)
            el.width = Math.abs((el.points?.[el.points.length - 1]?.[0] ?? 0))
            el.height = Math.abs((el.points?.[el.points.length - 1]?.[1] ?? 0))
        }
    }
}
