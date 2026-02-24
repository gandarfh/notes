import type { ColumnDef, LocalDBRow, ViewConfig } from '../../bridge/wails'

// ── Gallery View ───────────────────────────────────────────
// Responsive card grid showing all fields per row.

interface GalleryViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig?: ViewConfig
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: () => void
    onDeleteRow: (rowId: string) => void
    onDuplicateRow: (rowId: string) => void
    onColumnsChange: (columns: ColumnDef[]) => void
}

export function GalleryView({ columns, rows, viewConfig, onAddRow, onDeleteRow }: GalleryViewProps) {
    // Resolve title column from viewConfig or auto-detect
    const titleCol = (viewConfig?.titleColumn
        ? columns.find(c => c.id === viewConfig.titleColumn)
        : null
    ) || columns.find(c => c.type === 'text')

    const detailCols = columns.filter(c => c.id !== titleCol?.id).slice(0, 5)

    const getRowData = (row: LocalDBRow): Record<string, unknown> => {
        try { return JSON.parse(row.dataJson || '{}') } catch { return {} }
    }

    const formatValue = (col: ColumnDef, val: unknown): string => {
        if (val === undefined || val === null || val === '') return '—'
        if (col.type === 'checkbox') return val ? '✓' : '✗'
        if (col.type === 'rating') return '★'.repeat(Number(val) || 0)
        if (col.type === 'progress') return `${val}%`
        return String(val)
    }

    return (
        <div className="ldb-gallery">
            {rows.map(row => {
                const data = getRowData(row)
                const title = titleCol ? String(data[titleCol.id] ?? 'Untitled') : 'Untitled'

                return (
                    <div key={row.id} className="ldb-gallery-card">
                        <div className="ldb-gallery-card-title">{title}</div>
                        <div className="ldb-gallery-card-fields">
                            {detailCols.map(col => {
                                const val = data[col.id]
                                return (
                                    <div key={col.id} className="ldb-gallery-field">
                                        <span className="ldb-gallery-field-label">{col.name}</span>
                                        <span className="ldb-gallery-field-value">
                                            {col.type === 'select' && val ? (
                                                <span className="ldb-tag" data-value={val}>{String(val)}</span>
                                            ) : (
                                                formatValue(col, val)
                                            )}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="ldb-gallery-card-actions">
                            <button className="ldb-gallery-delete" onClick={() => onDeleteRow(row.id)}>✕</button>
                        </div>
                    </div>
                )
            })}

            <button className="ldb-gallery-add" onClick={onAddRow}>
                <span>+</span>
                <span>Add Card</span>
            </button>
        </div>
    )
}
