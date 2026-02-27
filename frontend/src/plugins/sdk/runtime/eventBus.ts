// ═══════════════════════════════════════════════════════════
// Plugin Event Bus — typed inter-plugin communication
// ═══════════════════════════════════════════════════════════

import type { PluginEventMap, WailsEventMap } from '../events'

type AnyHandler = (payload: any) => void

export class PluginEventBus {
    private listeners = new Map<string, Set<AnyHandler>>()

    /**
     * Emit a typed plugin event.
     */
    emit<K extends keyof PluginEventMap>(event: K, payload: PluginEventMap[K]): void
    /** @internal escape hatch for legacy call-sites */
    emit(event: string, payload?: Record<string, unknown>): void
    emit(event: string, payload?: any): void {
        const handlers = this.listeners.get(event)
        if (!handlers) return
        for (const fn of handlers) {
            try {
                fn(payload)
            } catch (err) {
                console.error(`[PluginBus] Error in handler for '${event}':`, err)
            }
        }
    }

    /**
     * Subscribe to a typed plugin event. Returns an unsubscribe function.
     */
    on<K extends keyof PluginEventMap>(event: K, handler: (payload: PluginEventMap[K]) => void): () => void
    /** @internal escape hatch for legacy call-sites */
    on(event: string, handler: AnyHandler): () => void
    on(event: string, handler: AnyHandler): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set())
        }
        this.listeners.get(event)!.add(handler)

        return () => {
            this.listeners.get(event)?.delete(handler)
        }
    }

    /**
     * Subscribe to a typed Wails backend event.
     * Wraps window.runtime.EventsOn and returns unsub.
     *
     * IMPORTANT: Wails `EventsOff(event)` removes ALL handlers for that event globally.
     * We therefore track handlers per event ourselves and only call EventsOff when the
     * last subscriber for that event unsubscribes.
     */
    private backendHandlers = new Map<string, Set<(...args: any[]) => void>>()
    private backendDispatchers = new Map<string, (...args: any[]) => void>()

    onBackend<K extends keyof WailsEventMap>(
        event: K,
        handler: (payload: WailsEventMap[K]) => void,
    ): () => void
    /** @internal escape hatch */
    onBackend(event: string, handler: (...args: any[]) => void): () => void
    onBackend(event: string, handler: (...args: any[]) => void): () => void {
        const runtime = (window as any).runtime
        if (!runtime?.EventsOn) {
            console.warn(`[PluginBus] No Wails runtime — cannot subscribe to backend event '${event}'`)
            return () => { }
        }

        // Ensure we have a handler set for this event
        if (!this.backendHandlers.has(event)) {
            this.backendHandlers.set(event, new Set())
        }
        const handlers = this.backendHandlers.get(event)!
        handlers.add(handler)

        // Register a single Wails EventsOn dispatcher if this is the first subscriber
        if (!this.backendDispatchers.has(event)) {
            const dispatcher = (...args: any[]) => {
                for (const fn of this.backendHandlers.get(event) ?? []) {
                    try { fn(...args) } catch (err) { console.error(`[PluginBus] Backend handler error for '${event}':`, err) }
                }
            }
            this.backendDispatchers.set(event, dispatcher)
            runtime.EventsOn(event, dispatcher)
        }

        // Return an unsubscribe fn that only removes this specific handler
        return () => {
            handlers.delete(handler)
            // Only call EventsOff when the last handler unsubscribes
            if (handlers.size === 0) {
                runtime.EventsOff?.(event)
                this.backendHandlers.delete(event)
                this.backendDispatchers.delete(event)
            }
        }
    }

    /**
     * Remove all listeners. Used for cleanup.
     */
    clear(): void {
        this.listeners.clear()
    }
}

/** Singleton event bus shared across all plugins */
export const pluginBus = new PluginEventBus()
