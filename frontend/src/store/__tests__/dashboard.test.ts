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
import { DASHBOARD_COLS, DASHBOARD_ROW_HEIGHT, GRID_SIZE, snapToGrid } from '../../constants'
import type { Block } from '../../bridge/wails'
import { api } from '../../bridge/wails'

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

/** Compute dashboard-mode snap for a position value */
function dashboardSnapX(x: number, containerWidth: number): number {
    const colW = containerWidth / DASHBOARD_COLS
    return Math.round(x / colW) * colW
}
function dashboardSnapY(y: number): number {
    return Math.round(y / DASHBOARD_ROW_HEIGHT) * DASHBOARD_ROW_HEIGHT
}
function dashboardSnapW(w: number, containerWidth: number): number {
    const colW = containerWidth / DASHBOARD_COLS
    return Math.max(2 * colW, Math.round(w / colW) * colW)
}
function dashboardSnapH(h: number): number {
    return Math.max(2 * DASHBOARD_ROW_HEIGHT, Math.round(h / DASHBOARD_ROW_HEIGHT) * DASHBOARD_ROW_HEIGHT)
}

// ── Constants ────────────────────────────────────────────

describe('dashboard grid constants', () => {
    it('DASHBOARD_COLS is 12', () => {
        expect(DASHBOARD_COLS).toBe(12)
    })

    it('DASHBOARD_ROW_HEIGHT is 60', () => {
        expect(DASHBOARD_ROW_HEIGHT).toBe(60)
    })

    it('GRID_SIZE is 30 (canvas mode)', () => {
        expect(GRID_SIZE).toBe(30)
    })
})

// ── canvasContainerWidth in store ─────────────────────────

describe('canvasSlice: canvasContainerWidth', () => {
    beforeEach(() => {
        useAppStore.setState({ canvasContainerWidth: 1200 })
    })

    it('has default value of 1200', () => {
        expect(useAppStore.getState().canvasContainerWidth).toBe(1200)
    })

    it('setCanvasContainerWidth updates value', () => {
        useAppStore.getState().setCanvasContainerWidth(960)
        expect(useAppStore.getState().canvasContainerWidth).toBe(960)
    })

    it('setCanvasContainerWidth updates to arbitrary values', () => {
        useAppStore.getState().setCanvasContainerWidth(1440)
        expect(useAppStore.getState().canvasContainerWidth).toBe(1440)
    })
})

// ── Dashboard grid snap logic ─────────────────────────────

describe('dashboard grid snapping', () => {
    const containerWidth = 1200
    const colW = containerWidth / DASHBOARD_COLS  // 100

    describe('X position snap (column-based)', () => {
        it('snaps to nearest column boundary', () => {
            expect(dashboardSnapX(155, containerWidth)).toBe(200)  // rounds to col 2
            expect(dashboardSnapX(149, containerWidth)).toBe(100)  // rounds to col 1
        })

        it('snaps 0 to 0', () => {
            expect(dashboardSnapX(0, containerWidth)).toBe(0)
        })

        it('snaps exact column boundary unchanged', () => {
            expect(dashboardSnapX(300, containerWidth)).toBe(300)
        })
    })

    describe('Y position snap (row-based)', () => {
        it('snaps to nearest row boundary', () => {
            expect(dashboardSnapY(35)).toBe(60)   // rounds up
            expect(dashboardSnapY(29)).toBe(0)     // rounds down
        })

        it('snaps exact row boundary unchanged', () => {
            expect(dashboardSnapY(120)).toBe(120)
        })
    })

    describe('Width snap with minimum of 2 columns', () => {
        it('snaps width to column units', () => {
            expect(dashboardSnapW(250, containerWidth)).toBe(300)  // rounds to 3 cols
        })

        it('enforces minimum of 2 columns', () => {
            expect(dashboardSnapW(50, containerWidth)).toBe(2 * colW)   // 200
            expect(dashboardSnapW(0, containerWidth)).toBe(2 * colW)    // 200
        })

        it('snaps exact column width unchanged', () => {
            expect(dashboardSnapW(400, containerWidth)).toBe(400)
        })
    })

    describe('Height snap with minimum of 2 rows', () => {
        it('snaps height to row units', () => {
            expect(dashboardSnapH(170)).toBe(180)  // rounds to 3 rows
        })

        it('enforces minimum of 2 rows', () => {
            expect(dashboardSnapH(30)).toBe(2 * DASHBOARD_ROW_HEIGHT)  // 120
            expect(dashboardSnapH(0)).toBe(2 * DASHBOARD_ROW_HEIGHT)   // 120
        })

        it('snaps exact row height unchanged', () => {
            expect(dashboardSnapH(240)).toBe(240)
        })
    })

    describe('different container widths', () => {
        it('adapts column width to 960px container', () => {
            const cw = 960
            const expectedColW = cw / DASHBOARD_COLS  // 80
            expect(dashboardSnapX(45, cw)).toBe(expectedColW)  // rounds to col 1
            expect(dashboardSnapW(100, cw)).toBe(2 * expectedColW)  // min 2 cols = 160
        })

        it('adapts column width to 1440px container', () => {
            const cw = 1440
            const expectedColW = cw / DASHBOARD_COLS  // 120
            expect(dashboardSnapX(65, cw)).toBe(expectedColW)  // rounds to col 1
            expect(dashboardSnapW(200, cw)).toBe(2 * expectedColW)  // 240
        })
    })
})

// ── Canvas mode snap (existing behavior) ──────────────────

describe('canvas mode snapping (unchanged)', () => {
    it('snapToGrid snaps to GRID_SIZE=30', () => {
        expect(snapToGrid(17)).toBe(30)
        expect(snapToGrid(14)).toBe(0)
        expect(snapToGrid(45)).toBe(60)  // round(1.5) = 2
        expect(snapToGrid(46)).toBe(60)
    })
})

// ── Block CRUD in board mode ──────────────────────────────

describe('dashboard mode: block operations via store', () => {
    beforeEach(() => {
        useAppStore.setState({
            blocks: new Map(),
            selectedBlockId: null,
            editingBlockId: null,
            activePageId: 'page_1',
            activePageType: 'board',
            canvasContainerWidth: 1200,
            selectedIds: new Set(),
        })
    })

    it('createBlock creates a block in board mode', async () => {
        const mockBlock = makeBlock('b1', { x: 100, y: 60, width: 200, height: 120 })
        vi.mocked(api.createBlock).mockResolvedValueOnce(mockBlock)

        const result = await useAppStore.getState().createBlock('markdown', 100, 60, 200, 120)
        expect(result).toBeDefined()
        expect(result!.id).toBe('b1')
        expect(useAppStore.getState().blocks.has('b1')).toBe(true)
    })

    it('addBlock + moveBlock works in board mode', () => {
        useAppStore.getState().addBlock(makeBlock('b1', { x: 0, y: 0 }))
        useAppStore.getState().moveBlock('b1', 300, 180)
        const b = useAppStore.getState().blocks.get('b1')!
        expect(b.x).toBe(300)
        expect(b.y).toBe(180)
    })

    it('resizeBlock works in board mode', () => {
        useAppStore.getState().addBlock(makeBlock('b1', { width: 200, height: 150 }))
        useAppStore.getState().resizeBlock('b1', 400, 240)
        const b = useAppStore.getState().blocks.get('b1')!
        expect(b.width).toBe(400)
        expect(b.height).toBe(240)
    })

    it('deleteBlock removes block in board mode', async () => {
        vi.mocked(api.deleteBlock).mockResolvedValueOnce(undefined as any)
        useAppStore.getState().addBlock(makeBlock('b1'))
        await useAppStore.getState().deleteBlock('b1')
        expect(useAppStore.getState().blocks.has('b1')).toBe(false)
    })

    it('selectBlock works in board mode', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().selectBlock('b1')
        expect(useAppStore.getState().selectedBlockId).toBe('b1')
        expect(useAppStore.getState().selectedIds.has('b1')).toBe(true)
    })

    it('setEditing works in board mode', () => {
        useAppStore.getState().addBlock(makeBlock('b1'))
        useAppStore.getState().setEditing('b1')
        expect(useAppStore.getState().editingBlockId).toBe('b1')
    })

    it('updateBlock merges partial updates (rename content)', () => {
        useAppStore.getState().addBlock(makeBlock('b1', { content: 'old' }))
        useAppStore.getState().updateBlock('b1', { content: 'new content' })
        expect(useAppStore.getState().blocks.get('b1')!.content).toBe('new content')
    })

    it('saveBlockPosition persists to API in board mode', () => {
        useAppStore.getState().addBlock(makeBlock('b1', { x: 100, y: 60, width: 200, height: 120 }))
        useAppStore.getState().saveBlockPosition('b1')
        expect(api.updateBlockPosition).toHaveBeenCalledWith('b1', 100, 60, 200, 120)
    })

    it('multiple blocks can coexist in board mode', () => {
        useAppStore.getState().addBlock(makeBlock('b1', { x: 0, y: 0 }))
        useAppStore.getState().addBlock(makeBlock('b2', { x: 200, y: 60 }))
        useAppStore.getState().addBlock(makeBlock('b3', { x: 400, y: 120 }))
        expect(useAppStore.getState().blocks.size).toBe(3)
    })
})

// ── Snap integration with store values ────────────────────

describe('dashboard snap integration with store', () => {
    beforeEach(() => {
        useAppStore.setState({
            activePageType: 'board',
            canvasContainerWidth: 1200,
        })
    })

    it('snap uses store canvasContainerWidth for column calculation', () => {
        const { canvasContainerWidth } = useAppStore.getState()
        const colW = canvasContainerWidth / DASHBOARD_COLS
        expect(colW).toBe(100)

        // Position at 155px should snap to column 2 (200px)
        const snappedX = dashboardSnapX(155, canvasContainerWidth)
        expect(snappedX).toBe(200)
    })

    it('changing containerWidth changes snap grid', () => {
        useAppStore.getState().setCanvasContainerWidth(960)
        const { canvasContainerWidth } = useAppStore.getState()
        const colW = canvasContainerWidth / DASHBOARD_COLS  // 80

        const snappedX = dashboardSnapX(155, canvasContainerWidth)
        expect(snappedX).toBe(160)  // 2 * 80 = 160
    })

    it('canvas mode uses GRID_SIZE snap regardless of containerWidth', () => {
        useAppStore.setState({ activePageType: 'canvas' })
        // In canvas mode, snap is just GRID_SIZE=30 based
        expect(snapToGrid(155)).toBe(150)  // round(155/30)*30 = 5*30 = 150
    })
})
