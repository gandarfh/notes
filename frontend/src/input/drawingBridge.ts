/**
 * Global drawing selection bridge.
 * Allows BlockContainer to clear drawing selection without prop drilling.
 * Set by Canvas/useDrawing, called by BlockContainer.
 */
let _clearDrawingSelection: (() => void) | null = null

export function setClearDrawingSelection(fn: (() => void) | null) {
    _clearDrawingSelection = fn
}

export function clearDrawingSelectionGlobal() {
    _clearDrawingSelection?.()
}

/**
 * Global editor close bridge.
 * Allows Canvas to close the terminal when clicking outside during editing.
 * Set by App.tsx, called by Canvas.
 */
let _closeEditor: (() => void) | null = null

export function setCloseEditor(fn: (() => void) | null) {
    _closeEditor = fn
}

export function closeEditorGlobal() {
    _closeEditor?.()
}

/**
 * Global bridge for notifying drawing arrows when a block moves.
 * Set by useDrawing, called by BlockContainer during and after drag.
 * Accepts optional live position (x,y) for real-time updates during drag
 * when the store hasn't been updated yet (DOM-only drag optimization).
 */
let _onBlockMoved: ((blockId: string, liveX?: number, liveY?: number) => void) | null = null

export function setOnBlockMoved(fn: ((blockId: string, liveX?: number, liveY?: number) => void) | null) {
    _onBlockMoved = fn
}

export function notifyBlockMoved(blockId: string, liveX?: number, liveY?: number) {
    _onBlockMoved?.(blockId, liveX, liveY)
}
