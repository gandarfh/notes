import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { SchemaInfo } from './types'

interface SchemaSidebarProps {
    schema: SchemaInfo | null
    schemaLoading: boolean
    selectedTable: string | null
    onSelectTable: (tableName: string) => void
}

const ITEM_HEIGHT = 30
const OVERSCAN = 5

export function SchemaSidebar({ schema, schemaLoading, selectedTable, onSelectTable }: SchemaSidebarProps) {
    const [filter, setFilter] = useState('')
    const [debouncedFilter, setDebouncedFilter] = useState('')
    const scrollRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [containerHeight, setContainerHeight] = useState(300)

    // Debounce filter input
    useEffect(() => {
        const id = setTimeout(() => setDebouncedFilter(filter), 150)
        return () => clearTimeout(id)
    }, [filter])

    const tables = useMemo(() => {
        if (!schema?.tables) return []
        if (!debouncedFilter) return schema.tables
        const lower = debouncedFilter.toLowerCase()
        return schema.tables.filter(t => t.name.toLowerCase().includes(lower))
    }, [schema, debouncedFilter])

    // Track container height
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const obs = new ResizeObserver(entries => {
            setContainerHeight(entries[0].contentRect.height)
        })
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    const handleScroll = useCallback(() => {
        if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
    }, [])

    // Compute visible window
    const totalHeight = tables.length * ITEM_HEIGHT
    const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
    const endIdx = Math.min(tables.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN)
    const visibleTables = tables.slice(startIdx, endIdx)

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

            <div className="db-schema-list" ref={scrollRef} onScroll={handleScroll}>
                {schemaLoading ? (
                    <div className="db-schema-loading">
                        <span className="w-3.5 h-3.5 border-2 border-text-muted/20 border-t-accent rounded-full animate-spin" />
                    </div>
                ) : tables.length === 0 ? (
                    <div className="db-schema-empty">
                        {filter ? 'No matches' : 'No tables'}
                    </div>
                ) : (
                    <div style={{ height: totalHeight, position: 'relative' }}>
                        {visibleTables.map((t, i) => (
                            <button
                                key={t.name}
                                className={`db-table-item ${selectedTable === t.name ? 'selected' : ''}`}
                                style={{
                                    position: 'absolute',
                                    top: (startIdx + i) * ITEM_HEIGHT,
                                    left: 0,
                                    right: 0,
                                    height: ITEM_HEIGHT,
                                }}
                                onClick={() => onSelectTable(t.name)}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.2" />
                                    <path d="M3 9h18M3 15h18M9 9v12" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                                </svg>
                                <span>{t.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
