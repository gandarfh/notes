import type { StateCreator } from 'zustand'
import { canvasEntityAPI } from '../bridge/api/canvasEntity'
import type { CanvasEntity, CanvasEntityPatch, CanvasEntityPatchWithID, CanvasConnection } from '../bridge/wails'
import { persistBus } from '../bridge/persistBus'
import type { AppState, EntitySlice } from './types'

export const createEntitySlice: StateCreator<AppState, [], [], EntitySlice> = (set, get) => ({
    entities: new Map<string, CanvasEntity>(),
    canvasConnections: [],

    setEntities: (list) => {
        const map = new Map<string, CanvasEntity>()
        list.forEach(e => map.set(e.id, e))
        set({ entities: map })
    },

    addEntity: (e) => set(s => {
        const entities = new Map(s.entities)
        entities.set(e.id, e)
        return { entities }
    }),

    removeEntity: (id) => set(s => {
        const entities = new Map(s.entities)
        entities.delete(id)
        return {
            entities,
            canvasConnections: s.canvasConnections.filter(
                c => c.fromEntityId !== id && c.toEntityId !== id
            ),
        }
    }),

    updateEntity: (id, patch) => set(s => {
        const entities = new Map(s.entities)
        const existing = entities.get(id)
        if (existing) entities.set(id, { ...existing, ...patch })
        return { entities }
    }),

    setCanvasConnections: (conns) => set({ canvasConnections: conns }),

    addCanvasConnection: (conn) => set(s => ({
        canvasConnections: [...s.canvasConnections, conn],
    })),

    removeCanvasConnection: (id) => set(s => ({
        canvasConnections: s.canvasConnections.filter(c => c.id !== id),
    })),

    // ── RPC actions ─────────────────────────────────────────

    createEntity: async (type, x, y, w, h) => {
        const { activePageId } = get()
        if (!activePageId) return null
        try {
            const e = await canvasEntityAPI.createEntity(activePageId, type, x, y, w, h)
            get().addEntity(e)
            return e
        } catch (err) {
            console.error('Failed to create entity:', err)
            return null
        }
    },

    deleteEntity: async (id) => {
        try {
            await canvasEntityAPI.deleteEntity(id)
            get().removeEntity(id)
        } catch (err) {
            console.error('Failed to delete entity:', err)
        }
    },

    saveEntityPatch: (id, patch) => {
        persistBus.emit(`entity:${id}`, () =>
            canvasEntityAPI.updateEntity(id, patch)
        )
    },

    batchUpdateEntities: async (patches) => {
        try {
            await canvasEntityAPI.batchUpdate(patches)
            // Apply patches locally
            set(s => {
                const entities = new Map(s.entities)
                for (const { id, patch } of patches) {
                    const existing = entities.get(id)
                    if (existing) entities.set(id, { ...existing, ...patch })
                }
                return { entities }
            })
        } catch (err) {
            console.error('Failed to batch update entities:', err)
        }
    },

    updateEntityZOrder: async (orderedIDs) => {
        const { activePageId } = get()
        if (!activePageId) return
        try {
            await canvasEntityAPI.updateZOrder(activePageId, orderedIDs)
            // Update z-indices locally
            set(s => {
                const entities = new Map(s.entities)
                orderedIDs.forEach((id, i) => {
                    const e = entities.get(id)
                    if (e) entities.set(id, { ...e, zIndex: i })
                })
                return { entities }
            })
        } catch (err) {
            console.error('Failed to update z-order:', err)
        }
    },

    createCanvasConnection: async (fromId, toId) => {
        const { activePageId } = get()
        if (!activePageId) return
        try {
            const conn = await canvasEntityAPI.createConnection(activePageId, fromId, toId)
            get().addCanvasConnection(conn)
        } catch (err) {
            console.error('Failed to create canvas connection:', err)
        }
    },

    deleteCanvasConnection: async (id) => {
        try {
            await canvasEntityAPI.deleteConnection(id)
            get().removeCanvasConnection(id)
        } catch (err) {
            console.error('Failed to delete canvas connection:', err)
        }
    },

    // ── Computed helpers ─────────────────────────────────────

    getDomEntities: () => {
        const result: CanvasEntity[] = []
        for (const e of get().entities.values()) {
            if (e.renderMode === 'dom') result.push(e)
        }
        return result.sort((a, b) => a.zIndex - b.zIndex)
    },

    getCanvasEntities: () => {
        const result: CanvasEntity[] = []
        for (const e of get().entities.values()) {
            if (e.renderMode === 'canvas') result.push(e)
        }
        return result.sort((a, b) => a.zIndex - b.zIndex)
    },
})
