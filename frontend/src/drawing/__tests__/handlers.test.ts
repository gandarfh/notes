import { describe, it, expect } from 'vitest'
import { boxIntersects, cloneElement } from '../handlers/select'
import { collectObstacles } from '../handlers/arrow'
import { makeElement, makeArrow, makeOrthoArrow } from './fixtures'

// ── boxIntersects ────────────────────────────────────────

describe('boxIntersects', () => {
    describe('shapes (AABB overlap)', () => {
        it('returns true when shape is fully inside box', () => {
            const el = makeElement({ x: 50, y: 50, width: 20, height: 20 })
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(true)
        })

        it('returns true when shape partially overlaps box', () => {
            const el = makeElement({ x: 80, y: 80, width: 40, height: 40 })
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(true)
        })

        it('returns false when shape is completely outside box', () => {
            const el = makeElement({ x: 200, y: 200, width: 50, height: 50 })
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(false)
        })

        it('handles reversed box coordinates (x2 < x1)', () => {
            const el = makeElement({ x: 50, y: 50, width: 20, height: 20 })
            expect(boxIntersects(el, 100, 100, 0, 0)).toBe(true)
        })

        it('handles zero-size element', () => {
            const el = makeElement({ x: 50, y: 50, width: 0, height: 0 })
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(true)
        })
    })

    describe('arrows (point-in-box)', () => {
        it('returns true when arrow point is inside box', () => {
            const el = makeArrow({ x: 10, y: 10, points: [[0, 0], [40, 40]] })
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(true)
        })

        it('returns false when no arrow points inside box', () => {
            const el = makeArrow({ x: 200, y: 200, points: [[0, 0], [50, 50]] })
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(false)
        })

        it('works with ortho-arrow (multiple points)', () => {
            const el = makeOrthoArrow({ x: 0, y: 0, points: [[0, 0], [50, 0], [50, 150], [100, 150]] })
            // Point (50, 0) is inside box (0,0)→(100,100)
            expect(boxIntersects(el, 0, 0, 100, 100)).toBe(true)
        })
    })
})

// ── cloneElement ─────────────────────────────────────────

describe('cloneElement', () => {
    it('creates deep copy', () => {
        const el = makeArrow({ points: [[0, 0], [100, 50]] })
        const clone = cloneElement(el)
        clone.x = 999
        clone.points![0][0] = 999
        expect(el.x).toBe(0)           // original unchanged
        expect(el.points![0][0]).toBe(0) // nested array unchanged
    })

    it('preserves all fields', () => {
        const el = makeElement({
            id: 'test', type: 'rectangle', x: 10, y: 20,
            strokeColor: '#ff0000', backgroundColor: '#00ff00',
        })
        const clone = cloneElement(el)
        expect(clone.id).toBe('test')
        expect(clone.strokeColor).toBe('#ff0000')
        expect(clone.backgroundColor).toBe('#00ff00')
    })
})

// ── collectObstacles ─────────────────────────────────────

describe('collectObstacles', () => {
    it('filters out arrows and groups', () => {
        const elements = [
            makeElement({ id: 'shape', x: 50, y: 50, width: 40, height: 40 }),
            makeArrow({ id: 'arrow' }),
            makeElement({ id: 'group', type: 'group', x: 60, y: 60 }),
        ]
        const result = collectObstacles(elements, 0, 0, new Set())
        expect(result).toHaveLength(1)
        expect(result[0].x).toBe(50)
    })

    it('excludes elements by ID', () => {
        const elements = [
            makeElement({ id: 'src', x: 0, y: 0 }),
            makeElement({ id: 'dst', x: 100, y: 100 }),
            makeElement({ id: 'obstacle', x: 50, y: 50 }),
        ]
        const result = collectObstacles(elements, 0, 0, new Set(['src', 'dst']), 150, 150)
        expect(result).toHaveLength(1)
        expect(result[0].x).toBe(50)
    })

    it('filters shapes outside route corridor', () => {
        const elements = [
            makeElement({ id: 'near', x: 50, y: 50, width: 40, height: 40 }),
            makeElement({ id: 'far', x: 5000, y: 5000, width: 40, height: 40 }),
        ]
        const result = collectObstacles(elements, 0, 0, new Set(), 100, 100)
        expect(result).toHaveLength(1)
        expect(result[0].x).toBe(50)
    })

    it('converts to arrow-local coordinates', () => {
        const elements = [
            makeElement({ id: 'shape', x: 150, y: 200, width: 40, height: 40 }),
        ]
        const result = collectObstacles(elements, 100, 100, new Set(), 100, 150)
        expect(result[0]).toEqual({ x: 50, y: 100, w: 40, h: 40 })
    })

    it('returns empty for no valid obstacles', () => {
        const result = collectObstacles([], 0, 0, new Set())
        expect(result).toEqual([])
    })
})
