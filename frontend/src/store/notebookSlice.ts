import type { StateCreator } from 'zustand'
import { api } from '../bridge/wails'
import { persistBus } from '../bridge/persistBus'
import type { AppState, NotebookSlice } from './types'

export const createNotebookSlice: StateCreator<AppState, [], [], NotebookSlice> = (set, get) => ({
    notebooks: [],
    pages: [],
    activeNotebookId: null,
    activePageId: null,
    initializing: !!localStorage.getItem('notes:lastPageId'),
    expandedNotebooks: new Set<string>(),

    loadNotebooks: async () => {
        const notebooks = await api.listNotebooks()
        set({ notebooks: notebooks || [] })

        const lastPageId = localStorage.getItem('notes:lastPageId')
        if (lastPageId && notebooks?.length) {
            for (const nb of notebooks) {
                const pages = await api.listPages(nb.id)
                const found = pages?.find((p: any) => p.id === lastPageId)
                if (found) {
                    set({ pages, activeNotebookId: nb.id, expandedNotebooks: new Set([nb.id]) })
                    await get().selectPage(lastPageId)
                    return
                }
            }
        }
        set({ initializing: false })
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
            get().saveViewport()
            await persistBus.flushNow()
        }
        set({ activePageId: id })
        localStorage.setItem('notes:lastPageId', id)
        await get().loadPageState(id)
    },
})
