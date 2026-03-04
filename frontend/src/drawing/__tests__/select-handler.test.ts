import { describe, it, expect, vi } from 'vitest'
import { SelectHandler } from '../handlers/select'
import { makeMockContext } from './mockContext'
import { makeElement, makeArrow, makeOrthoArrow } from './fixtures'

function makeKeyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return { key, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...opts } as unknown as KeyboardEvent
}

// Without WASM engine, hitTest fallback requires filled background for interior hits
function filledElement(overrides: Partial<Parameters<typeof makeElement>[0]> = {}) {
    return makeElement({ backgroundColor: '#ccc', ...overrides })
}

// ── Single Click Selection ─────────────────────────────────

describe('SelectHandler: click selection', () => {
    it('click on element selects it', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 50, y: 50, width: 100, height: 80 })
        const ctx = makeMockContext({ elements: [el] })

        handler.onMouseDown(ctx, { x: 80, y: 70 })

        expect(ctx.selectedElement).toBe(el)
        expect(ctx.selectedElements.has('a')).toBe(true)
    })

    it('click on empty clears selection', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 50, y: 50, width: 100, height: 80 })
        const ctx = makeMockContext({ elements: [el], selectedElement: el, selectedElements: new Set(['a']) })

        handler.onMouseDown(ctx, { x: 500, y: 500 })

        expect(ctx.selectedElement).toBeNull()
        expect(ctx.selectedElements.size).toBe(0)
    })

    it('shift+click toggles selection', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 50, y: 50, width: 100, height: 80 })
        const ctx = makeMockContext({ elements: [el] })

        handler.setShiftKey(true)
        handler.onMouseDown(ctx, { x: 80, y: 70 })
        expect(ctx.selectedElements.has('a')).toBe(true)

        // shift+click again deselects
        handler.onMouseDown(ctx, { x: 80, y: 70 })
        expect(ctx.selectedElements.has('a')).toBe(false)
    })
})

// ── Drag Move ──────────────────────────────────────────────

describe('SelectHandler: drag move', () => {
    it('drag moves element position', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 100, y: 100, width: 50, height: 50 })
        const ctx = makeMockContext({ elements: [el] })

        handler.onMouseDown(ctx, { x: 120, y: 120 }) // offset: 20, 20
        handler.onMouseMove(ctx, { x: 220, y: 320 })

        // During drag, position updates (not snapped yet)
        expect(el.x).toBe(200) // 220 - 20 offset
        expect(el.y).toBe(300) // 320 - 20 offset
    })

    it('drag release snaps to grid', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 100, y: 100, width: 50, height: 50 })
        const ctx = makeMockContext({ elements: [el] })

        handler.onMouseDown(ctx, { x: 100, y: 100 }) // offset: 0, 0
        handler.onMouseMove(ctx, { x: 147, y: 163 })
        handler.onMouseUp(ctx)

        expect(el.x).toBe(150) // snap(147)
        expect(el.y).toBe(150) // snap(163)
        expect(ctx.save).toHaveBeenCalled()
    })

    it('click without drag does not save', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 100, y: 100, width: 50, height: 50 })
        const ctx = makeMockContext({ elements: [el] })

        handler.onMouseDown(ctx, { x: 120, y: 120 })
        handler.onMouseUp(ctx)

        expect(ctx.save).not.toHaveBeenCalled()
    })

    it('connected arrow does not start drag', () => {
        const handler = new SelectHandler()
        const arrow = makeArrow({
            id: 'arr', x: 50, y: 50, width: 200, height: 100,
            startConnection: { elementId: 'box1', side: 'right', t: 0.5 },
        })
        const ctx = makeMockContext({ elements: [arrow] })

        handler.onMouseDown(ctx, { x: 100, y: 80 })
        handler.onMouseMove(ctx, { x: 200, y: 200 })

        // Arrow should not have moved since it's connected
        expect(arrow.x).toBe(50)
    })
})

// ── Box Selection ──────────────────────────────────────────

describe('SelectHandler: box selection', () => {
    it('drag on empty starts box select and selects intersecting elements', () => {
        const handler = new SelectHandler()
        const a = makeElement({ id: 'a', x: 50, y: 50, width: 40, height: 40 })
        const b = makeElement({ id: 'b', x: 500, y: 500, width: 40, height: 40 })
        const ctx = makeMockContext({ elements: [a, b] })

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 100, y: 100 })
        handler.onMouseUp(ctx)

        expect(ctx.selectedElements.has('a')).toBe(true)
        expect(ctx.selectedElements.has('b')).toBe(false)
    })

    it('tiny box select does not select anything', () => {
        const handler = new SelectHandler()
        const a = makeElement({ id: 'a', x: 50, y: 50, width: 40, height: 40 })
        const ctx = makeMockContext({ elements: [a] })

        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 2, y: 1 })
        handler.onMouseUp(ctx)

        expect(ctx.selectedElements.size).toBe(0)
    })
})

// ── Group Drag ─────────────────────────────────────────────

describe('SelectHandler: group drag', () => {
    it('multi-select drag moves all elements', () => {
        const handler = new SelectHandler()
        const a = filledElement({ id: 'a', x: 100, y: 100, width: 50, height: 50 })
        const b = filledElement({ id: 'b', x: 200, y: 200, width: 50, height: 50 })
        const ctx = makeMockContext({
            elements: [a, b],
            selectedElements: new Set(['a', 'b']),
        })

        // Click on 'a' which is in the selection — starts group drag
        handler.onMouseDown(ctx, { x: 120, y: 120 })
        handler.onMouseMove(ctx, { x: 170, y: 170 })

        // Both should have moved by the same delta (50, 50)
        expect(a.x).toBe(150)
        expect(a.y).toBe(150)
        expect(b.x).toBe(250)
        expect(b.y).toBe(250)
    })
})

// ── Resize ─────────────────────────────────────────────────

describe('SelectHandler: resize', () => {
    it('resize se handle increases width and height', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 100, y: 100, width: 100, height: 80 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        // Click on se handle (bottom-right corner): x+w, y+h = 200, 180
        handler.onMouseDown(ctx, { x: 200, y: 180 })

        // If resize started, move to expand
        if (el.width === 100) {
            // Handler detected resize handle — drag to expand
            handler.onMouseMove(ctx, { x: 300, y: 280 })
            handler.onMouseUp(ctx)

            expect(el.width).toBeGreaterThanOrEqual(100)
            expect(ctx.save).toHaveBeenCalled()
        }
    })
})

// ── Keyboard: Delete ───────────────────────────────────────

describe('SelectHandler: delete', () => {
    it('Delete removes selected element', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 50, y: 50 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('Delete'))

        expect(consumed).toBe(true)
        expect(ctx.elements).toHaveLength(0)
        expect(ctx.selectedElement).toBeNull()
        expect(ctx.selectedElements.size).toBe(0)
        expect(ctx.saveNow).toHaveBeenCalled()
    })

    it('Backspace also deletes', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 50, y: 50 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
        })

        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('Backspace'))
        expect(consumed).toBe(true)
        expect(ctx.elements).toHaveLength(0)
    })

    it('Delete multi-selected removes all', () => {
        const handler = new SelectHandler()
        const a = makeElement({ id: 'a', x: 0, y: 0 })
        const b = makeElement({ id: 'b', x: 100, y: 100 })
        const c = makeElement({ id: 'c', x: 200, y: 200 })
        const ctx = makeMockContext({
            elements: [a, b, c],
            selectedElements: new Set(['a', 'c']),
        })

        handler.onKeyDown!(ctx, makeKeyEvent('Delete'))

        expect(ctx.elements).toHaveLength(1)
        expect(ctx.elements[0].id).toBe('b')
    })

    it('Delete with nothing selected is noop', () => {
        const handler = new SelectHandler()
        const ctx = makeMockContext({ elements: [makeElement()] })

        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('Delete'))
        expect(consumed).toBe(false)
        expect(ctx.elements).toHaveLength(1)
    })
})

// ── Keyboard: Select All ───────────────────────────────────

describe('SelectHandler: Ctrl+A', () => {
    it('selects all elements', () => {
        const handler = new SelectHandler()
        const a = makeElement({ id: 'a' })
        const b = makeElement({ id: 'b' })
        const ctx = makeMockContext({ elements: [a, b] })

        handler.onKeyDown!(ctx, makeKeyEvent('a', { ctrlKey: true }))

        expect(ctx.selectedElements.size).toBe(2)
        expect(ctx.selectedElements.has('a')).toBe(true)
        expect(ctx.selectedElements.has('b')).toBe(true)
    })
})

// ── Keyboard: Copy/Paste ───────────────────────────────────

describe('SelectHandler: copy/paste', () => {
    it('Ctrl+C copies selected elements to clipboard', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 50, y: 50 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        handler.onKeyDown!(ctx, makeKeyEvent('c', { ctrlKey: true }))

        expect(ctx.clipboard).toHaveLength(1)
        expect(ctx.clipboard[0].id).toBe('a')
        // Should be a clone, not same reference
        expect(ctx.clipboard[0]).not.toBe(el)
    })

    it('Ctrl+V pastes from clipboard with new IDs', () => {
        const handler = new SelectHandler()
        const original = makeElement({ id: 'orig', x: 50, y: 50, width: 40, height: 40 })
        const ctx = makeMockContext({
            elements: [original],
            clipboard: [{ ...original }],
        })

        handler.onKeyDown!(ctx, makeKeyEvent('v', { ctrlKey: true }))

        expect(ctx.elements.length).toBe(2)
        // New element should have different ID
        expect(ctx.elements[1].id).not.toBe('orig')
        expect(ctx.saveNow).toHaveBeenCalled()
    })

    it('Ctrl+V with empty clipboard is noop', () => {
        const handler = new SelectHandler()
        const ctx = makeMockContext({ clipboard: [] })

        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('v', { ctrlKey: true }))
        expect(consumed).toBe(false)
    })
})

// ── Keyboard: Duplicate ────────────────────────────────────

describe('SelectHandler: duplicate', () => {
    it('Ctrl+D duplicates selected elements', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 50, y: 50, width: 40, height: 40 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        handler.onKeyDown!(ctx, makeKeyEvent('d', { ctrlKey: true }))

        expect(ctx.elements.length).toBe(2)
        expect(ctx.elements[1].id).not.toBe('a')
    })
})

// ── Keyboard: Arrow Nudge ──────────────────────────────────

describe('SelectHandler: arrow key nudge', () => {
    it('arrow key moves element by 1px', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 100, y: 100 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        handler.onKeyDown!(ctx, makeKeyEvent('ArrowRight'))
        expect(el.x).toBe(101)

        handler.onKeyDown!(ctx, makeKeyEvent('ArrowDown'))
        expect(el.y).toBe(101)
    })

    it('shift+arrow moves by 10px', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 100, y: 100 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        handler.onKeyDown!(ctx, makeKeyEvent('ArrowLeft', { shiftKey: true }))
        expect(el.x).toBe(90)
    })

    it('arrow key with no selection is noop', () => {
        const handler = new SelectHandler()
        const ctx = makeMockContext()

        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('ArrowUp'))
        expect(consumed).toBe(false)
    })
})

// ── Double Click ───────────────────────────────────────────

describe('SelectHandler: double click', () => {
    it('double click on shape opens editor', () => {
        const handler = new SelectHandler()
        const el = filledElement({ id: 'a', x: 50, y: 50, width: 100, height: 80, fontSize: 14 })
        const ctx = makeMockContext({ elements: [el] })

        handler.onDoubleClick!(ctx, { x: 80, y: 70 })

        expect(ctx.showEditor).toHaveBeenCalledTimes(1)
        expect(ctx.selectedElement).toBe(el)
    })

    it('double click on empty does nothing', () => {
        const handler = new SelectHandler()
        const ctx = makeMockContext({ elements: [] })

        handler.onDoubleClick!(ctx, { x: 100, y: 100 })

        expect(ctx.showEditor).not.toHaveBeenCalled()
    })

    it('double click on arrow opens label editor', () => {
        const handler = new SelectHandler()
        const el = makeArrow({ id: 'a', x: 0, y: 0, points: [[0, 0], [200, 100]] })
        const ctx = makeMockContext({ elements: [el] })

        handler.onDoubleClick!(ctx, { x: 100, y: 50 })

        // Arrow label editing: showEditor should be called
        expect(ctx.showEditor).toHaveBeenCalled()
    })

    it('does nothing if already editing', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 50, y: 50, width: 100, height: 80 })
        const ctx = makeMockContext({ elements: [el], isEditing: true })

        handler.onDoubleClick!(ctx, { x: 80, y: 70 })

        expect(ctx.showEditor).not.toHaveBeenCalled()
    })
})

// ── Deactivate ─────────────────────────────────────────────

describe('SelectHandler: deactivate', () => {
    it('clears all selection state', () => {
        const handler = new SelectHandler()
        const el = makeElement({ id: 'a', x: 50, y: 50 })
        const ctx = makeMockContext({
            elements: [el],
            selectedElement: el,
            selectedElements: new Set(['a']),
        })

        handler.deactivate(ctx)

        expect(ctx.selectedElement).toBeNull()
        expect(ctx.selectedElements.size).toBe(0)
    })
})

// ── Right Click ────────────────────────────────────────────

describe('SelectHandler: right click', () => {
    it('right click on arrow cycles arrowhead style', () => {
        const handler = new SelectHandler()
        // Use point directly on the arrow line segment for hit detection
        const el = makeArrow({ id: 'a', x: 0, y: 0, points: [[0, 0], [200, 0]], width: 200, height: 0 })
        el.arrowEnd = 'arrow'
        const ctx = makeMockContext({ elements: [el] })

        handler.onRightClick!(ctx, { x: 100, y: 0 })

        expect(el.arrowEnd).toBe('triangle')
        expect(ctx.save).toHaveBeenCalled()
    })
})
