// ═══════════════════════════════════════════════════════════
// Plugin SDK — The Contract
// ═══════════════════════════════════════════════════════════
//
// Plugins MUST ONLY import from:
//   - '../sdk'     (this package)
//   - '../shared'  (shared hooks & components)
//   - their own directory
//
// Plugins MUST NEVER import from:
//   - '../../store'
//   - '../../bridge/wails'
//   - another plugin directory
//   - window.go / window.runtime

import type { ReactNode } from 'react'

// ── Block Data (read-only, provided by host) ───────────────

export interface BlockData {
    id: string
    pageId: string
    type: string
    content: string
    x: number
    y: number
    width: number
    height: number
    filePath?: string
    styleJson?: string
    createdAt?: string
    updatedAt?: string
}

// ── PluginContext — injected by host ───────────────────────

export interface PluginContext {
    // ── Storage ────────────────────────────────────────
    storage: {
        /** Read block.content (JSON string) */
        getContent(): string
        /** Write & persist block.content */
        setContent(content: string): void
        /** Debounced setContent (500ms) */
        setContentDebounced(content: string): void
    }

    // ── RPC (call Go backend) ──────────────────────────
    rpc: {
        /** Call any Go App method by name */
        call<T = any>(method: string, ...args: any[]): Promise<T>
    }

    // ── Events (inter-plugin communication) ────────────
    events: {
        /** Emit a plugin event */
        emit(event: string, payload?: Record<string, unknown>): void
        /** Subscribe to a plugin event. Returns unsub fn. */
        on(event: string, handler: (payload: any) => void): () => void
        /** Subscribe to a Wails backend event. Returns unsub fn. */
        onBackend(event: string, handler: (...args: any[]) => void): () => void
    }

    // ── Block info ─────────────────────────────────────
    block: {
        readonly id: string
        readonly pageId: string
        readonly type: string
        readonly x: number
        readonly y: number
        readonly width: number
        readonly height: number
        readonly filePath?: string
    }

    // ── Inter-plugin ───────────────────────────────────
    plugins: {
        /** Get another plugin's public API */
        getAPI<T = Record<string, Function>>(pluginType: string): T | null
        /** Check if a plugin is registered */
        isRegistered(pluginType: string): boolean
    }

    // ── Block discovery ────────────────────────────────
    blocks: {
        /** List blocks on the current page, optionally by type */
        listByType(type: string): Array<{ id: string; content: string; type: string }>
        /** List all blocks on the current page */
        listAll(): Array<{ id: string; content: string; type: string }>
    }

    // ── UI services ────────────────────────────────────
    ui: {
        /** Current theme */
        theme(): 'light' | 'dark'
        /** Show a toast notification */
        toast(message: string, type?: 'info' | 'success' | 'error' | 'warning'): void
        /** Open native file picker */
        pickFile(options?: {
            title?: string
            filters?: Array<{ name: string; extensions: string[] }>
        }): Promise<string | null>
        /** Open a URL in the system default browser */
        openUrl(url: string): void
        /** Get persisted font size for this block */
        getFontSize(): number
        /** Set and persist font size for this block */
        setFontSize(size: number): void
    }

    // ── Editor (terminal/neovim) ────────────────────────
    editor: {
        /**
         * Subscribe to editor-close events for this block.
         * Called with the cursor line when the editor closes.
         * Returns an unsubscribe function.
         */
        onClose(cb: (cursorLine: number) => void): () => void
    }
}

// ── Plugin Renderer Props ──────────────────────────────────

export interface PluginRendererProps {
    block: BlockData
    isEditing: boolean
    isSelected: boolean
    ctx: PluginContext
    /** @deprecated Use ctx.storage.setContent() instead */
    onContentChange?: (content: string) => void
}

// ── Context Menu ───────────────────────────────────────────

export interface ContextMenuItem {
    label: string
    icon?: ReactNode
    action: () => void
    separator?: boolean
    disabled?: boolean
}

// ── Shortcut ───────────────────────────────────────────────

export interface ShortcutDef {
    key: string
    meta?: boolean
    shift?: boolean
    alt?: boolean
    action: () => void
    label?: string
}

// ── Plugin Capabilities ────────────────────────────────────
// Declarative flags that replace type-specific conditionals in the host.

export interface PluginCapabilities {
    /** Mount a terminal (Neovim) on edit; show Edit + Link-file header buttons */
    editable?: boolean
    /** Lock aspect ratio during resize (e.g. image) */
    aspectRatioResize?: boolean
    /** Use border-radius sm instead of md */
    smallBorderRadius?: boolean
    /** Remove default content padding */
    zeroPadding?: boolean
    /**
     * No block background, no header, no shadow.
     * Use for blocks where the content IS the block (e.g. image).
     */
    headerless?: boolean
}

// ── BlockPlugin — the main contract ────────────────────────

export interface BlockPlugin {
    // ── Identity ───────────────────────────────────────
    type: string
    label: string
    Icon: React.ComponentType<{ size?: number }>
    defaultSize: { width: number; height: number }
    headerLabel?: string

    // ── Capabilities (replaces host type-checks) ────────
    capabilities?: PluginCapabilities

    // ── Rendering ──────────────────────────────────────
    Renderer: React.ComponentType<PluginRendererProps>

    /**
     * Optional extra controls rendered inside the block header.
     * Receives the blockId so the component can read/write its own state.
     */
    HeaderExtension?: React.ComponentType<{ blockId: string; ctx: PluginContext }>

    // ── Lifecycle ──────────────────────────────────────
    /** Called once on registration. Returns cleanup fn. */
    onInit?(ctx: PluginContext): (() => void) | void
    /** Called when a new block of this type is created */
    onBlockCreate?(ctx: PluginContext): Promise<void> | void

    // ── Public API (for other plugins) ─────────────────
    publicAPI?: (ctx: PluginContext) => Record<string, (...args: any[]) => any>

    // ── Extensions ─────────────────────────────────────
    ToolbarExtension?: React.ComponentType<{ ctx: PluginContext }>
    contextMenuItems?: (ctx: PluginContext) => ContextMenuItem[]
    shortcuts?: ShortcutDef[]
}
