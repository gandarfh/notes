import { useState } from 'react'
import type { ColumnDef, LocalDBRow, ViewConfig } from './types'
import { CellRenderer } from './CellRenderer'

// ── List View ──────────────────────────────────────────────
// Compact checklist-style view with expandable rows.

interface ListViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig?: ViewConfig
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: () => void
    onDeleteRow: (rowId: string) => void
    onDuplicateRow: (rowId: string) => void
    onColumnsChange: (columns: ColumnDef[]) => void
}

export function ListView({ columns, rows, viewConfig, onCellChange, onAddRow, onDeleteRow }: ListViewProps) {
    const [expandedRow, setExpandedRow] = useState<string | null>(null)

    // Resolve columns from viewConfig or auto-detect
    const checkboxCol = (viewConfig?.checkboxColumn
        ? columns.find(c => c.id === viewConfig.checkboxColumn)
        : null
    ) || columns.find(c => c.type === 'checkbox')

    const titleCol = (viewConfig?.titleColumn
        ? columns.find(c => c.id === viewConfig.titleColumn)
        : null
    ) || columns.find(c => c.type === 'text')

    const detailCols = columns.filter(c => c.id !== checkboxCol?.id && c.id !== titleCol?.id)

    const getRowData = (row: LocalDBRow): Record<string, unknown> => {
        try { return JSON.parse(row.dataJson || '{}') } catch { return {} }
    }

    return (
        <div className="ldb-list">
            {rows.map(row => {
                const data = getRowData(row)
                const isExpanded = expandedRow === row.id
                const title = titleCol ? String(data[titleCol.id] ?? '') : ''
                const isChecked = checkboxCol ? Boolean(data[checkboxCol.id]) : false

                return (
                    <div key={row.id} className={`ldb-list-item ${isChecked ? 'checked' : ''} ${isExpanded ? 'expanded' : ''}`}>
                        <div className="ldb-list-item-main" onClick={() => setExpandedRow(isExpanded ? null : row.id)}>
                            {checkboxCol && (
                                <label className="ldb-list-checkbox" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={e => onCellChange(row.id, checkboxCol.id, e.target.checked)}
                                    />
                                    <span className="ldb-checkbox-mark" />
                                </label>
                            )}
                            <span className={`ldb-list-title ${isChecked ? 'done' : ''}`}>
                                {title || <span className="ldb-cell-placeholder">Untitled</span>}
                            </span>
                            <span className="ldb-list-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                        </div>

                        {isExpanded && (
                            <div className="ldb-list-details">
                                {detailCols.map(col => (
                                    <div key={col.id} className="ldb-list-field">
                                        <label className="ldb-list-field-label">{col.name}</label>
                                        <div className="ldb-list-field-value">
                                            <CellRenderer
                                                column={col}
                                                value={data[col.id]}
                                                onChange={v => onCellChange(row.id, col.id, v)}
                                                isEditing={false}
                                            />
                                        </div>
                                    </div>
                                ))}
                                <div className="ldb-list-actions">
                                    <button className="ldb-list-action-btn danger" onClick={() => onDeleteRow(row.id)}>Delete</button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}

            <button className="ldb-list-add" onClick={onAddRow}>
                + Add Item
            </button>
        </div>
    )
}
