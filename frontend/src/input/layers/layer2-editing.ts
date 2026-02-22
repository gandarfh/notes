/**
 * Layer 2: Editing — intentionally empty.
 *
 * When a block is being edited (terminal/Neovim), the terminal captures
 * keyboard input directly. We must NOT absorb events here because
 * dispatch() calls e.preventDefault() on consumed events, which would
 * block the terminal from receiving keys like Shift+A, arrows, etc.
 *
 * Lower layers (Drawing, Block) already check editingBlockId and
 * return false during editing, so no barrier is needed.
 */
export { }
