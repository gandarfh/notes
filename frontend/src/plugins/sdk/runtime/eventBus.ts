// ═══════════════════════════════════════════════════════════
// Plugin Event Bus — typed inter-plugin communication
// ═══════════════════════════════════════════════════════════

type Handler = (payload: any) => void

export class PluginEventBus {
    private listeners = new Map<string, Set<Handler>>()

    /**
     * Emit an event to all subscribers.
     */
    emit(event: string, payload?: Record<string, unknown>): void {
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
     * Subscribe to an event. Returns an unsubscribe function.
     */
    on(event: string, handler: Handler): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set())
        }
        this.listeners.get(event)!.add(handler)

        return () => {
            this.listeners.get(event)?.delete(handler)
        }
    }

    /**
     * Subscribe to a Wails backend event.
     * Wraps window.runtime.EventsOn and returns unsub.
     */
    onBackend(event: string, handler: (...args: any[]) => void): () => void {
        const runtime = (window as any).runtime
        if (!runtime?.EventsOn) {
            console.warn(`[PluginBus] No Wails runtime — cannot subscribe to backend event '${event}'`)
            return () => { }
        }

        runtime.EventsOn(event, handler)
        return () => {
            runtime.EventsOff?.(event)
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
