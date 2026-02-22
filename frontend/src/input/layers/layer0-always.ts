/**
 * Layer 0: Always — Global shortcuts that work in any context.
 * Cmd+K (palette), Cmd+Z (undo), Cmd+Shift+Z/Cmd+Y (redo)
 */
import { registerLayer } from '../InputManager'

type Layer0Callbacks = {
    togglePalette: () => void
    undo: () => void
    redo: () => void
}

let callbacks: Layer0Callbacks | null = null

export function initLayer0(cb: Layer0Callbacks) {
    callbacks = cb
    registerLayer({
        id: 'always',
        priority: 0,
        isActive: () => true,
        onKeyDown: (e) => {
            if (!callbacks) return false
            const mod = e.ctrlKey || e.metaKey
            if (!mod) return false

            switch (e.key.toLowerCase()) {
                case 'k':
                    callbacks.togglePalette()
                    return true

                case 'z':
                    // Skip if typing in input (but Cmd+K above always works)
                    if (isTypingInInput(e)) return false
                    if (e.shiftKey) {
                        callbacks.redo()
                    } else {
                        callbacks.undo()
                    }
                    return true

                case 'y':
                    if (isTypingInInput(e)) return false
                    callbacks.redo()
                    return true

                default:
                    return false
            }
        },
    })
}

function isTypingInInput(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}
