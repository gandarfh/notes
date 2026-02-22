/**
 * Layer 1: Modal — Escape closes the topmost modal (sidebar, palette, dropdown).
 * Only active when a modal is open. Consumes Escape so lower layers don't fire.
 */
import { registerLayer } from '../InputManager'

type ModalState = {
    isOpen: () => boolean
    close: () => void
}

const modals: ModalState[] = []

/**
 * Register a modal. Last registered = highest visual priority.
 * Call this from each modal component's mount (useEffect).
 * Returns an unregister function.
 */
export function registerModal(state: ModalState): () => void {
    modals.push(state)
    return () => {
        const idx = modals.indexOf(state)
        if (idx >= 0) modals.splice(idx, 1)
    }
}

// Register the layer once
registerLayer({
    id: 'modal',
    priority: 1,
    isActive: () => modals.some(m => m.isOpen()),
    onKeyDown: (e) => {
        if (e.key !== 'Escape') return false

        // Close the topmost open modal (iterate from end — last registered is topmost)
        for (let i = modals.length - 1; i >= 0; i--) {
            if (modals[i].isOpen()) {
                modals[i].close()
                return true
            }
        }
        return false
    },
})
