import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnDef, ColumnType } from './types'

// ── Filter Builder ──────────────────────────────────────────
// Popover for building filter conditions on the table.
// Edits are buffered locally — only applied on "Apply".

export interface FilterCondition {
    id: string
    columnId: string
    operator: string
    value: unknown
}

interface FilterBuilderProps {
    columns: ColumnDef[]
    filters: FilterCondition[]
    onChange: (filters: FilterCondition[]) => void
    anchorEl: HTMLElement | null
    onClose: () => void
}

const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
    text: [
        { value: 'contains', label: 'contains' },
        { value: 'not_contains', label: 'does not contain' },
        { value: 'is', label: 'is' },
        { value: 'is_not', label: 'is not' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
    ],
    number: [
        { value: 'eq', label: '=' },
        { value: 'neq', label: '\u2260' },
        { value: 'gt', label: '>' },
        { value: 'lt', label: '<' },
        { value: 'gte', label: '\u2265' },
        { value: 'lte', label: '\u2264' },
    ],
    select: [
        { value: 'is', label: 'is' },
        { value: 'is_not', label: 'is not' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
    ],
    'multi-select': [
        { value: 'contains', label: 'contains' },
        { value: 'not_contains', label: 'does not contain' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
    ],
    checkbox: [
        { value: 'is_checked', label: 'is checked' },
        { value: 'is_not_checked', label: 'is not checked' },
    ],
    date: [
        { value: 'is', label: 'is' },
        { value: 'before', label: 'before' },
        { value: 'after', label: 'after' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
    ],
    url: [
        { value: 'contains', label: 'contains' },
        { value: 'is', label: 'is' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
    ],
}

function getOperators(type: ColumnType) {
    return OPERATORS_BY_TYPE[type] || OPERATORS_BY_TYPE['text']
}

function needsValue(operator: string) {
    return !['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'].includes(operator)
}

let filterId = 0

// Check if two filter arrays are equivalent
function filtersEqual(a: FilterCondition[], b: FilterCondition[]): boolean {
    if (a.length !== b.length) return false
    return a.every((f, i) =>
        f.id === b[i].id &&
        f.columnId === b[i].columnId &&
        f.operator === b[i].operator &&
        String(f.value ?? '') === String(b[i].value ?? ''),
    )
}

export function FilterBuilder({ columns, filters, onChange, anchorEl, onClose }: FilterBuilderProps) {
    // Draft state — edits happen here, only committed on Apply
    const [draft, setDraft] = useState<FilterCondition[]>(filters)

    // Sync draft when external filters change (e.g. cleared from toolbar)
    useEffect(() => { setDraft(filters) }, [filters])

    if (!anchorEl) return null
    const rect = anchorEl.getBoundingClientRect()

    const isDirty = !filtersEqual(draft, filters)

    const addFilter = () => {
        if (columns.length === 0) return
        const col = columns[0]
        const ops = getOperators(col.type)
        setDraft([...draft, {
            id: `f-${++filterId}`,
            columnId: col.id,
            operator: ops[0].value,
            value: '',
        }])
    }

    const updateFilter = (id: string, patch: Partial<FilterCondition>) => {
        setDraft(draft.map(f => f.id === id ? { ...f, ...patch } : f))
    }

    const removeFilter = (id: string) => {
        setDraft(draft.filter(f => f.id !== id))
    }

    const handleColumnChange = (filter: FilterCondition, newColId: string) => {
        const col = columns.find(c => c.id === newColId)
        if (!col) return
        const ops = getOperators(col.type)
        updateFilter(filter.id, {
            columnId: newColId,
            operator: ops[0].value,
            value: '',
        })
    }

    const handleApply = () => {
        onChange(draft)
    }

    const handleClear = () => {
        setDraft([])
        onChange([])
    }

    return createPortal(
        <>
            <div className="ldb-backdrop" onClick={onClose} />
            <div
                className="ldb-filter-builder"
                style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 9999 }}
                onMouseDown={e => e.stopPropagation()}
            >
                <div className="ldb-filter-header">Filters</div>

                {draft.length === 0 && (
                    <div className="ldb-filter-empty">No active filters</div>
                )}

                {draft.map(filter => {
                    const col = columns.find(c => c.id === filter.columnId)
                    const operators = col ? getOperators(col.type) : []
                    const showValue = needsValue(filter.operator)

                    return (
                        <div key={filter.id} className="ldb-filter-row">
                            <select
                                className="ldb-filter-select"
                                value={filter.columnId}
                                onChange={e => handleColumnChange(filter, e.target.value)}
                            >
                                {columns.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>

                            <select
                                className="ldb-filter-select"
                                value={filter.operator}
                                onChange={e => updateFilter(filter.id, { operator: e.target.value })}
                            >
                                {operators.map(op => (
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                ))}
                            </select>

                            {showValue && col?.type === 'select' ? (
                                <select
                                    className="ldb-filter-select"
                                    value={String(filter.value ?? '')}
                                    onChange={e => updateFilter(filter.id, { value: e.target.value })}
                                >
                                    <option value="">Any</option>
                                    {col.options?.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            ) : showValue ? (
                                <input
                                    className="ldb-filter-input"
                                    type={col?.type === 'number' ? 'number' : col?.type === 'date' || col?.type === 'datetime' ? 'date' : 'text'}
                                    value={String(filter.value ?? '')}
                                    placeholder="Value..."
                                    onChange={e => updateFilter(filter.id, {
                                        value: col?.type === 'number' ? (e.target.value ? Number(e.target.value) : '') : e.target.value,
                                    })}
                                />
                            ) : null}

                            <button
                                className="ldb-filter-remove"
                                onClick={() => removeFilter(filter.id)}
                                title="Remove filter"
                            >
                                &times;
                            </button>
                        </div>
                    )
                })}

                <div className="ldb-filter-actions">
                    <button className="ldb-filter-add" onClick={addFilter}>
                        + Add filter
                    </button>
                    <div className="ldb-filter-actions-right">
                        {(draft.length > 0 || filters.length > 0) && (
                            <button className="ldb-filter-clear" onClick={handleClear}>Clear</button>
                        )}
                        <button
                            className="ldb-filter-apply"
                            onClick={handleApply}
                            disabled={!isDirty}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body,
    )
}

// Custom filter function for TanStack Table
export function localdbFilterFn(
    row: { getValue: (id: string) => unknown },
    columnId: string,
    filterValue: { operator: string; value: unknown },
) {
    const cellValue = row.getValue(columnId)
    const { operator, value } = filterValue

    switch (operator) {
        case 'contains':
            return String(cellValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
        case 'not_contains':
            return !String(cellValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
        case 'is':
        case 'eq':
            return String(cellValue ?? '') === String(value ?? '')
        case 'is_not':
        case 'neq':
            return String(cellValue ?? '') !== String(value ?? '')
        case 'gt':
            return Number(cellValue) > Number(value)
        case 'lt':
            return Number(cellValue) < Number(value)
        case 'gte':
            return Number(cellValue) >= Number(value)
        case 'lte':
            return Number(cellValue) <= Number(value)
        case 'is_empty':
            return cellValue == null || cellValue === '' || (Array.isArray(cellValue) && cellValue.length === 0)
        case 'is_not_empty':
            return cellValue != null && cellValue !== '' && !(Array.isArray(cellValue) && cellValue.length === 0)
        case 'is_checked':
            return Boolean(cellValue) === true
        case 'is_not_checked':
            return Boolean(cellValue) === false
        case 'before':
            return String(cellValue ?? '') < String(value ?? '')
        case 'after':
            return String(cellValue ?? '') > String(value ?? '')
        default:
            return true
    }
}
