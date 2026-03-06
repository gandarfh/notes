import { useEffect, useRef } from 'react'
import type { ColumnDef, LocalDBRow } from './types'
import { CellRenderer } from './CellRenderer'

// ── Row Detail Modal ────────────────────────────────────────
// Shows all fields of a row in a vertical layout for focused editing.

interface RowDetailModalProps {
    row: LocalDBRow
    columns: ColumnDef[]
    titleColumn?: string
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onClose: () => void
    onDelete: (rowId: string) => void
    onDuplicate: (rowId: string) => void
}

export function RowDetailModal({ row, columns, titleColumn, onCellChange, onClose, onDelete, onDuplicate }: RowDetailModalProps) {
    const modalRef = useRef<HTMLDivElement>(null)

    const data = (() => {
        try { return JSON.parse(row.dataJson || '{}') }
        catch { return {} }
    })()

    // Find title
    const titleCol = titleColumn
        ? columns.find(c => c.id === titleColumn)
        : columns.find(c => c.type === 'text')
    const title = titleCol ? String(data[titleCol.id] ?? '') : 'Untitled'

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [onClose])

    // Focus trap
    useEffect(() => {
        modalRef.current?.focus()
    }, [])

    return (
        <div className="ldb-detail-overlay" onClick={onClose}>
            <div
                className="ldb-detail-modal"
                ref={modalRef}
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="ldb-detail-header">
                    <div className="ldb-detail-title">{title || 'Untitled'}</div>
                    <div className="ldb-detail-header-actions">
                        <button
                            className="ldb-detail-action-btn"
                            onClick={() => onDuplicate(row.id)}
                            title="Duplicate"
                        >
                            Duplicate
                        </button>
                        <button
                            className="ldb-detail-action-btn danger"
                            onClick={() => { onDelete(row.id); onClose() }}
                            title="Delete"
                        >
                            Delete
                        </button>
                        <button className="ldb-detail-close" onClick={onClose}>&times;</button>
                    </div>
                </div>

                {/* Fields */}
                <div className="ldb-detail-body">
                    {columns.map(col => (
                        <div key={col.id} className="ldb-detail-field">
                            <div className="ldb-detail-field-label">{col.name}</div>
                            <div className="ldb-detail-field-value">
                                <CellRenderer
                                    column={col}
                                    value={data[col.id]}
                                    onChange={v => onCellChange(row.id, col.id, v)}
                                    isEditing={false}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="ldb-detail-footer">
                    <span>Created: {new Date(row.createdAt).toLocaleString()}</span>
                    <span>Updated: {new Date(row.updatedAt).toLocaleString()}</span>
                </div>
            </div>
        </div>
    )
}
