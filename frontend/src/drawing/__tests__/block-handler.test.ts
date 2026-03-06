import { describe, it, expect, vi } from 'vitest'
import { BlockHandler } from '../handlers/block'
import { makeMockContext } from './mockContext'

describe('BlockHandler', () => {
    const onBlockCreate = vi.fn()

    it('mouseDown shows block preview', () => {
        const handler = new BlockHandler(onBlockCreate)
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 200 })

        expect(ctx.setBlockPreview).toHaveBeenCalledWith({
            x: 90, // snap(100)
            y: 210, // snap(200)
            width: 0,
            height: 0,
        })
    })

    it('mouseMove updates preview dimensions', () => {
        const handler = new BlockHandler(onBlockCreate)
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseMove(ctx, { x: 300, y: 400 })

        const calls = (ctx.setBlockPreview as ReturnType<typeof vi.fn>).mock.calls
        const lastCall = calls[calls.length - 1][0]
        expect(lastCall.width).toBeGreaterThan(0)
        expect(lastCall.height).toBeGreaterThan(0)
    })

    it('mouseUp calls onBlockCreate and switches to select', () => {
        onBlockCreate.mockClear()
        const handler = new BlockHandler(onBlockCreate, 'markdown', 320, 220)
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.onMouseMove(ctx, { x: 500, y: 500 })
        handler.onMouseUp(ctx)

        expect(ctx.setBlockPreview).toHaveBeenLastCalledWith(null)
        expect(onBlockCreate).toHaveBeenCalledTimes(1)
        expect(onBlockCreate.mock.calls[0][0]).toBe('markdown')
        expect(ctx.setSubTool).toHaveBeenCalledWith('draw-select')
    })

    it('small drag uses default dimensions', () => {
        onBlockCreate.mockClear()
        const handler = new BlockHandler(onBlockCreate, 'markdown', 320, 220)
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        // small move — below minW/minH thresholds (160, 100)
        handler.onMouseMove(ctx, { x: 110, y: 110 })
        handler.onMouseUp(ctx)

        expect(onBlockCreate).toHaveBeenCalledTimes(1)
        // Should use default 320x220
        expect(onBlockCreate.mock.calls[0][3]).toBe(320) // width
        expect(onBlockCreate.mock.calls[0][4]).toBe(220) // height
    })

    it('deactivate clears preview', () => {
        const handler = new BlockHandler(onBlockCreate)
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })
        handler.deactivate(ctx)

        expect(ctx.setBlockPreview).toHaveBeenLastCalledWith(null)
    })
})
