import { create } from 'zustand'
import { api, onEvent } from '../bridge/wails'
import type { Block } from '../bridge/wails'
import type { AppState } from './types'
import { useUndoTree } from './useUndoTree'
import { captureSnapshot } from './helpers'
import { createNotebookSlice } from './notebookSlice'
import { createCanvasSlice, createBlockSlice } from './canvasSlice'
import { createDrawingSlice } from './drawingSlice'
import { createConnectionSlice } from './connectionSlice'
import { pluginBus } from '../plugins/sdk/runtime/eventBus'

export const useAppStore = create<AppState>((...a) => ({
    ...createNotebookSlice(...a),
    ...createCanvasSlice(...a),
    ...createBlockSlice(...a),
    ...createDrawingSlice(...a),
    ...createConnectionSlice(...a),

    // ── Cross-slice actions ────────────────────────────────

    loadPageState: async (pageId) => {
        const [set, get] = [a[0], a[1]]
        set({
            blocks: new Map(),
            connections: [],
            drawingData: '',
            selectedBlockId: null,
            editingBlockId: null,
        })

        try {
            const ps = await api.getPageState(pageId)
            const blocks = new Map<string, Block>()
                ; (ps.blocks || []).forEach(b => blocks.set(b.id, b))

            set({
                viewport: { x: ps.page.viewportX, y: ps.page.viewportY, zoom: ps.page.viewportZoom || 1 },
                blocks,
                connections: ps.connections || [],
                drawingData: ps.page.drawingData || '',
            })

            await useUndoTree.getState().loadTree(pageId)
            if (useUndoTree.getState().nodes.size === 0) {
                await useUndoTree.getState().pushState(pageId, 'Page loaded', captureSnapshot(get))
            }
        } catch (e) {
            console.error('Failed to load page:', e)
        }
    },

    initEventListeners: () => {
        const [, get] = [a[0], a[1]]
        const unsubs: (() => void)[] = []

        // Neovim updated block content
        unsubs.push(onEvent('block:content-updated', (data: { blockId: string; content: string }) => {
            get().updateBlock(data.blockId, { content: data.content })
        }))

        // ETL sync completed — relay to plugins so LocalDB/Chart blocks refresh
        unsubs.push(onEvent('db:updated', (data: { databaseId: string; jobId: string }) => {
            pluginBus.emit('localdb:data-changed', { databaseId: data.databaseId })
        }))

        return () => unsubs.forEach(fn => fn())
    },
}))

// Restore global font based on persisted boardStyle on app startup
try {
    const boardStyle = localStorage.getItem('boardStyle')
    if (boardStyle === 'sketchy') {
        document.documentElement.style.setProperty('--font-sans', "'Caveat', cursive")
        document.documentElement.style.fontSize = '17px'
    }
} catch { /* ignore localStorage errors in SSR/tests */ }
