// ═══════════════════════════════════════════════════════════
// Plugin SDK — Public Barrel Exports
// ═══════════════════════════════════════════════════════════
//
// Plugins import from here:
//   import type { BlockPlugin, PluginContext, PluginRendererProps } from '../sdk'

export type {
    BlockPlugin,
    PluginContext,
    PluginRendererProps,
    PluginCapabilities,
    BlockData,
    ContextMenuItem,
    ShortcutDef,
} from './types'

export { rpcCall } from './runtime/rpcProxy'
