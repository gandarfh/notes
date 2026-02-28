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
import useToastStore from './toastSlice'

// Reload page state from DB and push an undo snapshot (for MCP changes)
async function reloadWithUndo(get: () => AppState, pageId: string, label: string) {
    try {
        const ps = await api.getPageState(pageId)
        const blocks = new Map<string, Block>()
            ; (ps.blocks || []).forEach(b => blocks.set(b.id, b))

        const store = get() as any
        const set = useAppStore.setState
        set({
            blocks,
            connections: ps.connections || [],
            drawingData: ps.page.drawingData || '',
        })

        // Push undo snapshot so MCP changes can be undone
        await useUndoTree.getState().pushState(pageId, label, captureSnapshot(get))

        // Show toast notification
        useToastStore.getState().addToast(`🤖 ${label}`, 'info', 3000)
    } catch (e) {
        console.error('reloadWithUndo failed:', e)
    }
}

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

        // MCP: blocks changed — reload page state and push undo snapshot
        unsubs.push(onEvent('mcp:blocks-changed', (data: { pageId: string }) => {
            const activePageId = get().activePageId
            if (activePageId && data.pageId === activePageId) {
                reloadWithUndo(get, activePageId, 'MCP: blocks changed')
            }
        }))

        // MCP: drawing changed — reload drawing data and push undo snapshot
        unsubs.push(onEvent('mcp:drawing-changed', (data: { pageId: string }) => {
            const activePageId = get().activePageId
            if (activePageId && data.pageId === activePageId) {
                reloadWithUndo(get, activePageId, 'MCP: drawing changed')
            }
        }))

        // MCP: pages changed — refresh sidebar page list
        unsubs.push(onEvent('mcp:pages-changed', (data: { notebookId: string }) => {
            const activeNotebookId = get().activeNotebookId
            if (activeNotebookId && data.notebookId === activeNotebookId) {
                get().loadPages(activeNotebookId)
            }
        }))

        // MCP: navigate to page — auto-switch active page
        unsubs.push(onEvent('mcp:navigate-page', (data: { pageId: string }) => {
            if (data.pageId && data.pageId !== get().activePageId) {
                get().selectPage(data.pageId)
            }
        }))

        // MCP: activity pulse — emit to plugin bus for indicator + toast
        unsubs.push(onEvent('mcp:activity', (data: { changes: number; pageId: string }) => {
            pluginBus.emit('mcp:activity', data)
        }))

        // MCP: approval required — relay to plugin bus for ApprovalModal
        unsubs.push(onEvent('mcp:approval-required', (data: any) => {
            pluginBus.emit('mcp:approval-required', data)
        }))

        // MCP: approval dismissed (timeout)
        unsubs.push(onEvent('mcp:approval-dismissed', (data: any) => {
            pluginBus.emit('mcp:approval-dismissed', data)
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
