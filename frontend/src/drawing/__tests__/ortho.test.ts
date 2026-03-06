import { describe, it, expect } from 'vitest'
import { computeOrthoRoute, simplifyOrthoPoints, enforceOrthogonality } from '../ortho'
import { makeOrthoArrow } from './fixtures'

describe('computeOrthoRoute (fallback, no WASM)', () => {
    it('returns L-shape horizontal-first when |dx| > |dy|', () => {
        const pts = computeOrthoRoute(200, 100)
        expect(pts).toHaveLength(4)
        expect(pts[0]).toEqual([0, 0])
        expect(pts[3]).toEqual([200, 100])
        // Middle points: horizontal then vertical
        expect(pts[1]).toEqual([100, 0])   // dx/2
        expect(pts[2]).toEqual([100, 100]) // dx/2, dy
    })

    it('returns L-shape vertical-first when |dy| > |dx|', () => {
        const pts = computeOrthoRoute(50, 200)
        expect(pts).toHaveLength(4)
        expect(pts[0]).toEqual([0, 0])
        expect(pts[3]).toEqual([50, 200])
        // Middle points: vertical then horizontal
        expect(pts[1]).toEqual([0, 100])  // 0, dy/2
        expect(pts[2]).toEqual([50, 100]) // dx, dy/2
    })

    it('handles negative directions', () => {
        const pts = computeOrthoRoute(-200, -100)
        expect(pts[0]).toEqual([0, 0])
        expect(pts[3]).toEqual([-200, -100])
    })
})

describe('simplifyOrthoPoints', () => {
    it('removes collinear waypoints', () => {
        const el = makeOrthoArrow({
            // Three collinear horizontal points: [0,0], [50,0], [100,0], [100,100]
            points: [[0, 0], [50, 0], [100, 0], [100, 100]],
        })
        simplifyOrthoPoints(el)
        // [50,0] is collinear with [0,0] and [100,0] (same Y) → removed
        expect(el.points).toEqual([[0, 0], [100, 0], [100, 100]])
    })

    it('preserves corners (non-collinear)', () => {
        const el = makeOrthoArrow({
            points: [[0, 0], [100, 0], [100, 100]],
        })
        simplifyOrthoPoints(el)
        expect(el.points).toEqual([[0, 0], [100, 0], [100, 100]])
    })

    it('is noop for fewer than 3 points', () => {
        const el = makeOrthoArrow({ points: [[0, 0], [100, 0]] })
        simplifyOrthoPoints(el)
        expect(el.points).toEqual([[0, 0], [100, 0]])
    })
})

describe('enforceOrthogonality', () => {
    it('snaps diagonal segment to nearest axis', () => {
        const el = makeOrthoArrow({
            points: [[0, 0], [100, 5]],  // nearly horizontal
        })
        enforceOrthogonality(el)
        // adx=100 > ady=5 → snap Y: b[1] = a[1] = 0
        expect(el.points![1][1]).toBe(0)
    })

    it('snaps nearly vertical segment', () => {
        const el = makeOrthoArrow({
            points: [[0, 0], [3, 100]],  // nearly vertical
        })
        enforceOrthogonality(el)
        // adx=3 < ady=100 → snap X: b[0] = a[0] = 0
        expect(el.points![1][0]).toBe(0)
    })

    it('is noop for already orthogonal segments', () => {
        const el = makeOrthoArrow({
            points: [[0, 0], [100, 0], [100, 100]],
        })
        enforceOrthogonality(el)
        expect(el.points).toEqual([[0, 0], [100, 0], [100, 100]])
    })
})
