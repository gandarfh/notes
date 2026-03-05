import { describe, it, expect } from 'vitest'
import {
    intersects,
    dashboardSnap,
    nextPosition,
    clampX,
    type Rect,
} from '../dashboardLayout'
import { DASHBOARD_COLS, DASHBOARD_ROW_HEIGHT } from '../../constants'

// ── intersects ───────────────────────────────────────────────

describe('intersects', () => {
    it('detects partial overlap', () => {
        const a: Rect = { x: 0, y: 0, w: 100, h: 100 }
        const b: Rect = { x: 50, y: 50, w: 100, h: 100 }
        expect(intersects(a, b)).toBe(true)
    })

    it('returns false for adjacent rects (touching edge)', () => {
        const a: Rect = { x: 0, y: 0, w: 100, h: 100 }
        const b: Rect = { x: 100, y: 0, w: 100, h: 100 }
        expect(intersects(a, b)).toBe(false)
    })

    it('detects when one rect is fully contained inside another', () => {
        const outer: Rect = { x: 0, y: 0, w: 200, h: 200 }
        const inner: Rect = { x: 50, y: 50, w: 50, h: 50 }
        expect(intersects(outer, inner)).toBe(true)
        expect(intersects(inner, outer)).toBe(true)
    })

    it('returns false when rects are far apart', () => {
        const a: Rect = { x: 0, y: 0, w: 50, h: 50 }
        const b: Rect = { x: 500, y: 500, w: 50, h: 50 }
        expect(intersects(a, b)).toBe(false)
    })

    it('detects same position and size', () => {
        const a: Rect = { x: 10, y: 10, w: 100, h: 100 }
        expect(intersects(a, { ...a })).toBe(true)
    })

    it('returns false for vertically adjacent rects', () => {
        const a: Rect = { x: 0, y: 0, w: 100, h: 60 }
        const b: Rect = { x: 0, y: 60, w: 100, h: 60 }
        expect(intersects(a, b)).toBe(false)
    })
})

// ── dashboardSnap ────────────────────────────────────────────

describe('dashboardSnap', () => {
    const colW = 100

    it('snaps position to nearest grid cell', () => {
        const r = dashboardSnap(110, 70, 200, 120, colW)
        expect(r.x).toBe(100)
        expect(r.y).toBe(60)
    })

    it('snaps size to nearest grid cell', () => {
        const r = dashboardSnap(0, 0, 250, 170, colW)
        expect(r.w).toBe(300)
        expect(r.h).toBe(180)
    })

    it('enforces minimum 2 columns width', () => {
        const r = dashboardSnap(0, 0, 50, 200, colW)
        expect(r.w).toBe(200)
    })

    it('enforces minimum 2 rows height', () => {
        const r = dashboardSnap(0, 0, 300, 30, colW)
        expect(r.h).toBe(2 * DASHBOARD_ROW_HEIGHT)
    })

    it('works with different container widths', () => {
        const narrowColW = 80
        const r = dashboardSnap(45, 35, 160, 120, narrowColW)
        expect(r.x).toBe(80)
        expect(r.y).toBe(60)
        expect(r.w).toBe(160)
        expect(r.h).toBe(120)
    })
})

// ── nextPosition ─────────────────────────────────────────────

describe('nextPosition', () => {
    const colW = 100

    it('places first block at (0,0) when no existing blocks', () => {
        const pos = nextPosition([], 200, 120, colW)
        expect(pos).toEqual({ x: 0, y: 0 })
    })

    it('places second block next to the first', () => {
        const existing: Rect[] = [{ x: 0, y: 0, w: 200, h: 120 }]
        const pos = nextPosition(existing, 200, 120, colW)
        expect(pos.x).toBe(200)
        expect(pos.y).toBe(0)
    })

    it('wraps to next row when no space in current row', () => {
        const existing: Rect[] = [{ x: 0, y: 0, w: 1200, h: 120 }]
        const pos = nextPosition(existing, 200, 120, colW)
        expect(pos.x).toBe(0)
        expect(pos.y).toBe(120)
    })

    it('finds gap between blocks', () => {
        const existing: Rect[] = [
            { x: 0, y: 0, w: 200, h: 120 },
            { x: 400, y: 0, w: 200, h: 120 },
        ]
        const pos = nextPosition(existing, 200, 120, colW)
        expect(pos.x).toBe(200)
        expect(pos.y).toBe(0)
    })

    it('handles multiple rows of blocks', () => {
        const existing: Rect[] = [
            { x: 0, y: 0, w: 1200, h: 120 },
            { x: 0, y: 120, w: 1200, h: 120 },
        ]
        const pos = nextPosition(existing, 200, 120, colW)
        expect(pos.y).toBe(240)
    })

    it('does not place block exceeding row width', () => {
        const existing: Rect[] = [{ x: 0, y: 0, w: 1000, h: 120 }]
        const pos = nextPosition(existing, 600, 120, colW)
        expect(pos.y).toBe(120)
        expect(pos.x).toBe(0)
    })
})

// ── clampX ──────────────────────────────────────────────────

describe('clampX', () => {
    const colW = 100

    it('clamps negative x to 0', () => {
        expect(clampX(-50, 200, colW)).toBe(0)
    })

    it('clamps x so block does not exceed right edge', () => {
        expect(clampX(1100, 200, colW)).toBe(1000)
    })

    it('returns x unchanged when within bounds', () => {
        expect(clampX(300, 200, colW)).toBe(300)
    })

    it('clamps at x=0 for a full-width block', () => {
        const maxRowW = DASHBOARD_COLS * colW
        expect(clampX(50, maxRowW, colW)).toBe(0)
    })
})
