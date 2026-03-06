import { DASHBOARD_COLS, DASHBOARD_ROW_HEIGHT } from '../constants'

export interface Rect {
    x: number
    y: number
    w: number
    h: number
}

/** Check if two rectangles intersect (AABB collision) */
export function intersects(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y
}

/** Snap position and size to the dashboard grid */
export function dashboardSnap(x: number, y: number, w: number, h: number, colW: number): Rect {
    const minW = 2 * colW
    const minH = 2 * DASHBOARD_ROW_HEIGHT
    return {
        x: Math.round(x / colW) * colW,
        y: Math.round(y / DASHBOARD_ROW_HEIGHT) * DASHBOARD_ROW_HEIGHT,
        w: Math.max(minW, Math.round(w / colW) * colW),
        h: Math.max(minH, Math.round(h / DASHBOARD_ROW_HEIGHT) * DASHBOARD_ROW_HEIGHT),
    }
}

/**
 * Find the next free position on the dashboard grid.
 * Scans top-left → bottom-right (ported from Go NextPosition in layout.go).
 */
export function nextPosition(existing: Rect[], newW: number, newH: number, colW: number): { x: number; y: number } {
    if (existing.length === 0) return { x: 0, y: 0 }

    const maxRowW = DASHBOARD_COLS * colW

    for (let y = 0; y < 100000; y += DASHBOARD_ROW_HEIGHT) {
        for (let x = 0; x + newW <= maxRowW; x += colW) {
            const candidate: Rect = { x, y, w: newW, h: newH }
            const overlaps = existing.some(occ => intersects(candidate, occ))
            if (!overlaps) return { x, y }
        }
    }

    // Fallback: place below all existing blocks
    let maxY = 0
    for (const b of existing) {
        const bottom = b.y + b.h
        if (bottom > maxY) maxY = bottom
    }
    return { x: 0, y: Math.round(maxY / DASHBOARD_ROW_HEIGHT) * DASHBOARD_ROW_HEIGHT }
}

/** Clamp x so the block stays within the grid (0 ≤ x ≤ maxRowW - blockW) */
export function clampX(x: number, blockW: number, colW: number): number {
    const maxRowW = DASHBOARD_COLS * colW
    if (x < 0) return 0
    if (x + blockW > maxRowW) return maxRowW - blockW
    return x
}
