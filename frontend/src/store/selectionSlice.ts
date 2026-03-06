import type { StateCreator } from 'zustand'
import type { AppState, SelectionSlice } from './types'

export const createSelectionSlice: StateCreator<AppState, [], [], SelectionSlice> = (set, get) => ({
    selectedIds: new Set<string>(),

    select: (id) => set({
        selectedIds: new Set([id]),
        // Legacy compat: clear block selection when selecting a drawing entity
        // and set selectedBlockId when selecting a DOM entity
        selectedBlockId: null,
    }),

    selectMultiple: (ids) => {
        console.log(`[selectMultiple] ids=[${ids}]`)
        console.trace('[selectMultiple] call stack')
        set({
            selectedIds: new Set(ids),
            selectedBlockId: null,
        })
    },

    addToSelection: (id) => set(s => {
        const next = new Set(s.selectedIds)
        next.add(id)
        return { selectedIds: next, selectedBlockId: null }
    }),

    removeFromSelection: (id) => set(s => {
        const next = new Set(s.selectedIds)
        next.delete(id)
        return { selectedIds: next }
    }),

    toggleSelection: (id) => set(s => {
        const next = new Set(s.selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        return { selectedIds: next, selectedBlockId: null }
    }),

    clearSelection: () => {
        console.log('[clearSelection] wiping selectedIds')
        console.trace('[clearSelection] call stack')
        set({ selectedIds: new Set() })
    },

    isSelected: (id) => get().selectedIds.has(id),
})
