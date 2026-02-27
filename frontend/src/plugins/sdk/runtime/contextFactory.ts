// ═══════════════════════════════════════════════════════════
// Context Factory — creates PluginContext instances
// ═══════════════════════════════════════════════════════════
//
// This is the ONLY file in the SDK that imports from core internals.
// It bridges the gap between the plugin contract and the actual
// Zustand store / Wails bindings.

import type { PluginContext, BlockData } from '../types'
import { pluginBus } from './eventBus'
import { rpcCall } from './rpcProxy'

// Lazy imports to avoid circular deps — resolved at call time
function getAppStore() {
    return (window as any).__pluginSDK_appStore as {
        getState: () => any
        setState: (partial: any) => void
    }
}

function getRegistry() {
    return (window as any).__pluginSDK_registry as {
        get: (type: string) => any
        has: (type: string) => boolean
    }
}

// ── Font-size persistence ──────────────────────────────────

const FONT_SIZE_KEY = 'md-font-size:'
const DEFAULT_FONT_SIZE = 15
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 48

export function sdkGetFontSize(blockId: string): number {
    try {
        const v = localStorage.getItem(FONT_SIZE_KEY + blockId)
        if (v) return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, parseInt(v, 10)))
    } catch { }
    return DEFAULT_FONT_SIZE
}

export function sdkSetFontSize(blockId: string, size: number): void {
    const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size))
    try {
        localStorage.setItem(FONT_SIZE_KEY + blockId, String(clamped))
    } catch { }
    // Notify all renderers for this block via plugin bus
    pluginBus.emit('block:fontsize-changed', { blockId, size: clamped })
}

export { MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_FONT_SIZE }

// ── Debounce helper ────────────────────────────────────────

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function debouncedSave(blockId: string, content: string) {
    const existing = debounceTimers.get(blockId)
    if (existing) clearTimeout(existing)

    debounceTimers.set(blockId, setTimeout(() => {
        debounceTimers.delete(blockId)
        const store = getAppStore()
        store.getState().updateBlock(blockId, { content })
        store.getState().saveBlockContent(blockId, content)
    }, 500))
}

// ── Factory ────────────────────────────────────────────────

/**
 * Create a PluginContext for a specific block.
 * Called by BlockContainer when rendering a plugin.
 */
export function createPluginContext(block: BlockData): PluginContext {
    const blockId = block.id

    return {
        // ── Storage ────────────────────────────────────
        storage: {
            getContent() {
                const store = getAppStore()
                return store.getState().blocks.get(blockId)?.content || ''
            },

            setContent(content: string) {
                const store = getAppStore()
                store.getState().updateBlock(blockId, { content })
                store.getState().saveBlockContent(blockId, content)
                pluginBus.emit('block:content-changed', { blockId, type: block.type })
            },

            setContentDebounced(content: string) {
                debouncedSave(blockId, content)
            },
        },

        // ── RPC ────────────────────────────────────────
        rpc: {
            call: rpcCall,
        },

        // ── Events ─────────────────────────────────────
        events: {
            emit: pluginBus.emit.bind(pluginBus),
            on: pluginBus.on.bind(pluginBus),
            onBackend: pluginBus.onBackend.bind(pluginBus),
        },

        // ── Block info ─────────────────────────────────────────
        // Reads live from store so ctx.block.* is always up-to-date
        // even when ctx is memoized on block.id
        block: {
            get id() { return blockId },
            get pageId() { return getAppStore().getState().blocks.get(blockId)?.pageId || block.pageId },
            get type() { return getAppStore().getState().blocks.get(blockId)?.type || block.type },
            get x() { return getAppStore().getState().blocks.get(blockId)?.x ?? block.x },
            get y() { return getAppStore().getState().blocks.get(blockId)?.y ?? block.y },
            get width() { return getAppStore().getState().blocks.get(blockId)?.width ?? block.width },
            get height() { return getAppStore().getState().blocks.get(blockId)?.height ?? block.height },
            get filePath() { return getAppStore().getState().blocks.get(blockId)?.filePath || block.filePath },
        },

        // ── Inter-plugin ───────────────────────────────
        plugins: {
            getAPI<T = Record<string, Function>>(pluginType: string): T | null {
                const registry = getRegistry()
                const plugin = registry.get(pluginType)
                if (!plugin?.publicAPI) return null
                return plugin._resolvedAPI ?? null
            },

            isRegistered(pluginType: string): boolean {
                return getRegistry().has(pluginType)
            },
        },

        // ── Block discovery ────────────────────────────
        blocks: {
            listByType(type: string) {
                const store = getAppStore()
                const state = store.getState()
                const livePageId = state.blocks.get(blockId)?.pageId || block.pageId
                const result: Array<{ id: string; content: string; type: string }> = []
                for (const [, b] of state.blocks as Map<string, BlockData>) {
                    if (b.pageId === livePageId && b.type === type) {
                        result.push({ id: b.id, content: b.content, type: b.type })
                    }
                }
                return result
            },

            listAll() {
                const store = getAppStore()
                const state = store.getState()
                const livePageId = state.blocks.get(blockId)?.pageId || block.pageId
                const result: Array<{ id: string; content: string; type: string }> = []
                for (const [, b] of state.blocks as Map<string, BlockData>) {
                    if (b.pageId === livePageId) {
                        result.push({ id: b.id, content: b.content, type: b.type })
                    }
                }
                return result
            },
        },

        // ── UI ─────────────────────────────────────────
        ui: {
            theme() {
                return (document.documentElement.dataset.theme as 'light' | 'dark') || 'dark'
            },

            toast(_message: string, _type?: 'info' | 'success' | 'error' | 'warning') {
                // TODO: integrate with a proper toast system
            },

            async pickFile(_options?: {
                title?: string
                filters?: Array<{ name: string; extensions: string[] }>
            }): Promise<string | null> {
                try {
                    return await rpcCall<string>('PickTextFile')
                } catch {
                    return null
                }
            },

            openUrl(url: string) {
                // Use the Wails runtime BrowserOpenURL via the RPC proxy globals
                const w = window as any
                if (w.runtime?.BrowserOpenURL) {
                    w.runtime.BrowserOpenURL(url)
                } else {
                    // Fallback for dev/test environments
                    window.open(url, '_blank', 'noopener,noreferrer')
                }
            },

            getFontSize() {
                return sdkGetFontSize(blockId)
            },

            setFontSize(size: number) {
                sdkSetFontSize(blockId, size)
            },
        },

        // ── Editor ─────────────────────────────────────
        editor: {
            onClose(cb: (cursorLine: number) => void) {
                // Subscribe to the plugin bus event emitted by useTerminal on close
                return pluginBus.on('editor:closed', (payload: any) => {
                    if (payload?.blockId === blockId) {
                        cb(payload.cursorLine ?? 0)
                    }
                })
            },
        },
    }
}

/**
 * Create a "global" PluginContext (not tied to a specific block).
 * Used for onInit() lifecycle hooks.
 */
export function createGlobalPluginContext(pluginType: string): PluginContext {
    const fakeBlock: BlockData = {
        id: `__global_${pluginType}__`,
        pageId: '',
        type: pluginType,
        content: '',
        x: 0, y: 0, width: 0, height: 0,
    }
    return createPluginContext(fakeBlock)
}
