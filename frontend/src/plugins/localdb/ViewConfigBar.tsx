import { createPortal } from 'react-dom'
import { useState, useRef, useEffect } from 'react'
import type { ColumnDef, ViewConfig } from './types'
import type { ViewType } from './ViewSwitcher'
import { FilterBuilder, type FilterCondition } from './FilterBuilder'
import type { Table } from '@tanstack/react-table'
import type { ParsedRow } from './useLocalDBTable'

// ── View Config Bar ────────────────────────────────────────
// Toolbar showing field pickers (kanban/calendar) and sort/filter/visibility controls.

interface ViewConfigBarProps {
    activeView: ViewType
    columns: ColumnDef[]
    viewConfig: ViewConfig
    onConfigChange: (config: ViewConfig) => void
    table?: Table<ParsedRow>
}

interface FieldPickerDef {
    key: 'titleColumn' | 'groupByColumn' | 'dateColumn' | 'checkboxColumn'
    label: string
    filter?: (col: ColumnDef) => boolean
}

const VIEW_FIELDS: Record<string, FieldPickerDef[]> = {
    kanban: [
        { key: 'titleColumn', label: 'Title', filter: c => c.type === 'text' },
        { key: 'groupByColumn', label: 'Group by', filter: c => c.type === 'select' || c.type === 'multi-select' },
    ],
    calendar: [
        { key: 'titleColumn', label: 'Title', filter: c => c.type === 'text' },
        { key: 'dateColumn', label: 'Date', filter: c => c.type === 'date' || c.type === 'datetime' },
    ],
}

export function ViewConfigBar({ activeView, columns, viewConfig, onConfigChange, table }: ViewConfigBarProps) {
    const fields = VIEW_FIELDS[activeView]
    const [showFilter, setShowFilter] = useState(false)
    const [showColVis, setShowColVis] = useState(false)
    const filterBtnRef = useRef<HTMLButtonElement>(null)
    const colVisBtnRef = useRef<HTMLButtonElement>(null)
    const [colVisPos, setColVisPos] = useState({ top: 0, left: 0 })

    // Filter state derived from viewConfig
    const filters: FilterCondition[] = viewConfig.filters ?? []
    const activeFilterCount = filters.length

    const handleFiltersChange = (newFilters: FilterCondition[]) => {
        onConfigChange({ ...viewConfig, filters: newFilters })
        // Also update TanStack column filters
        if (table) {
            table.setColumnFilters(
                newFilters.map(f => ({
                    id: f.columnId,
                    value: { operator: f.operator, value: f.value },
                }))
            )
        }
    }

    // Sort info — derived from viewConfig
    const sortCount = viewConfig.sorting?.length ?? 0

    const clearSort = () => {
        onConfigChange({ ...viewConfig, sorting: [] })
        if (table) table.resetSorting()
    }

    // Column visibility
    useEffect(() => {
        if (!showColVis || !colVisBtnRef.current) return
        const rect = colVisBtnRef.current.getBoundingClientRect()
        setColVisPos({ top: rect.bottom + 4, left: rect.left })
    }, [showColVis])

    const toggleColumnVisibility = (colId: string) => {
        if (!table) return
        const col = table.getColumn(colId)
        if (col) col.toggleVisibility()
        // Persist to viewConfig
        const current = viewConfig.columnVisibility || {}
        const isVisible = current[colId] !== false
        onConfigChange({
            ...viewConfig,
            columnVisibility: { ...current, [colId]: !isVisible },
        })
    }

    const hasToolbar = activeView === 'table' || fields

    if (!hasToolbar) return null

    return (
        <div className="ldb-view-config-bar">
            {/* View-specific field pickers */}
            {fields && fields.map(field => {
                const eligible = field.filter ? columns.filter(field.filter) : columns
                const currentId = viewConfig[field.key] as string | undefined
                const currentCol = columns.find(c => c.id === currentId)

                return (
                    <FieldPicker
                        key={field.key}
                        label={field.label}
                        value={currentCol?.name || 'Auto'}
                        options={eligible}
                        selected={currentId}
                        onChange={colId => onConfigChange({ ...viewConfig, [field.key]: colId })}
                    />
                )
            })}

            {/* Spacer */}
            {fields && <div style={{ flex: 1 }} />}

            {/* Sort indicator */}
            {sortCount > 0 && (
                <button className="ldb-toolbar-btn active" onClick={clearSort} title="Clear sort">
                    Sort <span className="ldb-toolbar-badge">{sortCount}</span>
                </button>
            )}

            {/* Filter button */}
            <button
                ref={filterBtnRef}
                className={`ldb-toolbar-btn ${activeFilterCount > 0 ? 'active' : ''}`}
                onClick={() => setShowFilter(!showFilter)}
            >
                Filter
                {activeFilterCount > 0 && <span className="ldb-toolbar-badge">{activeFilterCount}</span>}
            </button>

            {/* Column visibility button (table view only) */}
            {activeView === 'table' && table && (
                <button
                    ref={colVisBtnRef}
                    className="ldb-toolbar-btn"
                    onClick={() => setShowColVis(!showColVis)}
                >
                    Columns
                </button>
            )}

            {/* Filter popover */}
            {showFilter && (
                <FilterBuilder
                    columns={columns}
                    filters={filters}
                    onChange={handleFiltersChange}
                    anchorEl={filterBtnRef.current}
                    onClose={() => setShowFilter(false)}
                />
            )}

            {/* Column visibility popover */}
            {showColVis && table && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => setShowColVis(false)} />
                    <div
                        className="ldb-col-vis-dropdown"
                        style={{ position: 'fixed', top: colVisPos.top, left: colVisPos.left, zIndex: 9999 }}
                    >
                        {columns.map(col => {
                            const isVisible = table.getColumn(col.id)?.getIsVisible() ?? true
                            return (
                                <div
                                    key={col.id}
                                    className={`ldb-col-vis-item ${isVisible ? 'visible' : ''}`}
                                    onClick={() => toggleColumnVisibility(col.id)}
                                >
                                    <span className="ldb-col-vis-check">{isVisible ? '\u2713' : ''}</span>
                                    {col.name}
                                </div>
                            )
                        })}
                    </div>
                </>,
                document.body,
            )}
        </div>
    )
}

// ── Field Picker ───────────────────────────────────────────

function FieldPicker({ label, value, options, selected, onChange }: {
    label: string
    value: string
    options: ColumnDef[]
    selected?: string
    onChange: (colId: string | undefined) => void
}) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [pos, setPos] = useState({ top: 0, left: 0 })

    useEffect(() => {
        if (!open || !triggerRef.current) return
        const rect = triggerRef.current.getBoundingClientRect()
        setPos({ top: rect.bottom + 4, left: rect.left })
    }, [open])

    return (
        <div className="ldb-field-picker">
            <span className="ldb-field-picker-label">{label}:</span>
            <button ref={triggerRef} className="ldb-field-picker-btn" onClick={() => setOpen(!open)}>
                {value} &#x25BE;
            </button>

            {open && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => setOpen(false)} />
                    <div className="ldb-field-picker-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
                        <div
                            className={`ldb-field-picker-option ${!selected ? 'active' : ''}`}
                            onClick={() => { onChange(undefined); setOpen(false) }}
                        >
                            Auto (first match)
                        </div>
                        {options.map(col => (
                            <div
                                key={col.id}
                                className={`ldb-field-picker-option ${selected === col.id ? 'active' : ''}`}
                                onClick={() => { onChange(col.id); setOpen(false) }}
                            >
                                {col.name}
                            </div>
                        ))}
                    </div>
                </>,
                document.body,
            )}
        </div>
    )
}
