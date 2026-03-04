import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock bridge modules before importing store
vi.mock('../../bridge/wails', () => ({
    api: {
        updateViewport: vi.fn(),
        createBlock: vi.fn(),
        deleteBlock: vi.fn(),
        updateBlockPosition: vi.fn(),
        updateBlockContent: vi.fn(),
        createConnection: vi.fn(),
        deleteConnection: vi.fn(),
        updateConnection: vi.fn(),
        updateDrawingData: vi.fn(),
        getPageState: vi.fn(),
        listPages: vi.fn(),
    },
    onEvent: vi.fn(() => () => {}),
}))

vi.mock('../../bridge/persistBus', () => ({
    persistBus: { emit: vi.fn((_key: string, fn: () => void) => fn()) },
}))

import { useAppStore } from '../index'
import { mergeBlocks } from '../helpers'
import type { Block, Connection } from '../../bridge/wails'

function makeBlock(id: string, overrides: Partial<Block> = {}): Block {
    return {
        id,
        pageId: 'page_1',
        type: 'markdown',
        x: 0, y: 0, width: 200, height: 150,
        content: '', filePath: '', styleJson: '',
        createdAt: '', updatedAt: '',
        ...overrides,
    } as Block
}

function makeConn(id: string, overrides: Partial<Connection> = {}): Connection {
    return {
        id,
        pageId: 'page_1',
        fromBlockId: 'b1', toBlockId: 'b2',
        label: '', color: '#000', style: 'solid',
        createdAt: '', updatedAt: '',
        ...overrides,
    } as Connection
}

describe('canvasSlice: viewport', () => {
    beforeEach(() => {
        useAppStore.setState({ viewport: { x: 0, y: 0, zoom: 1 } })
    })

    it('setViewport updates all values', () => {
        useAppStore.getState().setViewport(100, 200, 2)
        expect(useAppStore.getState().viewport).toEqual({ x: 100, y: 200, zoom: 2 })
    })

    it('pan adds deltas', () => {
        useAppStore.getState().setViewport(50, 50, 1)
        useAppStore.getState().pan(10, -20)
        expect(useAppStore.getState().viewport).toEqual({ x: 60, y: 30, zoom: 1 })
    })

    it('zoomTo without center changes zoom only', () => {
        useAppStore.getState().setViewport(100, 100, 1)
        useAppStore.getState().zoomTo(2)
        const v = useAppStore.getState().viewport
        expect(v.zoom).toBe(2)
        expect(v.x).toBe(100)
        expect(v.y).toBe(100)
    })

    it('zoomTo with center adjusts x/y to maintain zoom center', () => {
        useAppStore.getState().setViewport(0, 0, 1)
        useAppStore.getState().zoomTo(2, 100, 100)
        const v = useAppStore.getState().viewport
        expect(v.zoom).toBe(2)
        // formula: x = cx - (cx - vx) * (newZoom/oldZoom) = 100 - (100 - 0) * 2 = -100
        expect(v.x).toBe(-100)
        expect(v.y).toBe(-100)
    })

    it('resetZoom sets zoom to 1', () => {
        useAppStore.getState().setViewport(50, 50, 3)
        useAppStore.getState().resetZoom()
        const v = useAppStore.getState().viewport
        expect(v.zoom).toBe(1)
        expect(v.x).toBe(50)  // position preserved
    })
})

describe('blockSlice: mutations', () => {
    beforeEach(() => {
        useAppStore.setState({
            blocks: new Map(),
            selectedBlockId: null,
            editingBlockId: null,
        })
    })

    it('addBlock adds to map', () => {
        const b = makeBlock('b1')
        useAppStore.getState().addBlock(b)
        expect(useAppStore.getState().blocks.get('b1')).toBeDefined()
        expect(useAppStore.getState().blocks.size).toBe(1)
    })

    it('removeBlock removes from map', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().removeBlock('b1')
        expect(useAppStore.getState().blocks.size).toBe(0)
    })

    it('removeBlock clears selection if removed block is selected', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().selectBlock('b1')
        useAppStore.getState().removeBlock('b1')
        expect(useAppStore.getState().selectedBlockId).toBeNull()
    })

    it('removeBlock clears editing if removed block is editing', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().setEditing('b1')
        useAppStore.getState().removeBlock('b1')
        expect(useAppStore.getState().editingBlockId).toBeNull()
    })

    it('updateBlock merges partial updates', () => {
        useAppStore.getState().addBlock(makeBlock('b1', { x: 10, y: 20 }))
        useAppStore.getState().updateBlock('b1', { x: 50 })
        const b = useAppStore.getState().blocks.get('b1')!
        expect(b.x).toBe(50)
        expect(b.y).toBe(20)  // unchanged
    })

    it('selectBlock updates selectedBlockId', () => {
        useAppStore.getState().selectBlock('b1')
        expect(useAppStore.getState().selectedBlockId).toBe('b1')
        useAppStore.getState().selectBlock(null)
        expect(useAppStore.getState().selectedBlockId).toBeNull()
    })

    it('moveBlock updates x and y', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().moveBlock('b1', 100, 200)
        const b = useAppStore.getState().blocks.get('b1')!
        expect(b.x).toBe(100)
        expect(b.y).toBe(200)
    })

    it('resizeBlock updates width and height', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().resizeBlock('b1', 300, 400)
        const b = useAppStore.getState().blocks.get('b1')!
        expect(b.width).toBe(300)
        expect(b.height).toBe(400)
    })
})

describe('connectionSlice: mutations', () => {
    beforeEach(() => {
        useAppStore.setState({ connections: [] })
    })

    it('setConnections replaces array', () => {
        const conns = [makeConn('c1'), makeConn('c2')]
        useAppStore.getState().setConnections(conns)
        expect(useAppStore.getState().connections).toHaveLength(2)
    })

    it('addConnection appends', () => {
        useAppStore.getState().addConnection(makeConn('c1'))
        useAppStore.getState().addConnection(makeConn('c2'))
        expect(useAppStore.getState().connections).toHaveLength(2)
    })

    it('removeConnection filters by id', () => {
        useAppStore.getState().setConnections([makeConn('c1'), makeConn('c2')])
        useAppStore.getState().removeConnection('c1')
        expect(useAppStore.getState().connections).toHaveLength(1)
        expect(useAppStore.getState().connections[0].id).toBe('c2')
    })
})

describe('drawingSlice: style', () => {
    it('setDrawingSubTool updates tool', () => {
        useAppStore.getState().setDrawingSubTool('rectangle')
        expect(useAppStore.getState().drawingSubTool).toBe('rectangle')
    })

    it('setStyleDefaults merges patch for type', () => {
        useAppStore.getState().setStyleDefaults('rectangle', { strokeColor: '#ff0000', strokeWidth: 4 })
        const defaults = useAppStore.getState().styleDefaults.rectangle
        expect(defaults.strokeColor).toBe('#ff0000')
        expect(defaults.strokeWidth).toBe(4)
        // other defaults preserved
        expect(defaults.backgroundColor).toBe('transparent')
    })

    it('setStyleDefaults does not affect other types', () => {
        const before = { ...useAppStore.getState().styleDefaults.ellipse }
        useAppStore.getState().setStyleDefaults('rectangle', { strokeColor: '#ff0000' })
        const after = useAppStore.getState().styleDefaults.ellipse
        expect(after.strokeColor).toBe(before.strokeColor)
    })
})

// ── mergeBlocks (reloadWithUndo logic) ──────────────────

describe('mergeBlocks', () => {
    it('accepts all incoming blocks when none are active', () => {
        const incoming = new Map([
            ['b1', makeBlock('b1', { x: 100, y: 200 })],
            ['b2', makeBlock('b2', { x: 300, y: 400 })],
        ])
        const current = new Map([
            ['b1', makeBlock('b1', { x: 0, y: 0 })],
        ])
        const result = mergeBlocks(incoming, current, new Set())
        expect(result.get('b1')!.x).toBe(100)
        expect(result.get('b1')!.y).toBe(200)
        expect(result.get('b2')!.x).toBe(300)
    })

    it('preserves position of selected block', () => {
        const incoming = new Map([
            ['b1', makeBlock('b1', { x: 999, y: 999, content: 'updated' })],
        ])
        const current = new Map([
            ['b1', makeBlock('b1', { x: 10, y: 20, width: 200, height: 150 })],
        ])
        const result = mergeBlocks(incoming, current, new Set(['b1']))
        // Position preserved from current
        expect(result.get('b1')!.x).toBe(10)
        expect(result.get('b1')!.y).toBe(20)
        expect(result.get('b1')!.width).toBe(200)
        expect(result.get('b1')!.height).toBe(150)
        // Content updated from incoming
        expect(result.get('b1')!.content).toBe('updated')
    })

    it('preserves position of editing block', () => {
        const incoming = new Map([
            ['b1', makeBlock('b1', { x: 500, y: 500 })],
        ])
        const current = new Map([
            ['b1', makeBlock('b1', { x: 30, y: 40 })],
        ])
        const result = mergeBlocks(incoming, current, new Set(['b1']))
        expect(result.get('b1')!.x).toBe(30)
        expect(result.get('b1')!.y).toBe(40)
    })

    it('removes blocks not in incoming (deleted on server)', () => {
        const incoming = new Map([
            ['b2', makeBlock('b2')],
        ])
        const current = new Map([
            ['b1', makeBlock('b1')],
            ['b2', makeBlock('b2')],
        ])
        const result = mergeBlocks(incoming, current, new Set())
        expect(result.has('b1')).toBe(false)
        expect(result.has('b2')).toBe(true)
    })

    it('adds new blocks from incoming', () => {
        const incoming = new Map([
            ['b1', makeBlock('b1')],
            ['b_new', makeBlock('b_new', { x: 777 })],
        ])
        const current = new Map([
            ['b1', makeBlock('b1')],
        ])
        const result = mergeBlocks(incoming, current, new Set())
        expect(result.has('b_new')).toBe(true)
        expect(result.get('b_new')!.x).toBe(777)
    })

    it('handles null in activeIds gracefully', () => {
        const incoming = new Map([['b1', makeBlock('b1', { x: 100 })]])
        const current = new Map([['b1', makeBlock('b1', { x: 0 })]])
        // null selectedId doesn't match any block
        const result = mergeBlocks(incoming, current, new Set([null]))
        expect(result.get('b1')!.x).toBe(100)
    })
})
