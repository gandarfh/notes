import { describe, it, expect } from 'vitest'
import { ShapeHandler } from '../handlers/shape'
import { makeMockContext } from './mockContext'

describe('ShapeHandler', () => {
    it('mouseDown creates currentElement with correct type', () => {
        const handler = new ShapeHandler('rectangle')
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 200 })

        expect(ctx.currentElement).not.toBeNull()
        expect(ctx.currentElement!.type).toBe('rectangle')
        expect(ctx.currentElement!.x).toBe(90) // snap(100) = 90
        expect(ctx.currentElement!.y).toBe(210) // snap(200) = 210
    })

    it('mouseMove updates width/height from drag delta', () => {
        const handler = new ShapeHandler('ellipse')
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseMove(ctx, { x: 200, y: 250 })

        expect(ctx.currentElement!.width).toBeGreaterThan(0)
        expect(ctx.currentElement!.height).toBeGreaterThan(0)
        expect(ctx.render).toHaveBeenCalled()
    })

    it('mouseUp with drag commits element and switches to select', () => {
        const handler = new ShapeHandler('rectangle')
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseMove(ctx, { x: 200, y: 250 })
        handler.onMouseUp(ctx)

        expect(ctx.elements).toHaveLength(1)
        expect(ctx.elements[0].type).toBe('rectangle')
        expect(ctx.selectedElement).toBe(ctx.elements[0])
        expect(ctx.save).toHaveBeenCalled()
        expect(ctx.setSubTool).toHaveBeenCalledWith('draw-select')
        expect(ctx.currentElement).toBeNull()
    })

    it('click-to-place creates default-sized element', () => {
        const handler = new ShapeHandler('rectangle')
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        // no move or tiny move
        handler.onMouseUp(ctx)

        expect(ctx.elements).toHaveLength(1)
        // default rect size: 5.33*30 ≈ 160, 2*30 = 60
        expect(ctx.elements[0].width).toBeCloseTo(30 * 5.33)
        expect(ctx.elements[0].height).toBe(60)
    })

    it('group type uses transparent background', () => {
        const handler = new ShapeHandler('group')
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 50, y: 50 })

        expect(ctx.currentElement!.backgroundColor).toBe('transparent')
    })

    it('deactivate clears state', () => {
        const handler = new ShapeHandler('rectangle')
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.deactivate(ctx)

        expect(ctx.currentElement).toBeNull()
    })
})
