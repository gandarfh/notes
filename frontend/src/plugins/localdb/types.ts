// ═══════════════════════════════════════════════════════════
// LocalDB Plugin — Local Type Definitions
// ═══════════════════════════════════════════════════════════
// Mirrors the Wails-generated types so plugins don't import from bridge.

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'select' | 'multi-select' | 'checkbox' | 'url' | 'person' | 'timer' | 'formula' | 'relation' | 'rollup' | 'progress' | 'rating'

export interface ColumnDef {
    id: string
    name: string
    type: ColumnType
    width: number
    options?: string[]
    optionColors?: Record<string, string>  // option label → color id (e.g. 'red', 'blue')
    formula?: string
    relationDbId?: string
    rollupRelCol?: string
    rollupAgg?: string
}

export interface ViewConfig {
    titleColumn?: string
    groupByColumn?: string
    dateColumn?: string
    checkboxColumn?: string
    sorting?: { id: string; desc: boolean }[]
    filters?: { id: string; columnId: string; operator: string; value: unknown }[]
    columnVisibility?: Record<string, boolean>
}

export interface SavedView {
    id: string
    name: string
    layout: string
    config: ViewConfig
}

export interface LocalDatabaseConfig {
    columns: ColumnDef[]
    // Legacy single-view
    activeView?: string
    viewConfig?: ViewConfig
    // Multi-view system
    views?: SavedView[]
    activeViewId?: string
}

export interface LocalDatabase {
    id: string
    blockId: string
    name: string
    configJson: string
    createdAt: string
    updatedAt: string
}

export interface LocalDBRow {
    id: string
    databaseId: string
    dataJson: string
    sortOrder: number
    createdAt: string
    updatedAt: string
}

export interface LocalDBStats {
    rowCount: number
    lastUpdated: string
}
