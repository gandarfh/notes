import { describe, it, expect, vi } from 'vitest'
import { TextHandler } from '../handlers/text'
import { makeMockContext } from './mockContext'

describe('TextHandler', () => {
    it('mouseDown calls showEditor with snapped coords', () => {
        const handler = new TextHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 47, y: 62 })

        expect(ctx.showEditor).toHaveBeenCalledTimes(1)
        const req = (ctx.showEditor as ReturnType<typeof vi.fn>).mock.calls[0][0]
        expect(req.worldX).toBe(60) // snap(47) = 60
        expect(req.worldY).toBe(60) // snap(62) = 60
        expect(req.initialText).toBe('')
        expect(req.textAlign).toBe('left')
    })

    it('onCommit with text creates element and saves', () => {
        const handler = new TextHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })

        const req = (ctx.showEditor as ReturnType<typeof vi.fn>).mock.calls[0][0]
        req.onCommit('Hello')

        expect(ctx.elements).toHaveLength(1)
        expect(ctx.elements[0].type).toBe('text')
        expect(ctx.elements[0].text).toBe('Hello')
        expect(ctx.save).toHaveBeenCalled()
        expect(ctx.setSubTool).toHaveBeenCalledWith('draw-select')
    })

    it('onCommit with empty text does not create element', () => {
        const handler = new TextHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })

        const req = (ctx.showEditor as ReturnType<typeof vi.fn>).mock.calls[0][0]
        req.onCommit('')

        expect(ctx.elements).toHaveLength(0)
        expect(ctx.save).not.toHaveBeenCalled()
    })

    it('onCancel returns to select tool', () => {
        const handler = new TextHandler()
        const ctx = makeMockContext()
        handler.onMouseDown(ctx, { x: 100, y: 100 })

        const req = (ctx.showEditor as ReturnType<typeof vi.fn>).mock.calls[0][0]
        req.onCancel()

        expect(ctx.setSubTool).toHaveBeenCalledWith('draw-select')
    })

    it('does nothing if already editing', () => {
        const handler = new TextHandler()
        const ctx = makeMockContext({ isEditing: true })
        handler.onMouseDown(ctx, { x: 100, y: 100 })

        expect(ctx.showEditor).not.toHaveBeenCalled()
    })
})
