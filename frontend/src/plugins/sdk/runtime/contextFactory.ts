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
    // Dynamic import pattern to defer resolution
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

        // ── Block info ─────────────────────────────────
        block: {
            get id() { return block.id },
            get pageId() { return block.pageId },
            get type() { return block.type },
            get x() { return block.x },
            get y() { return block.y },
            get width() { return block.width },
            get height() { return block.height },
            get filePath() { return block.filePath },
        },

        // ── Inter-plugin ───────────────────────────────
        plugins: {
            getAPI<T = Record<string, Function>>(pluginType: string): T | null {
                const registry = getRegistry()
                const plugin = registry.get(pluginType)
                if (!plugin?.publicAPI) return null
                // publicAPI is a factory fn that receives a context
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
                const all = store.getState().blocks as Map<string, BlockData>
                const result: Array<{ id: string; content: string; type: string }> = []
                for (const [, b] of all) {
                    if (b.pageId === block.pageId && b.type === type) {
                        result.push({ id: b.id, content: b.content, type: b.type })
                    }
                }
                return result
            },

            listAll() {
                const store = getAppStore()
                const all = store.getState().blocks as Map<string, BlockData>
                const result: Array<{ id: string; content: string; type: string }> = []
                for (const [, b] of all) {
                    if (b.pageId === block.pageId) {
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
                // No-op until toast UI is implemented
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
