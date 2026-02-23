/** Plugin initialization — registers all built-in block plugins */
import { BlockRegistry } from './registry'
import { markdownPlugin } from './markdown'
import { drawingPlugin } from './drawing'
import { imagePlugin } from './image'
import { databasePlugin } from './database'
import { codePlugin } from './code'

export function registerBuiltinPlugins() {
    BlockRegistry.register(markdownPlugin)
    BlockRegistry.register(drawingPlugin)
    BlockRegistry.register(imagePlugin)
    BlockRegistry.register(databasePlugin)
    BlockRegistry.register(codePlugin)
}

export { BlockRegistry } from './registry'
export type { BlockPlugin, BlockRendererProps, BlockData } from './types'
