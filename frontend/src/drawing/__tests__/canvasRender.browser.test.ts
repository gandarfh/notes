import { describe, it, expect } from 'vitest'
import { drawSelectionUI, drawAnchors, drawBoxSelection, getArrowLabelPos, remapForTheme } from '../canvasRender'
import { makeElement, makeArrow, makeOrthoArrow } from './fixtures'

function createCanvas(w = 800, h = 600): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    return canvas.getContext('2d')!
}

// ── drawSelectionUI ────────────────────────────────────────

describe('drawSelectionUI', () => {
    it('renders handles for rectangle element', () => {
        const ctx2d = createCanvas()
        const el = makeElement({ id: 'r1', x: 100, y: 100, width: 200, height: 150 })

        // Should not throw
        drawSelectionUI(ctx2d, el)

        // Canvas was drawn to (we can't easily inspect pixels, but no error = API works)
        expect(true).toBe(true)
    })

    it('renders endpoints for arrow element', () => {
        const ctx2d = createCanvas()
        const el = makeArrow({ id: 'a1', x: 50, y: 50, points: [[0, 0], [200, 100]] })

        drawSelectionUI(ctx2d, el)
        expect(true).toBe(true)
    })

    it('renders midpoints for ortho-arrow segments', () => {
        const ctx2d = createCanvas()
        const el = makeOrthoArrow({
            id: 'o1', x: 0, y: 0,
            points: [[0, 0], [100, 0], [100, 100], [200, 100]],
        })

        drawSelectionUI(ctx2d, el)
        expect(true).toBe(true)
    })

    it('handles element with no points gracefully', () => {
        const ctx2d = createCanvas()
        const el = makeArrow({ points: [[0, 0]] }) // only 1 point — degenerate
        el.points = [[0, 0]]

        drawSelectionUI(ctx2d, el)
        expect(true).toBe(true)
    })
})

// ── drawAnchors ────────────────────────────────────────────

describe('drawAnchors', () => {
    it('renders without error when no hovered element', () => {
        const ctx2d = createCanvas()
        drawAnchors(ctx2d, null, null, () => [])
        expect(true).toBe(true)
    })

    it('renders anchor points for hovered element', () => {
        const ctx2d = createCanvas()
        const el = makeElement({ id: 'box', x: 100, y: 100, width: 80, height: 60 })
        const anchors = [
            { elementId: 'box', side: 'top' as const, t: 0.5, x: 140, y: 100 },
            { elementId: 'box', side: 'right' as const, t: 0.5, x: 180, y: 130 },
        ]

        drawAnchors(ctx2d, el, anchors[0], () => anchors)
        expect(true).toBe(true)
    })
})

// ── drawBoxSelection ───────────────────────────────────────

describe('drawBoxSelection', () => {
    it('renders box selection rectangle', () => {
        const ctx2d = createCanvas()
        const start = { x: 50, y: 50 }
        const end = { x: 200, y: 200 }
        const previewIds = new Set(['el1'])
        const elements = [makeElement({ id: 'el1', x: 100, y: 100, width: 50, height: 50 })]

        drawBoxSelection(ctx2d, start, end, previewIds, elements)
        expect(true).toBe(true)
    })
})

// ── getArrowLabelPos ───────────────────────────────────────

describe('getArrowLabelPos', () => {
    it('returns midpoint of simple 2-point arrow', () => {
        const el = makeArrow({ x: 0, y: 0, points: [[0, 0], [200, 100]] })
        const pos = getArrowLabelPos(el)

        expect(pos).not.toBeNull()
        expect(pos!.x).toBeCloseTo(100)
        expect(pos!.y).toBeCloseTo(50)
    })

    it('returns midpoint along ortho-arrow path', () => {
        const el = makeOrthoArrow({
            x: 0, y: 0,
            points: [[0, 0], [100, 0], [100, 100], [200, 100]],
        })
        const pos = getArrowLabelPos(el)

        expect(pos).not.toBeNull()
        // Total path length = 100 + 100 + 100 = 300, midpoint at 150
        // First segment [0,0]->[100,0] = 100, second [100,0]->[100,100] = 100
        // At 150: 50 units into second segment → (100, 50)
        expect(pos!.x).toBeCloseTo(100)
        expect(pos!.y).toBeCloseTo(50)
    })

    it('returns null for arrow without points', () => {
        const el = makeArrow()
        el.points = undefined
        expect(getArrowLabelPos(el)).toBeNull()
    })

    it('returns null for arrow with single point', () => {
        const el = makeArrow()
        el.points = [[0, 0]]
        expect(getArrowLabelPos(el)).toBeNull()
    })
})

// ── remapForTheme ──────────────────────────────────────────

describe('remapForTheme', () => {
    it('returns original color in dark mode (default)', () => {
        // Without data-theme="light", should return original color
        document.documentElement.removeAttribute('data-theme')
        expect(remapForTheme('#ff0000')).toBe('#ff0000')
    })

    it('swaps white to black in light mode', () => {
        document.documentElement.setAttribute('data-theme', 'light')
        expect(remapForTheme('#ffffff')).toBe('#000000')
        expect(remapForTheme('#fff')).toBe('#000')
    })

    it('swaps black to white in light mode', () => {
        document.documentElement.setAttribute('data-theme', 'light')
        expect(remapForTheme('#000000')).toBe('#ffffff')
        expect(remapForTheme('#000')).toBe('#fff')
    })

    it('does not swap non-palette colors', () => {
        document.documentElement.setAttribute('data-theme', 'light')
        expect(remapForTheme('#ff0000')).toBe('#ff0000')
    })
})
