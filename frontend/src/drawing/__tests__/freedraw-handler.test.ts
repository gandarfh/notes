import { describe, it, expect } from 'vitest'
import { FreedrawHandler } from '../handlers/freedraw'
import { makeMockContext } from './mockContext'

describe('FreedrawHandler', () => {
    it('mouseDown creates freedraw element with first point', () => {
        const handler = new FreedrawHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 50, y: 60 })

        expect(ctx.currentElement).not.toBeNull()
        expect(ctx.currentElement!.type).toBe('freedraw')
        expect(ctx.currentElement!.x).toBe(50)
        expect(ctx.currentElement!.y).toBe(60)
        expect(ctx.currentElement!.points).toEqual([[0, 0]])
    })

    it('mouseMove appends relative points', () => {
        const handler = new FreedrawHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseMove(ctx, { x: 110, y: 115 })
        handler.onMouseMove(ctx, { x: 120, y: 130 })

        expect(ctx.currentElement!.points).toEqual([
            [0, 0], [10, 15], [20, 30],
        ])
        expect(ctx.render).toHaveBeenCalledTimes(2)
    })

    it('mouseUp commits element with >2 points', () => {
        const handler = new FreedrawHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseMove(ctx, { x: 110, y: 115 })
        handler.onMouseMove(ctx, { x: 120, y: 130 })
        handler.onMouseUp(ctx)

        expect(ctx.elements).toHaveLength(1)
        expect(ctx.elements[0].type).toBe('freedraw')
        expect(ctx.selectedElement).toBe(ctx.elements[0])
        expect(ctx.save).toHaveBeenCalled()
        expect(ctx.currentElement).toBeNull()
    })

    it('mouseUp discards element with <=2 points (single click)', () => {
        const handler = new FreedrawHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseUp(ctx)

        expect(ctx.elements).toHaveLength(0)
        expect(ctx.save).not.toHaveBeenCalled()
    })

    it('deactivate clears state', () => {
        const handler = new FreedrawHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.deactivate(ctx)

        expect(ctx.currentElement).toBeNull()
    })
})
