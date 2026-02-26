import type { StateCreator } from 'zustand'
import { api } from '../bridge/wails'
import type { Connection } from '../bridge/wails'
import { persistBus } from '../bridge/persistBus'
import type { AppState, ConnectionSlice } from './types'

export const createConnectionSlice: StateCreator<AppState, [], [], ConnectionSlice> = (set, get) => ({
    connections: [],

    setConnections: (connections) => set({ connections }),

    addConnection: (conn) => set(s => ({ connections: [...s.connections, conn] })),

    removeConnection: (id) => set(s => ({
        connections: s.connections.filter(c => c.id !== id),
    })),

    updateConnection: (id, label, color, style) => {
        set(s => ({
            connections: s.connections.map(c =>
                c.id === id ? { ...c, label, color, style: style as Connection['style'] } : c
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
})
