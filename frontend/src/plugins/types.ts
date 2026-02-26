import type { ReactNode } from 'react'
import type { Block } from '../bridge/wails'
import type { PluginContext } from './sdk'

// ── Block Data (same as backend) ───────────────────────────

export type BlockData = Block

// ── Block Plugin Interface ─────────────────────────────────

export interface BlockPlugin {
    /** Unique block type identifier (matches backend block.type) */
    type: string

    /** Display label */
    label: string

    /** Icon component for toolbar/header */
    Icon: React.ComponentType<{ size?: number }>

    /** Default dimensions when creating via toolbar */
    defaultSize: { width: number; height: number }

    /** The React component that renders block content */
    Renderer: React.ComponentType<BlockRendererProps>

    /** Short header label (e.g. 'MD', 'DRAW') */
    headerLabel?: string

    /** Optional: extra toolbar controls when a block of this type is selected */
    ToolbarExtension?: React.ComponentType<{ ctx: PluginContext }>

    /** Optional: context menu items for this block type */
    contextMenuItems?: (ctx: PluginContext) => ContextMenuItem[]

    /** Optional: keyboard shortcuts for this block type */
    shortcuts?: ShortcutDef[]

    /** Lifecycle: called once on registration. Returns cleanup fn. */
    onInit?(ctx: PluginContext): (() => void) | void

    /** Called when a new block of this type is created */
    onBlockCreate?(ctx: PluginContext): Promise<void> | void

    /** Public API exposed to other plugins via ctx.plugins.getAPI() */
    publicAPI?: (ctx: PluginContext) => Record<string, (...args: any[]) => any>
}

// ── Renderer Props ─────────────────────────────────────────

export interface BlockRendererProps {
    block: BlockData
    isEditing: boolean
    isSelected: boolean
    onContentChange: (content: string) => void
    /** Plugin SDK context — provided by host, optional for backward compat */
    ctx?: PluginContext
}

// ── Supporting Types ───────────────────────────────────────

export interface ContextMenuItem {
    label: string
    action: () => void
    danger?: boolean
    icon?: ReactNode
}

export interface ShortcutDef {
    key: string
    ctrl?: boolean
    shift?: boolean
    meta?: boolean
    action: () => void
    description: string
}
