import type { Block, Connection } from '../bridge/wails'
import type { AppState } from './types'
import { useUndoTree } from './useUndoTree'

/** Capture current page snapshot for undo */
export function captureSnapshot(get: () => AppState) {
    const s = get()
    return {
        blocks: Array.from(s.blocks.values()),
        drawingData: s.drawingData,
        connections: s.connections,
    }
}

/** Push undo state — persisted to backend via individual record */
export function pushUndo(get: () => AppState, label: string) {
    const pageId = get().activePageId
    if (pageId) useUndoTree.getState().pushState(pageId, label, captureSnapshot(get))
}

/** Restore a snapshot into the store */
export function restoreSnapshot(
    set: (partial: Partial<AppState>) => void,
    snapshot: ReturnType<typeof captureSnapshot>,
) {
    const blocks = new Map<string, Block>()
    snapshot.blocks.forEach(b => blocks.set(b.id, b))
    set({
        blocks,
        drawingData: snapshot.drawingData,
        connections: snapshot.connections,
        selectedBlockId: null,
        editingBlockId: null,
    })
}

/** Smart merge: preserve position/size of blocks the user is actively
 *  interacting with (selected/editing). Other blocks accept incoming state.
 *  New blocks added, deleted blocks removed. */
export function mergeBlocks(
    incoming: Map<string, Block>,
    current: Map<string, Block>,
    activeIds: Set<string | null>,
): Map<string, Block> {
    const merged = new Map<string, Block>()
    for (const [id, newBlock] of incoming) {
        const existing = current.get(id)
        if (existing && activeIds.has(id)) {
            merged.set(id, {
                ...newBlock,
                x: existing.x,
                y: existing.y,
                width: existing.width,
                height: existing.height,
            })
        } else {
            merged.set(id, newBlock)
        }
    }
    return merged
}
