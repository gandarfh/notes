import { type DrawingElement, type ResizeHandle, isArrowType } from './types'

/** Point-to-segment distance */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(px - ax, py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function isPointInElement(x: number, y: number, el: DrawingElement): boolean {
    const m = 8
    if (el.type === 'text') {
        const tw = (el.text?.length ?? 0) * (el.fontSize ?? 16) * 0.6
        return x >= el.x - m && x <= el.x + tw + m && y >= el.y - (el.fontSize ?? 16) && y <= el.y + m
    }
    if (el.type === 'freedraw' && el.points) {
        for (const p of el.points) {
            if (Math.hypot(x - (el.x + p[0]), y - (el.y + p[1])) < m + el.strokeWidth) return true
        }
        return false
    }
    if ((el.type === 'line' || el.type === 'arrow') && el.points && el.points.length >= 2) {
        return segDist(x, y, el.x + el.points[0][0], el.y + el.points[0][1],
            el.x + el.points[1][0], el.y + el.points[1][1]) < m + el.strokeWidth
    }
    if (el.type === 'ortho-arrow' && el.points && el.points.length >= 2) {
        for (let i = 0; i < el.points.length - 1; i++) {
            if (segDist(x, y, el.x + el.points[i][0], el.y + el.points[i][1],
                el.x + el.points[i + 1][0], el.y + el.points[i + 1][1]) < m + el.strokeWidth) return true
        }
        return false
    }
    return x >= el.x - m && x <= el.x + el.width + m && y >= el.y - m && y <= el.y + el.height + m
}

export function hitTest(elements: DrawingElement[], x: number, y: number): DrawingElement | null {
    for (let i = elements.length - 1; i >= 0; i--) {
        if (isPointInElement(x, y, elements[i])) return elements[i]
    }
    return null
}

export function hitTestHandle(x: number, y: number, el: DrawingElement): ResizeHandle | null {
    if (isArrowType(el) || el.type === 'freedraw' || el.type === 'text' || el.type === 'line') return null
    const r = 6
    const handles: { handle: ResizeHandle; hx: number; hy: number }[] = [
        { handle: 'nw', hx: el.x, hy: el.y },
        { handle: 'n', hx: el.x + el.width / 2, hy: el.y },
        { handle: 'ne', hx: el.x + el.width, hy: el.y },
        { handle: 'e', hx: el.x + el.width, hy: el.y + el.height / 2 },
        { handle: 'se', hx: el.x + el.width, hy: el.y + el.height },
        { handle: 's', hx: el.x + el.width / 2, hy: el.y + el.height },
        { handle: 'sw', hx: el.x, hy: el.y + el.height },
        { handle: 'w', hx: el.x, hy: el.y + el.height / 2 },
    ]
    for (const h of handles) {
        if (Math.hypot(x - h.hx, y - h.hy) <= r) return h.handle
    }
    return null
}

export function hitTestArrowEndpoint(x: number, y: number, el: DrawingElement): 'start' | 'end' | null {
    if (!el.points || el.points.length < 2) return null
    const r = 8
    const sx = el.x + el.points[0][0], sy = el.y + el.points[0][1]
    if (Math.hypot(x - sx, y - sy) <= r) return 'start'
    const last = el.points[el.points.length - 1]
    const ex = el.x + last[0], ey = el.y + last[1]
    if (Math.hypot(x - ex, y - ey) <= r) return 'end'
    return null
}

export function hitTestSegmentMidpoint(x: number, y: number, el: DrawingElement): number | null {
    if (!el.points || el.points.length < 3) return null
    const r = 8
    for (let i = 0; i < el.points.length - 1; i++) {
        const mx = el.x + (el.points[i][0] + el.points[i + 1][0]) / 2
        const my = el.y + (el.points[i][1] + el.points[i + 1][1]) / 2
        if (Math.hypot(x - mx, y - my) <= r) return i
    }
    return null
}

/** Find which segment of an ortho-arrow the point is closest to (within threshold) */
export function findNearestSegment(x: number, y: number, el: DrawingElement): number | null {
    if (!el.points || el.points.length < 2) return null
    const threshold = 12
    let best: number | null = null
    let bestDist = threshold

    for (let i = 0; i < el.points.length - 1; i++) {
        const ax = el.x + el.points[i][0], ay = el.y + el.points[i][1]
        const bx = el.x + el.points[i + 1][0], by = el.y + el.points[i + 1][1]
        const dx = bx - ax, dy = by - ay
        const lenSq = dx * dx + dy * dy
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq))
        const px = ax + t * dx, py = ay + t * dy
        const d = Math.hypot(x - px, y - py)
        if (d < bestDist) { bestDist = d; best = i }
    }
    return best
}
