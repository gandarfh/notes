import type { ReactNode } from 'react'
import type { Block } from '../bridge/wails'

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
    ToolbarExtension?: React.ComponentType<{ blockId: string }>

    /** Optional: context menu items for this block type */
    contextMenuItems?: (blockId: string) => ContextMenuItem[]

    /** Optional: keyboard shortcuts for this block type */
    shortcuts?: ShortcutDef[]
}

// ── Renderer Props ─────────────────────────────────────────

export interface BlockRendererProps {
    block: BlockData
    isEditing: boolean
    isSelected: boolean
    onContentChange: (content: string) => void
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
