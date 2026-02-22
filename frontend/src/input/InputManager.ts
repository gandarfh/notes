/**
 * InputManager — Centralized input event routing with priority-based layers.
 *
 * Each layer has a priority (0 = highest) and an `isActive()` check.
 * When a key event fires, dispatch() walks layers top-to-bottom.
 * The first active layer whose handler returns `true` consumes the event.
 *
 * Layer 0: Always    (Cmd+K, Cmd+Z, Cmd+Shift+Z/Y)
 * Layer 1: Modal     (Escape closes sidebar/palette/dropdown)
 * Layer 2: Editing   (terminal active — absorbs all keys)
 * Layer 3: Drawing   (tool switch 1-8, Delete, Escape, Cmd+ACVD)
 * Layer 4: Block     (hjkl nav, Enter/i edit, d/x delete, o create)
 * Layer 5: Canvas    (fallthrough — paste image, etc.)
 */

export type InputLayer = {
    id: string
    priority: number
    /** Return true if this layer should be consulted. Checked on every event. */
    isActive: () => boolean
    /** Return true if the event was consumed (stop propagation to lower layers). */
    onKeyDown?: (e: KeyboardEvent) => boolean
}

const layers: InputLayer[] = []

export function registerLayer(layer: InputLayer) {
    const existing = layers.findIndex(l => l.id === layer.id)
    if (existing >= 0) {
        layers[existing] = layer
    } else {
        layers.push(layer)
    }
    layers.sort((a, b) => a.priority - b.priority)
}

export function unregisterLayer(id: string) {
    const idx = layers.findIndex(l => l.id === id)
    if (idx >= 0) layers.splice(idx, 1)
}

/**
 * Dispatch a keyboard event through all active layers.
 * Stops at the first layer that consumes the event.
 */
export function dispatch(e: KeyboardEvent) {
    for (const layer of layers) {
        if (!layer.isActive()) continue
        if (layer.onKeyDown?.(e)) {
            e.preventDefault()
            return
        }
    }
}

/**
 * Bind the global keydown listener. Call once in App.tsx.
 * Returns a cleanup function.
 */
export function bindGlobalKeydown(): () => void {
    window.addEventListener('keydown', dispatch)
    return () => window.removeEventListener('keydown', dispatch)
}
