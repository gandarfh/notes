import type { BlockPlugin } from './types'

class BlockRegistryImpl {
    private plugins = new Map<string, BlockPlugin>()

    /** Register a block plugin */
    register(plugin: BlockPlugin) {
        if (this.plugins.has(plugin.type)) {
            console.warn(`BlockPlugin "${plugin.type}" already registered, overwriting.`)
        }
        this.plugins.set(plugin.type, plugin)
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
}

/** Global block plugin registry — import and call register() to add new block types */
export const BlockRegistry = new BlockRegistryImpl()
