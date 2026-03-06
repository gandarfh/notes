/**
 * Unified Selection Tests — blocks + drawing shapes interact as one.
 *
 * These tests simulate the REAL state flow: when onSelectEntities is called,
 * it updates the state that getSelectedBlockIds reads from. No static mocks.
 */
import { describe, it, expect, vi } from 'vitest'
import { SelectHandler } from '../handlers/select'
import { ShapeHandler } from '../handlers/shape'
import { makeMockContext } from './mockContext'
import { makeElement } from './fixtures'
import type { DrawingContext, InteractionHandler } from '../interfaces'

function makeKeyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return { key, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...opts } as unknown as KeyboardEvent
}

/** Element with filled background so hitTest works without WASM */
function filledElement(overrides: Partial<Parameters<typeof makeElement>[0]> = {}) {
    return makeElement({ backgroundColor: '#ccc', ...overrides })
}

/**
 * Simulates real store behavior: onSelectEntities updates the state
 * that getSelectedBlockIds reads from. blockIds is the set of IDs
 * that represent blocks (vs drawing elements).
 */
function makeStatefulContext(opts: {
    elements?: ReturnType<typeof makeElement>[],
    blockRects?: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    selectedElements?: Set<string>,
    selectedElement?: ReturnType<typeof makeElement> | null,
    blockIdSet?: Set<string>, // Which IDs are blocks (not shapes)
    initialSelectedIds?: Set<string>, // Pre-selected entity IDs
}) {
    const blockIdSet = opts.blockIdSet ?? new Set(opts.blockRects?.map(r => r.id) ?? [])
    let selectedIds = new Set(opts.initialSelectedIds ?? [])

    const onMoveBlocks = vi.fn()
    const onDeleteBlocks = vi.fn()
    const onSelectEntities = vi.fn((ids: string[]) => {
        // Simulate store: selectMultiple sets selectedIds
        selectedIds = new Set(ids)
    })

    const ctx = makeMockContext({
        elements: opts.elements ?? [],
        selectedElement: opts.selectedElement ?? null,
        selectedElements: opts.selectedElements ?? new Set(),
        blockRects: opts.blockRects ?? [],
        getSelectedBlockIds: () => {
            // Simulate store: filter selectedIds by block membership
            const result: string[] = []
            for (const id of selectedIds) {
                if (blockIdSet.has(id)) result.push(id)
            }
            return result
        },
        onMoveBlocks,
        onDeleteBlocks,
        onSelectEntities,
    })

    return { ctx, onMoveBlocks, onDeleteBlocks, onSelectEntities, getSelectedIds: () => selectedIds }
}

// ═══════════════════════════════════════════════════════════════
// SCENARIO: Box-select both shapes and blocks, then interact
// ═══════════════════════════════════════════════════════════════

describe('Cross-type: box-select → arrow keys', () => {
    it('box-select shape+block, then ArrowRight moves both', () => {
        const handler = new SelectHandler()
        const shape = makeElement({ id: 'shape1', x: 50, y: 50, width: 40, height: 40 })

        const { ctx, onMoveBlocks } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 200, y: 50, width: 100, height: 80 }],
        })

        // Step 1: box-select covering both
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 400, y: 200 })
        handler.onMouseUp(ctx)

        // Verify: shape in drawing selection, block in store
        expect(ctx.selectedElements.has('shape1')).toBe(true)
        // getSelectedBlockIds should now return block1 (onSelectEntities was called)
        expect(ctx.getSelectedBlockIds()).toEqual(['block1'])

        // Step 2: press ArrowRight
        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('ArrowRight'))

        expect(consumed).toBe(true)
        // Shape moved directly
        expect(shape.x).toBe(51)
        // Block moved via callback
        expect(onMoveBlocks).toHaveBeenCalledWith([{ id: 'block1', x: 201, y: 50 }])
    })

    it('box-select shape+block, then Shift+ArrowDown moves both by 10px', () => {
        const handler = new SelectHandler()
        const shape = makeElement({ id: 'shape1', x: 100, y: 100, width: 40, height: 40 })

        const { ctx, onMoveBlocks } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 200, y: 100, width: 100, height: 80 }],
        })

        // Box-select both
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 400, y: 300 })
        handler.onMouseUp(ctx)

        // Shift+ArrowDown
        handler.onKeyDown!(ctx, makeKeyEvent('ArrowDown', { shiftKey: true }))

        expect(shape.y).toBe(110)
        expect(onMoveBlocks).toHaveBeenCalledWith([{ id: 'block1', x: 200, y: 110 }])
    })
})

describe('Cross-type: box-select → Delete', () => {
    it('box-select shape+block, then Delete removes both', () => {
        const handler = new SelectHandler()
        const shape = makeElement({ id: 'shape1', x: 50, y: 50, width: 40, height: 40 })
        const keep = makeElement({ id: 'keep', x: 500, y: 500, width: 40, height: 40 })

        const { ctx, onDeleteBlocks } = makeStatefulContext({
            elements: [shape, keep],
            blockRects: [{ id: 'block1', x: 200, y: 50, width: 100, height: 80 }],
        })

        // Box-select only shape1 and block1 (not 'keep')
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 350, y: 200 })
        handler.onMouseUp(ctx)

        expect(ctx.selectedElements.has('shape1')).toBe(true)
        expect(ctx.selectedElements.has('keep')).toBe(false)
        expect(ctx.getSelectedBlockIds()).toEqual(['block1'])

        // Delete
        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('Delete'))

        expect(consumed).toBe(true)
        // Shape removed from elements array
        expect(ctx.elements.map(e => e.id)).toEqual(['keep'])
        // Block removed via callback
        expect(onDeleteBlocks).toHaveBeenCalledWith(['block1'])
    })
})

// ═══════════════════════════════════════════════════════════════
// SCENARIO: Shift+click cross-type, then interact
// ═══════════════════════════════════════════════════════════════

describe('Cross-type: shift+click shape then block', () => {
    it('click shape, shift+click block, then ArrowRight moves both', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        const { ctx, onMoveBlocks, onSelectEntities } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
        })

        // Step 1: click on shape (normal click)
        handler.onMouseDown(ctx, { x: 80, y: 70 })
        handler.onMouseUp(ctx)

        expect(ctx.selectedElement).toBe(shape)
        expect(ctx.selectedElements.has('shape1')).toBe(true)
        // onSelectEntities was called with ['shape1']
        expect(onSelectEntities).toHaveBeenLastCalledWith(['shape1'])

        // Step 2: shift+click on block
        handler.setShiftKey(true)
        handler.onMouseDown(ctx, { x: 330, y: 70 })
        handler.onMouseUp(ctx)

        // onSelectEntities should include both
        expect(onSelectEntities).toHaveBeenLastCalledWith(
            expect.arrayContaining(['shape1', 'block1'])
        )
        // getSelectedBlockIds should return block1
        expect(ctx.getSelectedBlockIds()).toEqual(['block1'])
        // Drawing layer still has shape1
        expect(ctx.selectedElements.has('shape1')).toBe(true)

        // Step 3: press ArrowRight
        handler.setShiftKey(false)
        const consumed = handler.onKeyDown!(ctx, makeKeyEvent('ArrowRight'))

        expect(consumed).toBe(true)
        expect(shape.x).toBe(51)
        expect(onMoveBlocks).toHaveBeenCalledWith([{ id: 'block1', x: 301, y: 50 }])
    })

    it('click shape, shift+click block, then Delete removes both', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        const { ctx, onDeleteBlocks, onSelectEntities } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
        })

        // Click shape
        handler.onMouseDown(ctx, { x: 80, y: 70 })
        handler.onMouseUp(ctx)

        // Shift+click block
        handler.setShiftKey(true)
        handler.onMouseDown(ctx, { x: 330, y: 70 })
        handler.onMouseUp(ctx)

        handler.setShiftKey(false)
        handler.onKeyDown!(ctx, makeKeyEvent('Delete'))

        expect(ctx.elements).toHaveLength(0)
        expect(onDeleteBlocks).toHaveBeenCalledWith(['block1'])
    })
})

describe('Cross-type: shift+click block then shape', () => {
    it('pre-selected block, shift+click shape, then ArrowUp moves both', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        // Block is already selected (simulating BlockContainer did selectBlock)
        const { ctx, onMoveBlocks, onSelectEntities } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
            initialSelectedIds: new Set(['block1']),
        })

        // Shift+click on shape (block already in store selection)
        handler.setShiftKey(true)
        handler.onMouseDown(ctx, { x: 80, y: 70 })
        handler.onMouseUp(ctx)

        // Should include both
        expect(onSelectEntities).toHaveBeenLastCalledWith(
            expect.arrayContaining(['shape1', 'block1'])
        )
        expect(ctx.selectedElements.has('shape1')).toBe(true)
        expect(ctx.getSelectedBlockIds()).toEqual(['block1'])

        // Arrow up
        handler.setShiftKey(false)
        handler.onKeyDown!(ctx, makeKeyEvent('ArrowUp'))

        expect(shape.y).toBe(49)
        expect(onMoveBlocks).toHaveBeenCalledWith([{ id: 'block1', x: 300, y: 49 }])
    })
})

// ═══════════════════════════════════════════════════════════════
// SCENARIO: Group drag with mixed selection
// ═══════════════════════════════════════════════════════════════

describe('Cross-type: group drag', () => {
    it('box-select shape+block, click selected shape, drag moves both', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        // Mock DOM for block drag
        const mockBlockEl = { style: { left: '300px', top: '50px' } }
        vi.stubGlobal('document', {
            ...document,
            querySelector: (sel: string) => sel.includes('block1') ? mockBlockEl : null,
        })

        const { ctx, onMoveBlocks } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
        })

        // Box-select both
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 500, y: 200 })
        handler.onMouseUp(ctx)

        // Verify selection
        expect(ctx.selectedElements.has('shape1')).toBe(true)
        expect(ctx.getSelectedBlockIds()).toEqual(['block1'])

        // Click on shape1 (already selected, multi-selection) → starts group drag
        handler.onMouseDown(ctx, { x: 80, y: 70 })
        // Drag by (30, 20)
        handler.onMouseMove(ctx, { x: 110, y: 90 })

        // Shape moved directly
        expect(shape.x).toBe(80)
        expect(shape.y).toBe(70)

        // Block moved via DOM
        expect(mockBlockEl.style.left).toBe('330px')
        expect(mockBlockEl.style.top).toBe('70px')

        // Release → commit
        handler.onMouseUp(ctx)
        expect(onMoveBlocks).toHaveBeenCalled()

        vi.unstubAllGlobals()
    })

    it('box-select shape+block, click on selected block, drag moves both', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        // Mock DOM for block drag
        const mockBlockEl = { style: { left: '300px', top: '50px' } }
        vi.stubGlobal('document', {
            ...document,
            querySelector: (sel: string) => sel.includes('block1') ? mockBlockEl : null,
        })

        const { ctx, onMoveBlocks } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
        })

        // Box-select both
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 500, y: 200 })
        handler.onMouseUp(ctx)

        // Click on block1 (already selected, multi-selection) → starts group drag
        handler.onMouseDown(ctx, { x: 330, y: 70 })
        // Drag by (50, 50)
        handler.onMouseMove(ctx, { x: 380, y: 120 })

        // Shape moved directly
        expect(shape.x).toBe(100)
        expect(shape.y).toBe(100)

        // Block moved via DOM
        expect(mockBlockEl.style.left).toBe('350px')
        expect(mockBlockEl.style.top).toBe('100px')

        handler.onMouseUp(ctx)
        expect(onMoveBlocks).toHaveBeenCalled()

        vi.unstubAllGlobals()
    })
})

// ═══════════════════════════════════════════════════════════════
// SCENARIO: Selection sync between layers
// ═══════════════════════════════════════════════════════════════

describe('Cross-type: selection state consistency', () => {
    it('clicking shape clears block from store selection', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        const { ctx, onSelectEntities, getSelectedIds } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
            initialSelectedIds: new Set(['block1']),
        })

        // Click on shape (normal, no shift)
        handler.onMouseDown(ctx, { x: 80, y: 70 })

        // Store should now have only shape1 (block1 cleared)
        expect(onSelectEntities).toHaveBeenCalledWith(['shape1'])
        expect(getSelectedIds().has('block1')).toBe(false)
        expect(getSelectedIds().has('shape1')).toBe(true)
    })

    it('clicking empty space clears everything', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        const { ctx, onSelectEntities, getSelectedIds } = makeStatefulContext({
            elements: [shape],
            selectedElements: new Set(['shape1']),
            selectedElement: shape,
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
            initialSelectedIds: new Set(['shape1', 'block1']),
        })

        // Click on empty space
        handler.onMouseDown(ctx, { x: 800, y: 800 })

        expect(ctx.selectedElement).toBeNull()
        expect(ctx.selectedElements.size).toBe(0)
        expect(onSelectEntities).toHaveBeenCalledWith([])
        expect(getSelectedIds().size).toBe(0)
    })

    it('clicking block clears shape from drawing selection', () => {
        const handler = new SelectHandler()
        const shape = filledElement({ id: 'shape1', x: 50, y: 50, width: 100, height: 80 })

        const { ctx, onSelectEntities } = makeStatefulContext({
            elements: [shape],
            selectedElements: new Set(['shape1']),
            selectedElement: shape,
            blockRects: [{ id: 'block1', x: 300, y: 50, width: 100, height: 80 }],
            initialSelectedIds: new Set(['shape1']),
        })

        // Click on block1 (normal, no shift)
        handler.onMouseDown(ctx, { x: 330, y: 70 })

        // Drawing selection should be cleared
        expect(ctx.selectedElement).toBeNull()
        expect(ctx.selectedElements.size).toBe(0)
        // Store should have only block1
        expect(onSelectEntities).toHaveBeenCalledWith(['block1'])
    })
})

// ═══════════════════════════════════════════════════════════════
// SCENARIO: Escape clears everything (tested at handler level)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// BUG SCENARIO: Active tool is NOT draw-select, blocks are selected
// This simulates the REAL issue: user clicks block (tool stays rectangle),
// then tries arrow keys — SelectHandler never runs.
// ═══════════════════════════════════════════════════════════════

describe('Cross-type: keyboard works regardless of active tool', () => {
    /**
     * Simulates the useDrawing keyboard handler flow:
     * 1. Active handler tries first (e.g. ShapeHandler)
     * 2. If it returns false, fallback to SelectHandler for unified keys
     */
    function simulateKeyboardFlow(
        activeHandler: InteractionHandler,
        selectHandler: SelectHandler,
        ctx: DrawingContext,
        key: string,
        opts: Partial<KeyboardEvent> = {},
    ): boolean {
        const e = makeKeyEvent(key, opts)

        // Step 1: active handler tries first (this is what useDrawing does)
        if (activeHandler.onKeyDown?.(ctx, e)) return true

        // Step 2: FALLBACK — should try SelectHandler for unified keys
        // THIS IS THE BUG: useDrawing doesn't do this step!
        // Once fixed, this test should pass.
        if (selectHandler.onKeyDown?.(ctx, e)) return true

        return false
    }

    it('BUG: arrow keys move block even when ShapeHandler is active', () => {
        const selectHandler = new SelectHandler()
        const shapeHandler = new ShapeHandler('rectangle')

        const { ctx, onMoveBlocks } = makeStatefulContext({
            elements: [],
            blockRects: [{ id: 'block1', x: 100, y: 100, width: 80, height: 60 }],
            initialSelectedIds: new Set(['block1']),
        })

        const consumed = simulateKeyboardFlow(shapeHandler, selectHandler, ctx, 'ArrowRight')

        expect(consumed).toBe(true)
        expect(onMoveBlocks).toHaveBeenCalledWith([{ id: 'block1', x: 101, y: 100 }])
    })

    it('BUG: Delete removes block even when ShapeHandler is active', () => {
        const selectHandler = new SelectHandler()
        const shapeHandler = new ShapeHandler('rectangle')

        const { ctx, onDeleteBlocks } = makeStatefulContext({
            elements: [],
            blockRects: [{ id: 'block1', x: 100, y: 100, width: 80, height: 60 }],
            initialSelectedIds: new Set(['block1']),
        })

        const consumed = simulateKeyboardFlow(shapeHandler, selectHandler, ctx, 'Delete')

        expect(consumed).toBe(true)
        expect(onDeleteBlocks).toHaveBeenCalledWith(['block1'])
    })

    it('BUG: arrow keys move mixed selection when tool is not select', () => {
        const selectHandler = new SelectHandler()
        const shapeHandler = new ShapeHandler('rectangle')
        const shape = makeElement({ id: 'shape1', x: 200, y: 200 })

        const { ctx, onMoveBlocks } = makeStatefulContext({
            elements: [shape],
            selectedElements: new Set(['shape1']),
            blockRects: [{ id: 'block1', x: 100, y: 100, width: 80, height: 60 }],
            initialSelectedIds: new Set(['shape1', 'block1']),
        })

        const consumed = simulateKeyboardFlow(shapeHandler, selectHandler, ctx, 'ArrowUp')

        expect(consumed).toBe(true)
        expect(shape.y).toBe(199)
        expect(onMoveBlocks).toHaveBeenCalledWith([{ id: 'block1', x: 100, y: 99 }])
    })
})

describe('Cross-type: escape after mixed selection', () => {
    it('after box-select, no remaining selection in drawing refs', () => {
        const handler = new SelectHandler()
        const shape = makeElement({ id: 'shape1', x: 50, y: 50, width: 40, height: 40 })

        const { ctx } = makeStatefulContext({
            elements: [shape],
            blockRects: [{ id: 'block1', x: 200, y: 50, width: 100, height: 80 }],
        })

        // Box-select both
        handler.onMouseDown(ctx, { x: 0, y: 0 })
        handler.onMouseMove(ctx, { x: 400, y: 200 })
        handler.onMouseUp(ctx)

        expect(ctx.selectedElements.size).toBeGreaterThan(0)

        // Deactivate (simulates what Escape does via setSubTool → deactivate)
        handler.deactivate(ctx)

        expect(ctx.selectedElement).toBeNull()
        expect(ctx.selectedElements.size).toBe(0)
    })
})
