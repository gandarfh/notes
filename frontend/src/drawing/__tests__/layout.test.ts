import { describe, it, expect } from 'vitest'
import { alignElements, reorderElements, screenToWorld, worldToScreen } from '../layout'
import { makeElement } from './fixtures'

// ── alignElements ────────────────────────────────────────

describe('alignElements', () => {
    it('noop for fewer than 2 elements', () => {
        const a = makeElement({ id: 'a', x: 10 })
        alignElements([a], 'align-left')
        expect(a.x).toBe(10)
    })

    it('align-left: moves all to leftmost x', () => {
        const a = makeElement({ id: 'a', x: 100, width: 50 })
        const b = makeElement({ id: 'b', x: 200, width: 50 })
        const c = makeElement({ id: 'c', x: 50, width: 50 })
        alignElements([a, b, c], 'align-left')
        expect(a.x).toBe(50)
        expect(b.x).toBe(50)
        expect(c.x).toBe(50)
    })

    it('align-right: moves all to rightmost edge', () => {
        const a = makeElement({ id: 'a', x: 0, width: 50 })
        const b = makeElement({ id: 'b', x: 100, width: 80 })
        alignElements([a, b], 'align-right')
        // rightmost = max(0+50, 100+80) = 180
        expect(a.x + a.width).toBe(180)
        expect(b.x + b.width).toBe(180)
    })

    it('align-center-h: centers horizontally', () => {
        const a = makeElement({ id: 'a', x: 0, width: 100 })
        const b = makeElement({ id: 'b', x: 200, width: 100 })
        alignElements([a, b], 'align-center-h')
        // centers: a=50, b=250 → avg=150
        expect(a.x + a.width / 2).toBeCloseTo(150)
        expect(b.x + b.width / 2).toBeCloseTo(150)
    })

    it('align-top: moves all to topmost y', () => {
        const a = makeElement({ id: 'a', y: 100 })
        const b = makeElement({ id: 'b', y: 50 })
        alignElements([a, b], 'align-top')
        expect(a.y).toBe(50)
        expect(b.y).toBe(50)
    })

    it('align-bottom: moves all to bottommost edge', () => {
        const a = makeElement({ id: 'a', y: 0, height: 50 })
        const b = makeElement({ id: 'b', y: 100, height: 80 })
        alignElements([a, b], 'align-bottom')
        expect(a.y + a.height).toBe(180)
        expect(b.y + b.height).toBe(180)
    })

    it('align-center-v: centers vertically', () => {
        const a = makeElement({ id: 'a', y: 0, height: 100 })
        const b = makeElement({ id: 'b', y: 200, height: 100 })
        alignElements([a, b], 'align-center-v')
        expect(a.y + a.height / 2).toBeCloseTo(150)
        expect(b.y + b.height / 2).toBeCloseTo(150)
    })

    it('distribute-h: evenly spaces 3+ elements', () => {
        const a = makeElement({ id: 'a', x: 0, width: 40 })
        const b = makeElement({ id: 'b', x: 100, width: 40 })
        const c = makeElement({ id: 'c', x: 200, width: 40 })
        alignElements([a, b, c], 'distribute-h')
        // Container: 0 to 240 = 240, total widths = 120, gap = (240-120)/2 = 60
        // a stays at 0, b at 0+40+60=100, c stays at 200
        expect(a.x).toBe(0)
        expect(b.x).toBe(100)
        expect(c.x).toBe(200)
    })

    it('distribute-h: noop for fewer than 3', () => {
        const a = makeElement({ id: 'a', x: 0 })
        const b = makeElement({ id: 'b', x: 100 })
        alignElements([a, b], 'distribute-h')
        expect(a.x).toBe(0)
        expect(b.x).toBe(100)
    })

    it('distribute-v: evenly spaces 3+ elements', () => {
        const a = makeElement({ id: 'a', y: 0, height: 30 })
        const b = makeElement({ id: 'b', y: 50, height: 30 })
        const c = makeElement({ id: 'c', y: 200, height: 30 })
        alignElements([a, b, c], 'distribute-v')
        // Container: 0 to 230 = 230, total heights = 90, gap = (230-90)/2 = 70
        expect(a.y).toBe(0)          // first stays
        expect(b.y).toBe(100)        // 0 + 30 + 70
        expect(c.y).toBe(200)        // last stays
    })
})

// ── reorderElements ──────────────────────────────────────

describe('reorderElements', () => {
    const a = makeElement({ id: 'a' })
    const b = makeElement({ id: 'b' })
    const c = makeElement({ id: 'c' })
    const d = makeElement({ id: 'd' })

    it('toBack: selected elements move to start', () => {
        const result = reorderElements([a, b, c, d], new Set(['c']), 'toBack')
        expect(result.map(e => e.id)).toEqual(['c', 'a', 'b', 'd'])
    })

    it('toFront: selected elements move to end', () => {
        const result = reorderElements([a, b, c, d], new Set(['a']), 'toFront')
        expect(result.map(e => e.id)).toEqual(['b', 'c', 'd', 'a'])
    })

    it('backward: selected element swaps with previous non-selected', () => {
        const result = reorderElements([a, b, c, d], new Set(['c']), 'backward')
        expect(result.map(e => e.id)).toEqual(['a', 'c', 'b', 'd'])
    })

    it('backward: noop if already at start', () => {
        const result = reorderElements([a, b, c], new Set(['a']), 'backward')
        expect(result.map(e => e.id)).toEqual(['a', 'b', 'c'])
    })

    it('forward: selected element swaps with next non-selected', () => {
        const result = reorderElements([a, b, c, d], new Set(['b']), 'forward')
        expect(result.map(e => e.id)).toEqual(['a', 'c', 'b', 'd'])
    })

    it('forward: noop if already at end', () => {
        const result = reorderElements([a, b, c], new Set(['c']), 'forward')
        expect(result.map(e => e.id)).toEqual(['a', 'b', 'c'])
    })

    it('noop for empty selection', () => {
        const result = reorderElements([a, b, c], new Set(), 'toFront')
        expect(result.map(e => e.id)).toEqual(['a', 'b', 'c'])
    })

    it('multi-select toFront', () => {
        const result = reorderElements([a, b, c, d], new Set(['a', 'c']), 'toFront')
        expect(result.map(e => e.id)).toEqual(['b', 'd', 'a', 'c'])
    })
})

// ── Coordinate conversions ───────────────────────────────

describe('screenToWorld', () => {
    it('converts at zoom 1 with no pan', () => {
        const result = screenToWorld(100, 200, { x: 0, y: 0, zoom: 1 })
        expect(result).toEqual({ x: 100, y: 200 })
    })

    it('accounts for pan offset', () => {
        const result = screenToWorld(150, 250, { x: 50, y: 50, zoom: 1 })
        expect(result).toEqual({ x: 100, y: 200 })
    })

    it('accounts for zoom', () => {
        const result = screenToWorld(200, 400, { x: 0, y: 0, zoom: 2 })
        expect(result).toEqual({ x: 100, y: 200 })
    })

    it('accounts for zoom + pan', () => {
        const result = screenToWorld(250, 450, { x: 50, y: 50, zoom: 2 })
        expect(result).toEqual({ x: 100, y: 200 })
    })

    it('accounts for container offset', () => {
        const result = screenToWorld(110, 220, { x: 0, y: 0, zoom: 1 }, 10, 20)
        expect(result).toEqual({ x: 100, y: 200 })
    })
})

describe('worldToScreen', () => {
    it('converts at zoom 1 with no pan', () => {
        const result = worldToScreen(100, 200, { x: 0, y: 0, zoom: 1 })
        expect(result).toEqual({ x: 100, y: 200 })
    })

    it('accounts for pan offset', () => {
        const result = worldToScreen(100, 200, { x: 50, y: 50, zoom: 1 })
        expect(result).toEqual({ x: 150, y: 250 })
    })

    it('accounts for zoom', () => {
        const result = worldToScreen(100, 200, { x: 0, y: 0, zoom: 2 })
        expect(result).toEqual({ x: 200, y: 400 })
    })

    it('round-trip with screenToWorld', () => {
        const vp = { x: -120, y: 55, zoom: 1.5 }
        const world = screenToWorld(300, 400, vp)
        const screen = worldToScreen(world.x, world.y, vp)
        expect(screen.x).toBeCloseTo(300)
        expect(screen.y).toBeCloseTo(400)
    })
})
