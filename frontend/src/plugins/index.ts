/** Plugin initialization — registers all built-in block plugins */
import { BlockRegistry } from './registry'
import { markdownPlugin } from './markdown'
import { drawingPlugin } from './drawing'
import { imagePlugin } from './image'
import { databasePlugin } from './database'
import { codePlugin } from './code'
import { localdbPlugin } from './localdb'
import { chartPlugin } from './chart'
import { etlPlugin } from './etl'
import { httpPlugin } from './http'
import { useAppStore } from '../store'

export function registerBuiltinPlugins() {
    // Wire SDK runtime globals (used by contextFactory via lazy access)
    ; (window as any).__pluginSDK_appStore = useAppStore
        ; (window as any).__pluginSDK_registry = BlockRegistry

    BlockRegistry.register(markdownPlugin)
    BlockRegistry.register(drawingPlugin)
    BlockRegistry.register(imagePlugin)
    BlockRegistry.register(databasePlugin)
    BlockRegistry.register(codePlugin)
    BlockRegistry.register(localdbPlugin)
    BlockRegistry.register(chartPlugin)
    BlockRegistry.register(etlPlugin)
    BlockRegistry.register(httpPlugin)
}

export { BlockRegistry } from './registry'
export type { BlockPlugin, BlockRendererProps, BlockData } from './types'
