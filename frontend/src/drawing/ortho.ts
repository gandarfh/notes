/**
 * Orthogonal Connector Routing — WASM delegate + TS utilities
 *
 * The heavy Dijkstra routing is implemented in Go/WASM (ComputeOrthoRoute).
 * This module provides:
 *  - computeOrthoRoute() — thin wrapper that delegates to WASM binary protocol
 *  - simplifyOrthoPoints() — remove collinear waypoints (TS-only, for manual editing)
 *  - enforceOrthogonality() — snap segments to axis-aligned (TS-only, for manual editing)
 */
import { type AnchorSide, type DrawingElement } from './types'
import type { DrawingEngine } from './drawing-wasm'

export interface Rect { x: number; y: number; w: number; h: number }

// ── WASM-backed orthogonal routing ────────────────────────

const getEngine = (): DrawingEngine | null => (globalThis as any).__drawingEngine ?? null

/**
 * Compute an orthogonal arrow route from (0,0) to (dx,dy).
 * Delegates to Go/WASM binary protocol for ~0.05ms performance.
 * Falls back to a simple L-shaped route if WASM is not loaded.
 */
export function computeOrthoRoute(
    dx: number, dy: number,
    startSide?: AnchorSide, endSide?: AnchorSide,
    startRect?: Rect, endRect?: Rect,
    allObstacles?: Rect[],
): number[][] {
    const engine = getEngine()
    if (engine) {
        try {
            const result = engine.computeOrthoRouteBin(dx, dy, {
                startSide, endSide, startRect, endRect,
                shapeObstacles: allObstacles,
            })
            if (result.length >= 2) return result
            // WASM returned degenerate route — fall through to L-shape fallback
        } catch { /* fall through to fallback */ }
    }

    // Fallback: simple L-shape (no WASM available)
    if (Math.abs(dx) > Math.abs(dy)) {
        return [[0, 0], [dx / 2, 0], [dx / 2, dy], [dx, dy]]
    }
    return [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]]
}

// ── Utilities for manual editing ──────────────────────────

/** Remove redundant collinear waypoints from ortho-arrow */
export function simplifyOrthoPoints(el: DrawingElement): void {
    if (!el.points || el.points.length < 3) return
    let i = 0
    while (i < el.points.length - 2) {
        const a = el.points[i], b = el.points[i + 1], c = el.points[i + 2]
        const sameX = Math.abs(a[0] - b[0]) < 1 && Math.abs(b[0] - c[0]) < 1
        const sameY = Math.abs(a[1] - b[1]) < 1 && Math.abs(b[1] - c[1]) < 1
        if (sameX || sameY) {
            el.points.splice(i + 1, 1)
        } else {
            i++
        }
    }
}

/** Ensure every segment is strictly horizontal or vertical */
export function enforceOrthogonality(el: DrawingElement): void {
    if (!el.points || el.points.length < 2) return
    for (let i = 0; i < el.points.length - 1; i++) {
        const a = el.points[i], b = el.points[i + 1]
        const adx = Math.abs(a[0] - b[0])
        const ady = Math.abs(a[1] - b[1])
        if (adx > 0.5 && ady > 0.5) {
            if (adx <= ady) {
                b[0] = a[0]
            } else {
                b[1] = a[1]
            }
        }
    }
}
