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
