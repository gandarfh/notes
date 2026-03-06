import { useState, useMemo } from 'react'
import type { SchemaInfo } from './types'

interface SchemaSidebarProps {
    schema: SchemaInfo | null
    schemaLoading: boolean
    selectedTable: string | null
    onSelectTable: (tableName: string) => void
}

export function SchemaSidebar({ schema, schemaLoading, selectedTable, onSelectTable }: SchemaSidebarProps) {
    const [filter, setFilter] = useState('')

    const tables = useMemo(() => {
        if (!schema?.tables) return []
        if (!filter) return schema.tables
        const lower = filter.toLowerCase()
        return schema.tables.filter(t => t.name.toLowerCase().includes(lower))
    }, [schema, filter])

    return (
        <div className="db-schema-sidebar">
            <div className="db-schema-sidebar-header">
                <span>Tables</span>
                {schema?.tables && (
                    <span className="db-schema-count">{schema.tables.length}</span>
                )}
            </div>

            <div className="db-schema-search-wrap">
                <input
                    className="db-schema-search"
                    type="text"
                    placeholder="Filter tables..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
            </div>

            <div className="db-schema-list">
                {schemaLoading ? (
                    <div className="db-schema-loading">
                        <span className="w-3.5 h-3.5 border-2 border-text-muted/20 border-t-accent rounded-full animate-spin" />
                    </div>
                ) : tables.length === 0 ? (
                    <div className="db-schema-empty">
                        {filter ? 'No matches' : 'No tables'}
                    </div>
                ) : (
                    tables.map(t => (
                        <button
                            key={t.name}
                            className={`db-table-item ${selectedTable === t.name ? 'selected' : ''}`}
                            onClick={() => onSelectTable(t.name)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M3 9h18M3 15h18M9 9v12" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                            </svg>
                            <span>{t.name}</span>
                        </button>
                    ))
                )}
            </div>
        </div>
    )
}
