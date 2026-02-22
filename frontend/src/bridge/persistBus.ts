/**
 * PersistBus — fire-and-forget event bus for backend persistence.
 *
 * Queues write operations and processes them during browser idle time
 * via requestIdleCallback. Deduplicates by key (latest wins), so rapid
 * viewport saves or block position updates collapse into a single write.
 *
 * The UI thread NEVER awaits these calls.
 */

type PersistFn = () => Promise<void> | void

interface QueueEntry {
    key: string
    fn: PersistFn
}

class PersistBusImpl {
    private queue = new Map<string, PersistFn>()
    private scheduled = false
    private processing = false

    /**
     * Emit a persistence operation. If the same key is already queued,
     * the previous one is replaced (latest wins).
     */
    emit(key: string, fn: PersistFn): void {
        this.queue.set(key, fn)
        this.scheduleFlush()
    }

    /**
     * Immediately process all queued writes. Call before page transitions
     * to ensure all data is persisted before loading new page state.
     */
    async flushNow(): Promise<void> {
        if (this.scheduled) {
            this.scheduled = false
        }
        if (this.queue.size > 0) {
            await this.flush()
        }
    }

    private scheduleFlush(): void {
        if (this.scheduled || this.processing) return
        this.scheduled = true

        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => this.flush(), { timeout: 500 })
        } else {
            setTimeout(() => this.flush(), 0)
        }
    }

    private async flush(): Promise<void> {
        this.scheduled = false
        this.processing = true

        // Snapshot and clear the queue so new events can queue while we process
        const batch = new Map(this.queue)
        this.queue.clear()

        for (const [key, fn] of batch) {
            try {
                await fn()
            } catch (err) {
                console.warn(`[PersistBus] Failed: ${key}`, err)
            }
        }

        this.processing = false

        // If new events arrived while we were processing, schedule again
        if (this.queue.size > 0) {
            this.scheduleFlush()
        }
    }
}

export const persistBus = new PersistBusImpl()
