// ═══════════════════════════════════════════════════════════
// Chart Plugin — Local Type Definitions
// ═══════════════════════════════════════════════════════════

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

export interface LocalDatabase {
    id: string
    blockId: string
    name: string
    configJson: string
    createdAt: string
    updatedAt: string
}
