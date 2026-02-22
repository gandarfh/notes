import { create } from 'zustand'
import { api } from '../bridge/wails'
import type { Block, Connection, UndoNode as ApiUndoNode } from '../bridge/wails'

// ── Types ──────────────────────────────────────────────────

export interface PageSnapshot {
    blocks: Block[]
    drawingData: string
    connections: Connection[]
}

export interface UndoNode {
    id: string
    parentId: string | null
    children: string[]
    label: string
    timestamp: number
    snapshot: PageSnapshot
}

interface UndoTreeState {
    nodes: Map<string, UndoNode>
    currentId: string | null
    rootId: string | null

    /** Load tree from backend for a page */
    loadTree: (pageId: string) => Promise<void>
    /** Push a new undo state (persisted to backend) */
    pushState: (pageId: string, label: string, snapshot: PageSnapshot) => Promise<void>
    /** Navigate to a specific node */
    goTo: (pageId: string, nodeId: string) => PageSnapshot | null
    /** Undo — move to parent node */
    undo: (pageId: string) => PageSnapshot | null
    /** Redo — move to last child */
    redo: (pageId: string) => PageSnapshot | null
    /** Clear local state */
    clear: () => void
}

// ── Helpers ────────────────────────────────────────────────

function parseSnapshot(json: string): PageSnapshot {
    try {
        return JSON.parse(json)
    } catch {
        return { blocks: [], drawingData: '', connections: [] }
    }
}

function buildChildrenMap(apiNodes: ApiUndoNode[]): Map<string, UndoNode> {
    const nodes = new Map<string, UndoNode>()

    // First pass: create all nodes without children
    for (const n of apiNodes) {
        nodes.set(n.id, {
            id: n.id,
            parentId: n.parentId,
            children: [],
            label: n.label,
            timestamp: new Date(n.createdAt).getTime(),
            snapshot: parseSnapshot(n.snapshotJson),
        })
    }

    // Second pass: populate children arrays
    for (const node of nodes.values()) {
        if (node.parentId && nodes.has(node.parentId)) {
            nodes.get(node.parentId)!.children.push(node.id)
        }
    }

    return nodes
}

// Strip image content to keep snapshot JSON small when sending to backend
function stripImageContent(snapshot: PageSnapshot): PageSnapshot {
    return {
        ...snapshot,
        blocks: snapshot.blocks.map(b =>
            b.type === 'image' ? { ...b, content: '' } : b
        ),
    }
}

// ── Store ──────────────────────────────────────────────────

export const useUndoTree = create<UndoTreeState>((set, get) => ({
    nodes: new Map(),
    currentId: null,
    rootId: null,

    loadTree: async (pageId) => {
        try {
            const tree = await api.loadUndoTree(pageId)
            if (!tree || !tree.nodes || tree.nodes.length === 0) {
                set({ nodes: new Map(), currentId: null, rootId: null })
                return
            }
            const nodes = buildChildrenMap(tree.nodes)
            set({ nodes, currentId: tree.currentId, rootId: tree.rootId })
        } catch {
            set({ nodes: new Map(), currentId: null, rootId: null })
        }
    },

    pushState: async (pageId, label, snapshot) => {
        // ── Synchronous: update local tree IMMEDIATELY ──
        const state = get()
        const parentId = state.currentId
        const tempId = crypto.randomUUID()

        const nodes = new Map(state.nodes)
        const newNode: UndoNode = {
            id: tempId,
            parentId,
            children: [],
            label,
            timestamp: Date.now(),
            snapshot,
        }
        nodes.set(tempId, newNode)

        // Append to parent's children (preserve existing branches)
        if (parentId && nodes.has(parentId)) {
            const parent = { ...nodes.get(parentId)! }
            parent.children = [...parent.children, tempId]
            nodes.set(parentId, parent)
        }

        // Set currentId NOW — before any await
        set({ nodes, currentId: tempId, rootId: state.rootId ?? tempId })

        // ── Async: persist to backend (fire-and-forget) ──
        try {
            const forBackend = stripImageContent(snapshot)
            const snapshotJSON = JSON.stringify(forBackend)
            await api.pushUndoNode(pageId, tempId, parentId ?? '', label, snapshotJSON)
        } catch (e) {
            console.error('Failed to persist undo node:', e)
        }
    },

    goTo: (pageId, nodeId) => {
        const state = get()
        const node = state.nodes.get(nodeId)
        if (!node) return null
        set({ currentId: nodeId })
        // Fire-and-forget: persist position to backend
        api.goToUndoNode(pageId, nodeId).catch(() => { })
        return node.snapshot
    },

    undo: (pageId) => {
        const state = get()
        if (!state.currentId) return null
        const current = state.nodes.get(state.currentId)
        if (!current?.parentId) return null
        const parent = state.nodes.get(current.parentId)
        if (!parent) return null
        set({ currentId: parent.id })
        api.goToUndoNode(pageId, parent.id).catch(() => { })
        return parent.snapshot
    },

    redo: (pageId) => {
        const state = get()
        if (!state.currentId) return null
        const current = state.nodes.get(state.currentId)
        if (!current || current.children.length === 0) return null
        const lastChildId = current.children[current.children.length - 1]
        const child = state.nodes.get(lastChildId)
        if (!child) return null
        set({ currentId: lastChildId })
        api.goToUndoNode(pageId, lastChildId).catch(() => { })
        return child.snapshot
    },

    clear: () => {
        set({ nodes: new Map(), currentId: null, rootId: null })
    },
}))
