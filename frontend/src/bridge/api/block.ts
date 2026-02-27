// ─────────────────────────────────────────────────────────────
// Block API
// ─────────────────────────────────────────────────────────────

import type { Block, UndoTree, UndoNode } from '../wails'

function go() { return window.go.app.App }

export const blockAPI = {
    createBlock: (pageID: string, type: string, x: number, y: number, w: number, h: number): Promise<Block> =>
        go().CreateBlock(pageID, type, x, y, w, h),
    updateBlockPosition: (id: string, x: number, y: number, w: number, h: number): Promise<void> =>
        go().UpdateBlockPosition(id, x, y, w, h),
    updateBlockContent: (id: string, content: string): Promise<void> =>
        go().UpdateBlockContent(id, content),
    deleteBlock: (id: string): Promise<void> =>
        go().DeleteBlock(id),
    saveImageFile: (blockID: string, dataURL: string): Promise<string> =>
        go().SaveImageFile(blockID, dataURL),
    getImageData: (blockID: string): Promise<string> =>
        go().GetImageData(blockID),
    openBlockInEditor: (id: string, lineNumber: number): Promise<void> =>
        go().OpenBlockInEditor(id, lineNumber),
    pickTextFile: (): Promise<string> =>
        go().PickTextFile(),
    updateBlockFilePath: (blockID: string, filePath: string): Promise<string> =>
        go().UpdateBlockFilePath(blockID, filePath),
    changeBlockFileExt: (blockID: string, newExt: string): Promise<string> =>
        go().ChangeBlockFileExt(blockID, newExt),
    closeEditor: (): Promise<void> =>
        go().CloseEditor(),

    // Undo tree
    loadUndoTree: (pageID: string): Promise<UndoTree | null> =>
        go().LoadUndoTree(pageID),
    pushUndoNode: (pageID: string, nodeID: string, parentID: string, label: string, snapshotJSON: string): Promise<UndoNode> =>
        go().PushUndoNode(pageID, nodeID, parentID, label, snapshotJSON),
    goToUndoNode: (pageID: string, nodeID: string): Promise<void> =>
        go().GoToUndoNode(pageID, nodeID),
    restorePageBlocks: (pageID: string, blocks: Block[]): Promise<void> =>
        go().RestorePageBlocks(pageID, blocks),
}
