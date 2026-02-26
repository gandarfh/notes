import type { StateCreator } from 'zustand'
import { api } from '../bridge/wails'
import type { Block } from '../bridge/wails'
import { persistBus } from '../bridge/persistBus'
import type { AppState, CanvasSlice, BlockSlice } from './types'
import { pushUndo } from './helpers'

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
    viewport: { x: 0, y: 0, zoom: 1 },

    setViewport: (x, y, zoom) => set({ viewport: { x, y, zoom } }),

    pan: (dx, dy) => set(s => ({
        viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy }
    })),

    zoomTo: (zoom, cx, cy) => set(s => {
        const v = s.viewport
        if (cx !== undefined && cy !== undefined) {
            const scale = zoom / v.zoom
            return { viewport: { x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale, zoom } }
        }
        return { viewport: { ...v, zoom } }
    }),

    resetZoom: () => set(s => ({ viewport: { ...s.viewport, zoom: 1 } })),

    saveViewport: () => {
        const { activePageId, viewport } = get()
        if (!activePageId) return
        persistBus.emit('viewport', () =>
            api.updateViewport(activePageId, viewport.x, viewport.y, viewport.zoom)
        )
    },
})

export const createBlockSlice: StateCreator<AppState, [], [], BlockSlice> = (set, get) => ({
    blocks: new Map<string, Block>(),
    selectedBlockId: null,
    editingBlockId: null,
    scrollToLine: null,

    setBlocks: (blocks) => {
        const map = new Map<string, Block>()
        blocks.forEach(b => map.set(b.id, b))
        set({ blocks: map })
    },

    addBlock: (block) => set(s => {
        const blocks = new Map(s.blocks)
        blocks.set(block.id, block)
        return { blocks }
    }),

    removeBlock: (id) => set(s => {
        const blocks = new Map(s.blocks)
        blocks.delete(id)
        return {
            blocks,
            selectedBlockId: s.selectedBlockId === id ? null : s.selectedBlockId,
            editingBlockId: s.editingBlockId === id ? null : s.editingBlockId,
        }
    }),

    updateBlock: (id, updates) => set(s => {
        const blocks = new Map(s.blocks)
        const existing = blocks.get(id)
        if (existing) blocks.set(id, { ...existing, ...updates })
        return { blocks }
    }),

    selectBlock: (id) => set({ selectedBlockId: id }),
    setEditing: (id) => set({ editingBlockId: id }),

    moveBlock: (id, x, y) => {
        get().updateBlock(id, { x, y })
    },

    resizeBlock: (id, w, h) => {
        get().updateBlock(id, { width: w, height: h })
    },

    createBlock: async (type, x, y, w, h) => {
        const { activePageId } = get()
        if (!activePageId) return null
        try {
            pushUndo(get, 'Create block')
            const block = await api.createBlock(activePageId, type, x, y, w, h)
            get().addBlock(block)
            return block
        } catch (e) {
            console.error('Failed to create block:', e)
            return null
        }
    },

    deleteBlock: async (id) => {
        try {
            pushUndo(get, 'Delete block')
            await api.deleteBlock(id)
            get().removeBlock(id)
        } catch (e) {
            console.error('Failed to delete block:', e)
        }
    },

    saveBlockPosition: (id) => {
        const block = get().blocks.get(id)
        if (!block) return
        persistBus.emit(`block:${id}:pos`, () =>
            api.updateBlockPosition(id, block.x, block.y, block.width, block.height)
        )
    },

    saveBlockContent: (id, content) => {
        persistBus.emit(`block:${id}:content`, () =>
            api.updateBlockContent(id, content)
        )
    },
})
