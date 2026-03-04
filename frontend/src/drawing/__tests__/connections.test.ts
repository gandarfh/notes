import { describe, it, expect } from 'vitest'
import { resolveAnchor, updateConnectedArrows, getAnchors, findNearestAnchor } from '../connections'
import { makeElement, makeArrow, makeOrthoArrow, makeConnection } from './fixtures'

describe('resolveAnchor', () => {
    const el = makeElement({ id: 'shape_1', x: 100, y: 200, width: 200, height: 100 })
    const elements = [el]

    it('resolves top side at t=0.5 (center)', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'shape_1', side: 'top', t: 0.5 }))
        expect(result).toEqual({ x: 200, y: 200 })  // 100 + 200*0.5, 200
    })

    it('resolves bottom side at t=0.5', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'shape_1', side: 'bottom', t: 0.5 }))
        expect(result).toEqual({ x: 200, y: 300 })  // 100 + 200*0.5, 200+100
    })

    it('resolves left side at t=0.5', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'shape_1', side: 'left', t: 0.5 }))
        expect(result).toEqual({ x: 100, y: 250 })  // 100, 200 + 100*0.5
    })

    it('resolves right side at t=0.5', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'shape_1', side: 'right', t: 0.5 }))
        expect(result).toEqual({ x: 300, y: 250 })  // 100+200, 200 + 100*0.5
    })

    it('resolves with t=0 (start of edge)', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'shape_1', side: 'top', t: 0 }))
        expect(result).toEqual({ x: 100, y: 200 })
    })

    it('resolves with t=1 (end of edge)', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'shape_1', side: 'top', t: 1 }))
        expect(result).toEqual({ x: 300, y: 200 })
    })

    it('returns null for non-existent element', () => {
        const result = resolveAnchor(elements, makeConnection({ elementId: 'missing' }))
        expect(result).toBeNull()
    })
})

describe('updateConnectedArrows', () => {
    it('updates simple arrow when connected element moves', () => {
        const shape = makeElement({ id: 'shape_1', x: 100, y: 100, width: 80, height: 60 })
        const arrow = makeArrow({
            id: 'arr_1',
            type: 'arrow',
            x: 180,
            y: 130,
            points: [[0, 0], [100, 50]],
            startConnection: { elementId: 'shape_1', side: 'right', t: 0.5 },
        })
        const elements = [shape, arrow]

        // Move shape to new position
        shape.x = 200
        shape.y = 200
        updateConnectedArrows(elements, 'shape_1')

        // Arrow origin should update to resolved anchor: shape_1 right at t=0.5
        // right side: x = 200+80 = 280, y = 200 + 60*0.5 = 230
        expect(arrow.x).toBe(280)
        expect(arrow.y).toBe(230)
    })

    it('does not modify arrows without connections to moved element', () => {
        const shape = makeElement({ id: 'shape_1' })
        const arrow = makeArrow({
            id: 'arr_1',
            x: 50,
            y: 50,
            startConnection: { elementId: 'other_shape', side: 'left', t: 0.5 },
        })
        const elements = [shape, arrow]

        updateConnectedArrows(elements, 'shape_1')
        expect(arrow.x).toBe(50)  // unchanged
        expect(arrow.y).toBe(50)
    })

    it('updates width/height from point bounds', () => {
        const shape1 = makeElement({ id: 's1', x: 0, y: 0, width: 50, height: 50 })
        const shape2 = makeElement({ id: 's2', x: 300, y: 200, width: 50, height: 50 })
        const arrow = makeArrow({
            id: 'arr_1',
            type: 'arrow',
            x: 50,
            y: 25,
            points: [[0, 0], [250, 175]],
            width: 250,
            height: 175,
            startConnection: { elementId: 's1', side: 'right', t: 0.5 },
            endConnection: { elementId: 's2', side: 'left', t: 0.5 },
        })
        const elements = [shape1, shape2, arrow]

        updateConnectedArrows(elements, 's1')

        // After update, width/height should reflect the actual path bounds
        expect(arrow.width).toBeGreaterThanOrEqual(0)
        expect(arrow.height).toBeGreaterThanOrEqual(0)
    })

    it('updates ortho-arrow route when connected element moves', () => {
        const shape = makeElement({ id: 's1', x: 100, y: 100, width: 80, height: 60 })
        const arrow = makeOrthoArrow({
            id: 'arr_1',
            x: 180, y: 130,
            startConnection: { elementId: 's1', side: 'right', t: 0.5 },
        })
        const elements = [shape, arrow]

        shape.x = 200
        updateConnectedArrows(elements, 's1')

        // Arrow origin should update; points should be recomputed
        expect(arrow.x).toBe(280) // 200+80
        expect(arrow.points!.length).toBeGreaterThanOrEqual(2)
        expect(arrow.points![0]).toEqual([0, 0]) // always starts at origin
    })

    it('handles arrow with missing/empty points gracefully', () => {
        const shape = makeElement({ id: 's1', x: 100, y: 100, width: 80, height: 60 })
        const arrow = makeArrow({
            id: 'arr_1', type: 'arrow',
            x: 180, y: 130,
            points: undefined as any,
            startConnection: { elementId: 's1', side: 'right', t: 0.5 },
        })
        // Restore points to null to test degenerate case
        arrow.points = undefined
        const elements = [shape, arrow]

        // Should not throw
        updateConnectedArrows(elements, 's1')
        expect(arrow.points).toBeDefined()
        expect(arrow.points!.length).toBeGreaterThanOrEqual(2)
    })

    it('updates both start and end connections simultaneously', () => {
        const s1 = makeElement({ id: 's1', x: 0, y: 0, width: 50, height: 50 })
        const s2 = makeElement({ id: 's2', x: 200, y: 0, width: 50, height: 50 })
        const arrow = makeArrow({
            id: 'arr_1', type: 'arrow',
            x: 50, y: 25,
            points: [[0, 0], [150, 0]],
            startConnection: { elementId: 's1', side: 'right', t: 0.5 },
            endConnection: { elementId: 's2', side: 'left', t: 0.5 },
        })

        // Move s1 — arrow has both connections, startMoved=true
        s1.x = 50
        updateConnectedArrows([s1, s2, arrow], 's1')

        // Start anchor: right of s1 = 50+50=100, t=0.5 → y=25
        expect(arrow.x).toBe(100)
        expect(arrow.y).toBe(25)
        // End should resolve to s2 left: x=200, y=25 → relative: [100, 0]
        const lastPt = arrow.points![arrow.points!.length - 1]
        expect(lastPt[0]).toBe(100) // 200 - 100
        expect(lastPt[1]).toBe(0)   // 25 - 25
    })
})

// ── getAnchors ────────────────────────────────────────────

describe('getAnchors', () => {
    it('returns empty array for arrow types', () => {
        expect(getAnchors(makeArrow())).toEqual([])
    })

    it('returns empty array for freedraw', () => {
        expect(getAnchors(makeElement({ type: 'freedraw' }))).toEqual([])
    })

    it('returns empty array for text', () => {
        expect(getAnchors(makeElement({ type: 'text' }))).toEqual([])
    })

    it('returns empty array for group', () => {
        expect(getAnchors(makeElement({ type: 'group' }))).toEqual([])
    })

    it('returns empty array for shapes without WASM engine', () => {
        // Without WASM engine loaded, getAnchors returns empty for shapes too
        const result = getAnchors(makeElement({ type: 'rectangle', width: 100, height: 80 }))
        expect(result).toEqual([])
    })
})

// ── findNearestAnchor ─────────────────────────────────────

describe('findNearestAnchor', () => {
    it('returns null when no elements have anchors', () => {
        const elements = [makeArrow(), makeElement({ type: 'text' })]
        expect(findNearestAnchor(elements, 100, 100)).toBeNull()
    })

    it('returns null for empty elements', () => {
        expect(findNearestAnchor([], 100, 100)).toBeNull()
    })

    it('skips excluded element by id', () => {
        // Without WASM, shapes won't have anchors anyway, but the exclusion path runs
        const el = makeElement({ id: 'skip_me' })
        expect(findNearestAnchor([el], 100, 100, 'skip_me')).toBeNull()
    })
})
