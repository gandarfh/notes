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
