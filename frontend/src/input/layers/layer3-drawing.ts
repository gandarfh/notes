/**
 * Layer 3: Drawing — Tool switching, drawing element actions.
 *
 * This layer delegates to the existing drawing system's onKeyDown handler.
 * useDrawing registers/unregisters a handler function at mount/unmount.
 */
import { registerLayer } from '../InputManager'
import { useAppStore } from '../../store'

type DrawingKeyHandler = (e: KeyboardEvent) => boolean

let drawingHandler: DrawingKeyHandler | null = null

/**
 * Called by useDrawing to register its keyboard handler.
 * Returns unregister function.
 */
export function setDrawingKeyHandler(handler: DrawingKeyHandler): () => void {
    drawingHandler = handler
    return () => { drawingHandler = null }
}

registerLayer({
    id: 'drawing',
    priority: 3,
    isActive: () => {
        // Active when there's no editing and the target is not an input
        return !useAppStore.getState().editingBlockId
    },
    onKeyDown: (e) => {
        // Skip if typing in a text input
        const target = e.target as HTMLElement
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false
        if (target.isContentEditable) return false

        // Delegate to the drawing system's handler
        if (drawingHandler) {
            return drawingHandler(e)
        }
        return false
    },
})
