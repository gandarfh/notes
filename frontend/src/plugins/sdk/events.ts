// ═══════════════════════════════════════════════════════════
// Plugin Event Catalog — typed contract for all plugin events
// ═══════════════════════════════════════════════════════════
//
// ALL inter-plugin and backend events MUST be declared here.
// This provides full type-safety for emit/on/onBackend calls.

// ── Frontend-only (inter-plugin) events ───────────────────

export interface PluginEventMap {
    // Block content changed (from plugin or Neovim sync)
    'block:content-changed': { blockId: string; type: string }
    // Block font size changed
    'block:fontsize-changed': { blockId: string; size: number }
    // Neovim/terminal editor was closed for a block
    'editor:closed': { blockId: string; cursorLine: number }
    // Toast notification requested by a plugin
    'ui:toast': { message: string; type: 'info' | 'success' | 'error' | 'warning' }
    // LocalDB data was changed (rows added/removed/updated)
    'localdb:data-changed': { databaseId: string }
    // ETL job completed (triggered from backend event relay)
    'etl:job-completed': { jobId: string }
    // MCP activity pulse (external agent made changes)
    'mcp:activity': { changes: number; pageId: string }
    // MCP approval required for destructive action
    'mcp:approval-required': { id: string; tool: string; description: string; metadata?: string }
    // MCP approval dismissed (timeout)
    'mcp:approval-dismissed': { id: string }
}

// ── Backend (Wails Events) events ─────────────────────────
// These are emitted by Go via wailsRuntime.EventsEmit and
// received via ctx.events.onBackend / pluginBus.onBackend.

export interface WailsEventMap {
    // Neovim updated block content
    'block:content-updated': { blockId: string; content: string }
    // ETL run completed, frontend should refresh target DB
    'db:updated': { databaseId: string; jobId: string }
    // Cron/file-watch ETL job completed
    'etl:job-completed': string  // payload is jobId string
    // Terminal PTY output (base64 encoded)
    'terminal:data': string
}

// ── Helper types ───────────────────────────────────────────

export type PluginEventKey = keyof PluginEventMap
export type WailsEventKey = keyof WailsEventMap
