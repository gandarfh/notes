import { describe, it, expect, vi } from 'vitest'
import { SelectHandler } from '../handlers/select'
import { makeMockContext } from './mockContext'
import { makeElement, makeArrow, makeOrthoArrow } from './fixtures'
import type { EditorRequest } from '../interfaces'

/**
 * Tests for SelectHandler.onDoubleClick — verifies the 4 distinct paths:
 * 1. Arrow label (center, no shape container, stores in `label`)
 * 2. Group label (left, bold, background, stores in `text`)
 * 3. Shape text (center, with shape container, stores in `text`)
 * 4. Standalone text (left, no shape container, stores in `text`)
 */

function filledElement(overrides: Partial<ReturnType<typeof makeElement>> = {}) {
    return makeElement({ backgroundColor: '#ccc', ...overrides })
}

describe('SelectHandler.onDoubleClick', () => {
    // ── Arrow label ───────────────────────────────────────

    describe('arrow label', () => {
        it('opens editor with center alignment and no shape container', () => {
            const handler = new SelectHandler()
            const arrow = makeArrow({
                id: 'a1', x: 0, y: 0,
                points: [[0, 0], [200, 100]],
                strokeColor: '#ff0',
                fontSize: 14,
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [arrow], showEditor })

            // Arrow midpoint is approximately (100, 50)
            handler.onDoubleClick!(ctx, { x: 100, y: 50 })

            expect(showEditor).toHaveBeenCalledTimes(1)
            const req: EditorRequest = showEditor.mock.calls[0][0]
            expect(req.textAlign).toBe('center')
            expect(req.shapeWidth).toBeUndefined()
            expect(req.shapeHeight).toBeUndefined()
            expect(req.elementId).toBe('a1')
        })

        it('stores text in label field via onCommit', () => {
            const handler = new SelectHandler()
            const arrow = makeArrow({ id: 'a1', x: 0, y: 0, points: [[0, 0], [200, 100]] })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [arrow], showEditor })

            handler.onDoubleClick!(ctx, { x: 100, y: 50 })
            const req: EditorRequest = showEditor.mock.calls[0][0]
            req.onCommit('hello')

            expect(arrow.label).toBe('hello')
        })

        it('clears label when committing empty string', () => {
            const handler = new SelectHandler()
            const arrow = makeArrow({ id: 'a1', x: 0, y: 0, points: [[0, 0], [200, 100]], label: 'old' })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [arrow], showEditor })

            handler.onDoubleClick!(ctx, { x: 100, y: 50 })
            const req: EditorRequest = showEditor.mock.calls[0][0]
            req.onCommit('')

            expect(arrow.label).toBeUndefined()
        })

        it('uses textColor falling back to strokeColor', () => {
            const handler = new SelectHandler()
            const arrow = makeArrow({
                id: 'a1', x: 0, y: 0,
                points: [[0, 0], [200, 100]],
                strokeColor: '#f0f',
                textColor: undefined,
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [arrow], showEditor })

            handler.onDoubleClick!(ctx, { x: 100, y: 50 })
            const req: EditorRequest = showEditor.mock.calls[0][0]
            expect(req.textColor).toBe('#f0f') // falls back to strokeColor
        })
    })

    // ── Group label ───────────────────────────────────────

    describe('group label', () => {
        it('opens editor with left alignment, bold weight, and background', () => {
            const handler = new SelectHandler()
            const group = filledElement({
                id: 'g1', type: 'group',
                x: 100, y: 200, width: 300, height: 200,
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [group], showEditor })

            // Click on the border (groups are border-only hit)
            handler.onDoubleClick!(ctx, { x: 100, y: 250 })

            expect(showEditor).toHaveBeenCalledTimes(1)
            const req: EditorRequest = showEditor.mock.calls[0][0]
            expect(req.textAlign).toBe('left')
            expect(req.fontWeight).toBe(600)
            expect(req.background).toBeDefined()
            expect(req.worldX).toBe(112) // hit.x + 12
            expect(req.worldY).toBe(198) // hit.y - 2
        })

        it('stores text in text field via onCommit', () => {
            const handler = new SelectHandler()
            const group = filledElement({
                id: 'g1', type: 'group',
                x: 100, y: 200, width: 300, height: 200,
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [group], showEditor })

            // Click on the border (groups are border-only hit)
            handler.onDoubleClick!(ctx, { x: 100, y: 250 })
            const req: EditorRequest = showEditor.mock.calls[0][0]
            req.onCommit('Group Name')

            expect(group.text).toBe('Group Name')
            expect(group.label).toBeUndefined() // NOT label
        })
    })

    // ── Shape text (rectangle, ellipse, diamond) ──────────

    describe('shape text', () => {
        it('opens editor with center alignment and shape container dimensions', () => {
            const handler = new SelectHandler()
            const rect = filledElement({
                id: 'r1', type: 'rectangle',
                x: 100, y: 100, width: 200, height: 150,
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [rect], showEditor })

            handler.onDoubleClick!(ctx, { x: 150, y: 150 })

            expect(showEditor).toHaveBeenCalledTimes(1)
            const req: EditorRequest = showEditor.mock.calls[0][0]
            expect(req.textAlign).toBe('center')
            expect(req.shapeWidth).toBe(200)
            expect(req.shapeHeight).toBe(150)
            expect(req.worldX).toBe(100) // hit.x (flex container handles centering)
            expect(req.worldY).toBe(100) // hit.y
        })

        it('stores text in text field via onCommit', () => {
            const handler = new SelectHandler()
            const rect = filledElement({
                id: 'r1', type: 'rectangle',
                x: 100, y: 100, width: 200, height: 150,
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [rect], showEditor })

            handler.onDoubleClick!(ctx, { x: 150, y: 150 })
            const req: EditorRequest = showEditor.mock.calls[0][0]
            req.onCommit('Shape Label')

            expect(rect.text).toBe('Shape Label')
        })
    })

    // ── Standalone text ───────────────────────────────────

    describe('standalone text', () => {
        it('opens editor with left alignment and no shape container', () => {
            const handler = new SelectHandler()
            const textEl = filledElement({
                id: 't1', type: 'text',
                x: 50, y: 80, width: 100, height: 20,
                text: 'some existing text',
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [textEl], showEditor })

            handler.onDoubleClick!(ctx, { x: 55, y: 70 })

            expect(showEditor).toHaveBeenCalledTimes(1)
            const req: EditorRequest = showEditor.mock.calls[0][0]
            expect(req.textAlign).toBe('left')
            expect(req.shapeWidth).toBeUndefined()
            expect(req.shapeHeight).toBeUndefined()
            expect(req.worldX).toBe(50) // hit.x (not center)
            expect(req.worldY).toBe(80) // hit.y
        })

        it('stores text in text field via onCommit', () => {
            const handler = new SelectHandler()
            const textEl = filledElement({
                id: 't1', type: 'text',
                x: 50, y: 80, width: 100, height: 20,
                text: 'some existing text',
            })
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [textEl], showEditor })

            handler.onDoubleClick!(ctx, { x: 55, y: 70 })
            const req: EditorRequest = showEditor.mock.calls[0][0]
            req.onCommit('updated text')

            expect(textEl.text).toBe('updated text')
        })
    })

    // ── No hit ────────────────────────────────────────────

    describe('no hit', () => {
        it('does not open editor when double-clicking empty space', () => {
            const handler = new SelectHandler()
            const showEditor = vi.fn()
            const ctx = makeMockContext({ elements: [], showEditor })

            handler.onDoubleClick!(ctx, { x: 500, y: 500 })

            expect(showEditor).not.toHaveBeenCalled()
        })
    })
})
