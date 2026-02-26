import type { BlockPlugin } from './types'
import { createPluginContext } from './sdk/runtime/contextFactory'

class BlockRegistryImpl {
    private plugins = new Map<string, BlockPlugin>()
    private cleanups = new Map<string, () => void>()

    /** Register a block plugin and call its onInit lifecycle hook */
    register(plugin: BlockPlugin) {
        if (this.plugins.has(plugin.type)) {
            // Clean up previous instance if re-registering
            this.cleanups.get(plugin.type)?.()
            this.cleanups.delete(plugin.type)
            console.warn(`BlockPlugin "${plugin.type}" already registered, overwriting.`)
        }
        this.plugins.set(plugin.type, plugin)

        // Call onInit lifecycle hook if defined
        if (plugin.onInit) {
            try {
                const ctx = createPluginContext({
                    id: `__init_${plugin.type}`,
                    pageId: '',
                    type: plugin.type,
                    content: '',
                    x: 0, y: 0, width: 0, height: 0,
                } as any)
                const cleanup = plugin.onInit(ctx)
                if (typeof cleanup === 'function') {
                    this.cleanups.set(plugin.type, cleanup)
                }
            } catch (err) {
                console.error(`[Registry] onInit failed for "${plugin.type}":`, err)
            }
        }
    }

    /** Get plugin by type */
    get(type: string): BlockPlugin | undefined {
        return this.plugins.get(type)
    }

    /** Get all registered plugins */
    getAll(): BlockPlugin[] {
        return [...this.plugins.values()]
    }

    /** Get plugins that can be created from toolbar */
    getCreatable(): BlockPlugin[] {
        return this.getAll().filter(p => p.defaultSize)
    }

    /** Check if a type is registered */
    has(type: string): boolean {
        return this.plugins.has(type)
    }

    /** Clean up all plugins (call onInit cleanup functions) */
    destroy() {
        for (const [type, cleanup] of this.cleanups) {
            try { cleanup() } catch (err) {
                console.error(`[Registry] cleanup failed for "${type}":`, err)
            }
        }
        this.cleanups.clear()
    }
}

/** Global block plugin registry — import and call register() to add new block types */
export const BlockRegistry = new BlockRegistryImpl()
