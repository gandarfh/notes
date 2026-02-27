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
import type { PluginEventMap, WailsEventMap } from './events'
import type {
    ETLSourceSpec, ETLJobInput, ETLSyncJob, ETLSyncResult,
    ETLPreviewResult, ETLRunLog, ETLSchemaInfo, PageBlockRef,
    LocalDatabase, LocalDBRow, LocalDBStats,
    DBConnView, CreateDBConnInput, SchemaInfo, QueryResultView,
    Mutation, MutationResult, HTTPResponse,
} from '../../bridge/wails'

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

// ── Namespaced RPC sub-interfaces ──────────────────────────
// These mirror bridge/api/ but are declared here so plugins
// can use them via PluginContext without importing bridge/ directly.

export interface ETLRPC {
    listSources(): Promise<ETLSourceSpec[]>
    createJob(input: ETLJobInput): Promise<ETLSyncJob>
    getJob(id: string): Promise<ETLSyncJob>
    listJobs(): Promise<ETLSyncJob[]>
    updateJob(id: string, input: ETLJobInput): Promise<void>
    deleteJob(id: string): Promise<void>
    runJob(id: string): Promise<ETLSyncResult>
    previewSource(sourceType: string, sourceConfigJSON: string): Promise<ETLPreviewResult>
    listRunLogs(jobID: string): Promise<ETLRunLog[]>
    pickFile(): Promise<string>
    listPageDatabaseBlocks(pageID: string): Promise<PageBlockRef[]>
    discoverSchema(sourceType: string, sourceConfigJSON: string): Promise<ETLSchemaInfo>
    listPageHTTPBlocks(pageID: string): Promise<PageBlockRef[]>
}

export interface LocalDatabaseRPC {
    createDatabase(blockID: string, name: string): Promise<LocalDatabase>
    getDatabase(blockID: string): Promise<LocalDatabase>
    updateConfig(dbID: string, configJSON: string): Promise<void>
    renameDatabase(dbID: string, name: string): Promise<void>
    deleteDatabase(dbID: string): Promise<void>
    listDatabases(): Promise<LocalDatabase[]>
    createRow(dbID: string, dataJSON: string): Promise<LocalDBRow>
    listRows(dbID: string): Promise<LocalDBRow[]>
    updateRow(rowID: string, dataJSON: string): Promise<void>
    deleteRow(rowID: string): Promise<void>
    duplicateRow(rowID: string): Promise<LocalDBRow>
    reorderRows(dbID: string, rowIDs: string[]): Promise<void>
    batchUpdateRows(dbID: string, mutationsJSON: string): Promise<void>
    getStats(dbID: string): Promise<LocalDBStats>
}

export interface DatabaseRPC {
    listConnections(): Promise<DBConnView[]>
    createConnection(input: CreateDBConnInput): Promise<DBConnView>
    updateConnection(id: string, input: CreateDBConnInput): Promise<void>
    deleteConnection(id: string): Promise<void>
    testConnection(id: string): Promise<void>
    introspect(connectionID: string): Promise<SchemaInfo>
    executeQuery(blockID: string, connectionID: string, query: string, fetchSize: number): Promise<QueryResultView>
    fetchMoreRows(connectionID: string, fetchSize: number): Promise<QueryResultView>
    getCachedResult(blockID: string): Promise<QueryResultView | null>
    clearCachedResult(blockID: string): Promise<void>
    saveBlockConfig(blockID: string, config: string): Promise<void>
    pickFile(): Promise<string>
    applyMutations(connectionID: string, table: string, mutations: Mutation[]): Promise<MutationResult>
}

export interface HTTPRPC {
    executeRequest(blockID: string, configJSON: string): Promise<HTTPResponse>
    saveBlockConfig(blockID: string, config: string): Promise<void>
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
        /** Call any Go App method by name (low-level escape hatch) */
        call<T = any>(method: string, ...args: any[]): Promise<T>
        /** Typed ETL API */
        etl: ETLRPC
        /** Typed Local Database API */
        localdb: LocalDatabaseRPC
        /** Typed External Database API */
        database: DatabaseRPC
        /** Typed HTTP block API */
        http: HTTPRPC
    }

    // ── Events (inter-plugin communication) ────────────
    events: {
        /** Emit a typed plugin event */
        emit<K extends keyof PluginEventMap>(event: K, payload: PluginEventMap[K]): void
        /** @deprecated — use typed overload above */
        emit(event: string, payload?: Record<string, unknown>): void

        /** Subscribe to a typed plugin event. Returns unsub fn. */
        on<K extends keyof PluginEventMap>(event: K, handler: (payload: PluginEventMap[K]) => void): () => void
        /** @deprecated — use typed overload above */
        on(event: string, handler: (payload: any) => void): () => void

        /** Subscribe to a typed Wails backend event. Returns unsub fn. */
        onBackend<K extends keyof WailsEventMap>(event: K, handler: (payload: WailsEventMap[K]) => void): () => void
        /** @deprecated — use typed overload above */
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
