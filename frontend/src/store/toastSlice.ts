import { create } from 'zustand'
import { pluginBus } from '../plugins/sdk/runtime/eventBus'
import type { PluginEventMap } from '../plugins/sdk/events'

// ─────────────────────────────────────────────────────────────
// Toast Slice — manages UI toast notifications
// ─────────────────────────────────────────────────────────────
//
// Toasts are emitted into pluginBus via ctx.ui.toast() from plugins,
// and also received here as a Zustand slice for global state access.
//
// Usage from any component:
//   const { toasts, addToast, removeToast } = useToastStore()

export type ToastType = 'info' | 'success' | 'error' | 'warning'

export interface Toast {
    id: string
    message: string
    type: ToastType
    /** Auto-dismiss after this many ms. Default: 4000 */
    duration?: number
}

interface ToastState {
    toasts: Toast[]
    addToast: (message: string, type?: ToastType, duration?: number) => void
    removeToast: (id: string) => void
}

let toastCounter = 0

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],

    addToast: (message, type = 'info', duration = 4000) => {
        const id = `toast-${Date.now()}-${++toastCounter}`
        const toast: Toast = { id, message, type, duration }
        set((state) => ({ toasts: [...state.toasts, toast] }))
        if (duration > 0) {
            setTimeout(() => {
                set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
            }, duration)
        }
    },

    removeToast: (id) => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },
}))

// ─────────────────────────────────────────────────────────────
// Bridge: pluginBus 'ui:toast' → Zustand store
// ─────────────────────────────────────────────────────────────
// Any plugin calling ctx.ui.toast() will automatically appear
// in the Zustand store AND in the Toast component.

pluginBus.on('ui:toast', ({ message, type }: PluginEventMap['ui:toast']) => {
    useToastStore.getState().addToast(message, type as ToastType)
})

export default useToastStore
