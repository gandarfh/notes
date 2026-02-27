// ═══════════════════════════════════════════════════════════
// Database Plugin — Local Type Definitions
// ═══════════════════════════════════════════════════════════

export interface DBConnView {
    id: string
    name: string
    driver: 'mysql' | 'postgres' | 'mongodb' | 'sqlite'
    host: string
    port: number
    database: string
    username: string
    sslMode: string
}

export interface CreateDBConnInput {
    name: string
    driver: string
    host: string
    port: number
    database: string
    username: string
    password: string
    sslMode: string
}

export interface QueryResultView {
    columns: string[]
    rows: any[][]
    totalRows: number
    hasMore: boolean
    durationMs: number
    error: string
    isWrite: boolean
    affectedRows: number
    query: string
    primaryKeys?: string[]
}

export interface Mutation {
    type: 'update' | 'delete'
    rowKey: Record<string, any>
    changes?: Record<string, any>
}

export interface MutationResult {
    applied: number
    errors?: string[]
}

export interface SchemaInfo {
    tables: TableInfo[]
}

export interface TableInfo {
    name: string
    columns: ColumnInfo[]
}

export interface ColumnInfo {
    name: string
    type: string
}
