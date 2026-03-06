import { describe, it, expect } from 'vitest'
import { segDist, isPointInElement, hitTest, hitTestHandle, hitTestArrowEndpoint, hitTestSegmentMidpoint, findNearestSegment } from '../hitTest'
import { makeElement, makeArrow, makeOrthoArrow, makeFreedraw } from './fixtures'

describe('segDist', () => {
    it('returns 0 for point on segment', () => {
        expect(segDist(5, 0, 0, 0, 10, 0)).toBeCloseTo(0)
    })

    it('returns perpendicular distance', () => {
        // Point (5, 3) to segment from (0,0) to (10,0) → distance is 3
        expect(segDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3)
    })

    it('returns distance to nearest endpoint when projected outside segment', () => {
        // Point (15, 0) to segment from (0,0) to (10,0) → distance to (10,0) = 5
        expect(segDist(15, 0, 0, 0, 10, 0)).toBeCloseTo(5)
    })

    it('handles degenerate segment (zero length)', () => {
        expect(segDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5)  // hypot(3,4) = 5
    })
})

describe('isPointInElement', () => {
    describe('freedraw', () => {
        it('hits point near stroke', () => {
            const el = makeFreedraw({ x: 100, y: 100, strokeWidth: 2 })
            // Point near first stroke point (100+0, 100+0) = (100, 100)
            expect(isPointInElement(101, 101, el)).toBe(true)
        })

        it('misses point far from stroke', () => {
            const el = makeFreedraw({ x: 100, y: 100, strokeWidth: 2 })
            expect(isPointInElement(200, 200, el)).toBe(false)
        })
    })

    describe('line/arrow', () => {
        it('hits point on line segment', () => {
            const el = makeArrow({ x: 0, y: 0, points: [[0, 0], [100, 0]], strokeWidth: 2 })
            expect(isPointInElement(50, 0, el)).toBe(true)
        })

        it('misses point far from line', () => {
            const el = makeArrow({ x: 0, y: 0, points: [[0, 0], [100, 0]], strokeWidth: 2 })
            expect(isPointInElement(50, 50, el)).toBe(false)
        })
    })

    describe('ortho-arrow', () => {
        it('hits point on a segment', () => {
            const el = makeOrthoArrow({ x: 0, y: 0, strokeWidth: 2 })
            // First segment: (0,0)→(100,0), point at (50, 0) should hit
            expect(isPointInElement(50, 0, el)).toBe(true)
        })

        it('misses point between segments', () => {
            const el = makeOrthoArrow({ x: 0, y: 0, strokeWidth: 2 })
            // Point at (50, 50) is far from all segments
            expect(isPointInElement(50, 50, el)).toBe(false)
        })
    })

    describe('group (border-only)', () => {
        it('hits border', () => {
            const el = makeElement({ type: 'group', x: 0, y: 0, width: 100, height: 80, strokeWidth: 2 })
            expect(isPointInElement(0, 40, el)).toBe(true)  // left border
        })

        it('passes through interior', () => {
            const el = makeElement({ type: 'group', x: 0, y: 0, width: 100, height: 80, strokeWidth: 2 })
            expect(isPointInElement(50, 40, el)).toBe(false)  // center
        })
    })

    describe('fallback (no WASM)', () => {
        it('hits inside filled bounding box', () => {
            const el = makeElement({ backgroundColor: '#ff0000' })
            expect(isPointInElement(50, 40, el)).toBe(true)
        })

        it('misses outside bounding box', () => {
            const el = makeElement({ backgroundColor: '#ff0000' })
            expect(isPointInElement(200, 200, el)).toBe(false)
        })

        it('stroke-only: hits border', () => {
            const el = makeElement({ backgroundColor: 'transparent', strokeWidth: 2 })
            expect(isPointInElement(0, 40, el)).toBe(true)  // left border
        })

        it('stroke-only: misses interior', () => {
            const el = makeElement({ backgroundColor: 'transparent', strokeWidth: 2, width: 200, height: 200 })
            expect(isPointInElement(100, 100, el)).toBe(false)  // center of large element
        })
    })
})

describe('hitTest', () => {
    it('returns null for empty array', () => {
        expect(hitTest([], 50, 50)).toBeNull()
    })

    it('returns topmost (last) matching element', () => {
        const a = makeElement({ id: 'a', backgroundColor: '#f00' })
        const b = makeElement({ id: 'b', backgroundColor: '#0f0' })
        // Both overlap same area; b is last → topmost
        expect(hitTest([a, b], 50, 40)?.id).toBe('b')
    })

    it('returns null when no element at point', () => {
        const el = makeElement({ backgroundColor: '#f00' })
        expect(hitTest([el], 500, 500)).toBeNull()
    })
})

describe('hitTestHandle', () => {
    it('returns correct handle for corner', () => {
        const el = makeElement({ x: 100, y: 100, width: 200, height: 150 })
        expect(hitTestHandle(100, 100, el)).toBe('nw')
        expect(hitTestHandle(300, 250, el)).toBe('se')
        expect(hitTestHandle(300, 100, el)).toBe('ne')
        expect(hitTestHandle(100, 250, el)).toBe('sw')
    })

    it('returns correct handle for midpoints', () => {
        const el = makeElement({ x: 100, y: 100, width: 200, height: 150 })
        expect(hitTestHandle(200, 100, el)).toBe('n')
        expect(hitTestHandle(200, 250, el)).toBe('s')
        expect(hitTestHandle(100, 175, el)).toBe('w')
        expect(hitTestHandle(300, 175, el)).toBe('e')
    })

    it('returns null for arrows', () => {
        expect(hitTestHandle(0, 0, makeArrow())).toBeNull()
    })

    it('returns null for freedraw', () => {
        expect(hitTestHandle(0, 0, makeFreedraw())).toBeNull()
    })

    it('returns null for text', () => {
        expect(hitTestHandle(0, 0, makeElement({ type: 'text' }))).toBeNull()
    })
})

describe('hitTestArrowEndpoint', () => {
    it('returns start when near first point', () => {
        const el = makeArrow({ x: 10, y: 20 })
        expect(hitTestArrowEndpoint(10, 20, el)).toBe('start')
    })

    it('returns end when near last point', () => {
        const el = makeArrow({ x: 10, y: 20 })
        // Last point = (10+200, 20+100) = (210, 120)
        expect(hitTestArrowEndpoint(210, 120, el)).toBe('end')
    })

    it('returns null when far from endpoints', () => {
        const el = makeArrow({ x: 10, y: 20 })
        expect(hitTestArrowEndpoint(100, 60, el)).toBeNull()
    })

    it('returns null when no points', () => {
        const el = makeElement({ points: undefined })
        expect(hitTestArrowEndpoint(0, 0, el)).toBeNull()
    })
})

describe('hitTestSegmentMidpoint', () => {
    it('finds midpoint of a segment', () => {
        const el = makeOrthoArrow({ x: 0, y: 0 })
        // Points: [0,0], [100,0], [100,100], [200,100]
        // Midpoint of seg 0 = (50, 0)
        expect(hitTestSegmentMidpoint(50, 0, el)).toBe(0)
    })

    it('returns null for element with fewer than 3 points', () => {
        const el = makeArrow()
        expect(hitTestSegmentMidpoint(100, 50, el)).toBeNull()
    })
})

describe('findNearestSegment', () => {
    it('finds closest segment', () => {
        const el = makeOrthoArrow({ x: 0, y: 0 })
        // Points: [0,0], [100,0], [100,100], [200,100]
        // Point (50, 2) → closest to segment 0 (horizontal from 0,0 to 100,0)
        expect(findNearestSegment(50, 2, el)).toBe(0)
        // Point (102, 50) → closest to segment 1 (vertical from 100,0 to 100,100)
        expect(findNearestSegment(102, 50, el)).toBe(1)
    })

    it('returns null when no points', () => {
        const el = makeElement({ points: undefined })
        expect(findNearestSegment(0, 0, el)).toBeNull()
    })

    it('returns null when beyond threshold', () => {
        const el = makeOrthoArrow({ x: 0, y: 0 })
        // Point (50, 100) → far from segment 0, but segment 2 is at y=100 (x: 100→200)
        // For (50, 100): seg0 at dist=100, seg1 at dist=50, seg2 at dist=50, seg3 doesn't exist
        // Actually let's pick a point that's far from everything
        expect(findNearestSegment(-100, -100, el)).toBeNull()
    })
})
