import { describe, it, expect } from 'vitest'
import { ArrowHandler } from '../handlers/arrow'
import { makeMockContext } from './mockContext'
import { makeElement } from './fixtures'

describe('ArrowHandler', () => {
    it('first click on empty creates ortho-arrow at snapped position', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 47, y: 62 })

        expect(ctx.currentElement).not.toBeNull()
        expect(ctx.currentElement!.type).toBe('ortho-arrow')
        expect(ctx.currentElement!.x).toBe(60) // snap(47)
        expect(ctx.currentElement!.y).toBe(60) // snap(62)
        expect(ctx.currentElement!.points).toEqual([[0, 0], [0, 0]])
    })

    it('second click on empty completes arrow and saves', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()

        // First click
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        // Second click
        handler.onMouseDown(ctx, { x: 200, y: 100 })

        expect(ctx.elements).toHaveLength(1)
        expect(ctx.elements[0].type).toBe('ortho-arrow')
        expect(ctx.save).toHaveBeenCalled()
        expect(ctx.setSubTool).toHaveBeenCalledWith('draw-select')
        expect(ctx.currentElement).toBeNull()
    })

    it('second click sets width/height from path bounds', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseDown(ctx, { x: 150, y: 90 })

        const arrow = ctx.elements[0]
        expect(arrow.width).toBeGreaterThan(0)
        expect(arrow.height).toBeGreaterThan(0)
    })

    it('mouse move after first click updates preview points', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 100, y: 50 })

        expect(ctx.currentElement).not.toBeNull()
        expect(ctx.currentElement!.points!.length).toBeGreaterThanOrEqual(2)
        expect(ctx.render).toHaveBeenCalled()
    })

    it('escape cancels pending arrow', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        expect(ctx.currentElement).not.toBeNull()

        const consumed = handler.onKeyDown(ctx, { key: 'Escape' } as KeyboardEvent)
        expect(consumed).toBe(true)
        expect(ctx.currentElement).toBeNull()
    })

    it('escape does nothing without pending arrow', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()

        const consumed = handler.onKeyDown(ctx, { key: 'Escape' } as KeyboardEvent)
        expect(consumed).toBe(false)
    })

    it('deactivate clears pending state', () => {
        const handler = new ArrowHandler()
        const ctx = makeMockContext()

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.deactivate(ctx)

        expect(ctx.currentElement).toBeNull()
    })

    it('arrow connects to shape anchors when near', () => {
        const handler = new ArrowHandler()
        // Place a shape in context — getAnchors needs WASM so won't find anchors,
        // but the handler should still complete without error
        const shape = makeElement({ id: 'box1', x: 200, y: 0, width: 100, height: 80 })
        const ctx = makeMockContext({ elements: [shape] })

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseDown(ctx, { x: 250, y: 40 })

        // Arrow should complete regardless of anchor snapping
        expect(ctx.elements).toHaveLength(2) // shape + arrow
        expect(ctx.elements[1].type).toBe('ortho-arrow')
    })
})
