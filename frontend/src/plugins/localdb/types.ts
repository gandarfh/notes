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
}

export interface LocalDatabaseConfig {
    columns: ColumnDef[]
    activeView: string
    viewConfig?: ViewConfig
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
