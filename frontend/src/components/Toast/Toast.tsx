import './toast.css'
import { useEffect, useState, useCallback } from 'react'
import { pluginBus } from '../../plugins/sdk/runtime/eventBus'

// ── Types ──────────────────────────────────────────────────

export interface ToastItem {
    id: string
    message: string
    type: 'info' | 'success' | 'error' | 'warning'
}

// ── Toast Component ────────────────────────────────────────

const ICONS: Record<ToastItem['type'], string> = {
    info: 'ℹ',
    success: '✓',
    error: '✕',
    warning: '⚠',
}

const DURATION_MS = 4000

export function ToastContainer() {
    const [toasts, setToasts] = useState<ToastItem[]>([])

    const dismiss = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const addToast = useCallback((message: string, type: ToastItem['type']) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
        setToasts(prev => [...prev, { id, message, type }])
        setTimeout(() => dismiss(id), DURATION_MS)
    }, [dismiss])

    // Subscribe to the plugin bus toast events
    useEffect(() => {
        const unsub = pluginBus.on('ui:toast', ({ message, type }) => {
            addToast(message, type)
        })
        return unsub
    }, [addToast])

    if (toasts.length === 0) return null

    return (
        <div
            aria-live="polite"
            className="toast-container"
        >
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={`toast toast--${toast.type}`}
                    role="alert"
                    onClick={() => dismiss(toast.id)}
                >
                    <span className="toast__icon">{ICONS[toast.type]}</span>
                    <span className="toast__message">{toast.message}</span>
                    <button
                        className="toast__close"
                        aria-label="Dismiss"
                        onClick={(e) => { e.stopPropagation(); dismiss(toast.id) }}
                    >×</button>
                </div>
            ))}
        </div>
    )
}
