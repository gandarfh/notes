import { create } from 'zustand'
import { api, onEvent } from '../bridge/wails'
import type { Block, Connection, Notebook, Page } from '../bridge/wails'
import type { AppState, DrawingSubTool } from './types'
import { useUndoTree } from './useUndoTree'
import { persistBus } from '../bridge/persistBus'

// Helper: capture current page snapshot for undo
function captureSnapshot(get: () => AppState) {
    const s = get()
    return {
        blocks: Array.from(s.blocks.values()),
        drawingData: s.drawingData,
        connections: s.connections,
    }
}

// Helper: push undo state — persisted to backend via individual record
function pushUndo(get: () => AppState, label: string) {
    const pageId = get().activePageId
    if (pageId) useUndoTree.getState().pushState(pageId, label, captureSnapshot(get))
}

// Helper: restore a snapshot into the store
function restoreSnapshot(set: (partial: Partial<AppState>) => void, snapshot: ReturnType<typeof captureSnapshot>) {
    const blocks = new Map<string, Block>()
    snapshot.blocks.forEach(b => blocks.set(b.id, b))
    set({
        blocks,
        drawingData: snapshot.drawingData,
        connections: snapshot.connections,
        selectedBlockId: null,
        editingBlockId: null,
        scrollToLine: null,
    })
}

export const useAppStore = create<AppState>((set, get) => ({
    // ── Notebook Slice ─────────────────────────────────────
    notebooks: [],
    pages: [],
    activeNotebookId: null,
    activePageId: null,
    expandedNotebooks: new Set<string>(),

    loadNotebooks: async () => {
        const notebooks = await api.listNotebooks()
        set({ notebooks: notebooks || [] })
    },

    createNotebook: async (name) => {
        const nb = await api.createNotebook(name)
        set(s => ({ notebooks: [...s.notebooks, nb] }))
    },

    renameNotebook: async (id, name) => {
        await api.renameNotebook(id, name)
        set(s => ({ notebooks: s.notebooks.map(n => n.id === id ? { ...n, name } : n) }))
    },

    deleteNotebook: async (id) => {
        await api.deleteNotebook(id)
        set(s => ({
            notebooks: s.notebooks.filter(n => n.id !== id),
            activeNotebookId: s.activeNotebookId === id ? null : s.activeNotebookId,
        }))
    },

    selectNotebook: async (id) => {
        set(s => {
            const expanded = new Set(s.expandedNotebooks)
            expanded.add(id)
            return { activeNotebookId: id, expandedNotebooks: expanded }
        })
        await get().loadPages(id)
        // Auto-select first page
        const { pages } = get()
        if (pages.length > 0) {
            await get().selectPage(pages[0].id)
        }
    },

    toggleNotebook: (id) => {
        set(s => {
            const expanded = new Set(s.expandedNotebooks)
            if (expanded.has(id)) expanded.delete(id)
            else expanded.add(id)
            return { expandedNotebooks: expanded }
        })
    },

    loadPages: async (notebookId) => {
        const pages = await api.listPages(notebookId)
        set({ pages: pages || [] })
    },

    createPage: async (notebookId, name) => {
        const page = await api.createPage(notebookId, name)
        set(s => ({ pages: [...s.pages, page] }))
    },

    renamePage: async (id, name) => {
        await api.renamePage(id, name)
        set(s => ({ pages: s.pages.map(p => p.id === id ? { ...p, name } : p) }))
    },

    deletePage: async (id) => {
        await api.deletePage(id)
        set(s => {
            const isActive = s.activePageId === id
            return {
                pages: s.pages.filter(p => p.id !== id),
                activePageId: isActive ? null : s.activePageId,
                ...(isActive ? {
                    blocks: new Map(),
                    connections: [],
                    drawingData: '',
                    selectedBlockId: null,
                    editingBlockId: null,
                } : {}),
            }
        })
    },

    selectPage: async (id) => {
        const oldPageId = get().activePageId
        if (oldPageId && oldPageId !== id) {
            // Ensure current viewport is persisted before switching
            get().saveViewport()
            await persistBus.flushNow()
        }
        set({ activePageId: id })
        await get().loadPageState(id)
    },

    // ── Canvas Slice ───────────────────────────────────────
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

    // ── Block Slice ────────────────────────────────────────
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

    // ── Drawing Slice ──────────────────────────────────────
    drawingData: '',
    drawingSubTool: 'draw-select' as DrawingSubTool,
    boardStyle: (localStorage.getItem('boardStyle') as 'clean' | 'sketchy') || 'clean',
    styleDefaults: (() => {
        const base = {
            strokeColor: '#e0e0e0', strokeWidth: 2, backgroundColor: 'transparent',
            fontSize: 14, fontFamily: 'Inter', fontWeight: 400, textColor: '#e0e0e0',
            borderRadius: 0, opacity: 1, fillStyle: 'hachure',
            strokeDasharray: '', textAlign: 'center', verticalAlign: 'center',
        }
        return {
            rectangle: { ...base },
            ellipse: { ...base },
            diamond: { ...base },
            arrow: { ...base },
            freedraw: { ...base },
            text: { ...base, fontSize: 16 },
        }
    })(),

    setDrawingData: (data) => set({ drawingData: data }),
    setDrawingSubTool: (tool) => set({ drawingSubTool: tool }),
    setBoardStyle: (style) => {
        localStorage.setItem('boardStyle', style)
        const fontCss = style === 'sketchy'
            ? "'Caveat', cursive"
            : "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
        document.documentElement.style.setProperty('--font-sans', fontCss)
        document.documentElement.style.fontSize = style === 'sketchy' ? '17px' : '13px'
        set({ boardStyle: style })
    },
    setStyleDefaults: (type, patch) => set(s => ({
        styleDefaults: { ...s.styleDefaults, [type]: { ...s.styleDefaults[type], ...patch } }
    })),
    getStyleDefaults: (type) => get().styleDefaults[type],

    saveDrawingData: () => {
        const { activePageId, drawingData } = get()
        if (!activePageId) return
        pushUndo(get, 'Drawing change')
        persistBus.emit('drawing', () =>
            api.updateDrawingData(activePageId, drawingData)
        )
    },

    // ── Connection Slice ───────────────────────────────────
    connections: [],

    setConnections: (connections) => set({ connections }),

    addConnection: (conn) => set(s => ({ connections: [...s.connections, conn] })),

    removeConnection: (id) => set(s => ({
        connections: s.connections.filter(c => c.id !== id),
    })),

    updateConnection: (id, label, color, style) => {
        set(s => ({
            connections: s.connections.map(c =>
                c.id === id ? { ...c, label, color, style: style as any } : c
            ),
        }))
        persistBus.emit(`conn:${id}`, () =>
            api.updateConnection(id, label, color, style)
        )
    },

    createConnection: async (fromId, toId) => {
        const { activePageId } = get()
        if (!activePageId) return
        try {
            const conn = await api.createConnection(activePageId, fromId, toId)
            get().addConnection(conn)
        } catch (e) {
            console.error('Failed to create connection:', e)
        }
    },

    deleteConnection: async (id) => {
        try {
            await api.deleteConnection(id)
            get().removeConnection(id)
        } catch (e) {
            console.error('Failed to delete connection:', e)
        }
    },

    // ── Cross-slice actions ────────────────────────────────

    loadPageState: async (pageId) => {
        // Clear current state
        set({
            blocks: new Map(),
            connections: [],
            drawingData: '',
            selectedBlockId: null,
            editingBlockId: null,
        })

        try {
            const ps = await api.getPageState(pageId)
            console.log('[loadPageState] blocks from API:', ps.blocks?.length, 'connections:', ps.connections?.length)
            const blocks = new Map<string, Block>()
                ; (ps.blocks || []).forEach(b => blocks.set(b.id, b))

            set({
                viewport: { x: ps.page.viewportX, y: ps.page.viewportY, zoom: ps.page.viewportZoom || 1 },
                blocks,
                connections: ps.connections || [],
                drawingData: ps.page.drawingData || '',
            })

            // Load undo tree from backend
            await useUndoTree.getState().loadTree(pageId)
            // Create baseline if tree is empty (first visit to this page)
            if (useUndoTree.getState().nodes.size === 0) {
                await useUndoTree.getState().pushState(pageId, 'Page loaded', captureSnapshot(get))
            }
        } catch (e) {
            console.error('Failed to load page:', e)
        }
    },

    initEventListeners: () => {
        const unsubs: (() => void)[] = []

        unsubs.push(onEvent('block:content-updated', (data: { blockId: string; content: string }) => {
            get().updateBlock(data.blockId, { content: data.content })
        }))

        return () => unsubs.forEach(fn => fn())
    },
}))

    // Restore global font based on persisted boardStyle on app startup
    ; (() => {
        try {
            const boardStyle = localStorage.getItem('boardStyle')
            if (boardStyle === 'sketchy') {
                document.documentElement.style.setProperty('--font-sans', "'Caveat', cursive")
                document.documentElement.style.fontSize = '20px'
            }
        } catch { }
    })()
