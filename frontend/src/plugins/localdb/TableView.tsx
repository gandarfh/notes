import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnDef, LocalDBRow } from './types'
import { CellRenderer } from './CellRenderer'
import { ColumnEditor, type AnchorRect } from './ColumnEditor'

// ── Table View ─────────────────────────────────────────────
// The default spreadsheet-like view for a local database.

interface TableViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: () => void
    onDeleteRow: (rowId: string) => void
    onDuplicateRow: (rowId: string) => void
    onColumnsChange: (columns: ColumnDef[]) => void
}

export function TableView({ columns, rows, onCellChange, onAddRow, onDeleteRow, onDuplicateRow, onColumnsChange }: TableViewProps) {
    const [editingCol, setEditingCol] = useState<ColumnDef | null>(null)
    const [addingCol, setAddingCol] = useState(false)
    const [editorAnchor, setEditorAnchor] = useState<AnchorRect>({ left: 0, top: 0, width: 0 })
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowId: string } | null>(null)
    const [resizing, setResizing] = useState<{ colId: string; startX: number; startWidth: number } | null>(null)
    const tableRef = useRef<HTMLDivElement>(null)

    // Refocus table wrapper so block keeps focus after popup close
    const refocusTable = () => {
        setTimeout(() => tableRef.current?.focus(), 0)
    }

    // Parse row data
    const getRowData = useCallback((row: LocalDBRow): Record<string, unknown> => {
        try {
            return JSON.parse(row.dataJson || '{}')
        } catch {
            return {}
        }
    }, [])

    // Compute anchor rect in viewport coordinates (for portal positioning)
    const getAnchorRect = (el: HTMLElement): AnchorRect => {
        const elRect = el.getBoundingClientRect()
        return {
            left: elRect.left,
            top: elRect.bottom + 4,
            width: elRect.width,
        }
    }

    // Open editor for existing column (click on header label)
    const handleEditCol = (col: ColumnDef, e: React.MouseEvent) => {
        const el = (e.currentTarget as HTMLElement).closest('.ldb-table-th') as HTMLElement
        if (el) setEditorAnchor(getAnchorRect(el))
        setEditingCol(col)
        setAddingCol(false)
    }

    // Open editor for new column (click on + button)
    const handleAddCol = (e: React.MouseEvent) => {
        const el = (e.currentTarget as HTMLElement).closest('.ldb-table-th') as HTMLElement
        if (el) setEditorAnchor(getAnchorRect(el))
        setAddingCol(true)
        setEditingCol(null)
    }

    // Handle column resize
    useEffect(() => {
        if (!resizing) return
        const onMove = (e: MouseEvent) => {
            const diff = e.clientX - resizing.startX
            const newWidth = Math.max(60, resizing.startWidth + diff)
            onColumnsChange(columns.map(c => c.id === resizing.colId ? { ...c, width: newWidth } : c))
        }
        const onUp = () => setResizing(null)
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        return () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
        }
    }, [resizing, columns, onColumnsChange])



    const handleColSave = (col: ColumnDef) => {
        if (editingCol) {
            onColumnsChange(columns.map(c => c.id === editingCol.id ? col : c))
        } else {
            onColumnsChange([...columns, col])
        }
        setEditingCol(null)
        setAddingCol(false)
        refocusTable()
    }

    const handleColDelete = () => {
        if (editingCol) {
            onColumnsChange(columns.filter(c => c.id !== editingCol.id))
            setEditingCol(null)
            refocusTable()
        }
    }

    const handleRowContextMenu = (e: React.MouseEvent, rowId: string) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY, rowId })
    }

    return (
        <div className="ldb-table-wrapper" ref={tableRef} tabIndex={-1}>
            <div className="ldb-table">
                {/* Header */}
                <div className="ldb-table-header">
                    {columns.map(col => (
                        <div
                            key={col.id}
                            className="ldb-table-th"
                            style={{ width: col.width }}
                        >
                            <span
                                className="ldb-th-label"
                                onClick={e => handleEditCol(col, e)}
                            >
                                {col.name}
                            </span>
                            <div
                                className="ldb-col-resize"
                                onMouseDown={e => {
                                    e.preventDefault()
                                    setResizing({ colId: col.id, startX: e.clientX, startWidth: col.width })
                                }}
                            />
                        </div>
                    ))}
                    <div className="ldb-table-th ldb-add-col">
                        <button className="ldb-add-col-btn" onClick={handleAddCol} title="Add column">
                            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        </button>
                    </div>
                </div>

                {/* Rows */}
                {rows.map(row => {
                    const data = getRowData(row)
                    return (
                        <div
                            key={row.id}
                            className="ldb-table-row"
                            onContextMenu={e => handleRowContextMenu(e, row.id)}
                        >
                            {columns.map(col => (
                                <div key={col.id} className="ldb-table-cell" style={{ width: col.width }}>
                                    <CellRenderer
                                        column={col}
                                        value={data[col.id]}
                                        onChange={v => onCellChange(row.id, col.id, v)}
                                        isEditing={false}
                                    />
                                </div>
                            ))}
                            <div className="ldb-table-cell ldb-row-actions">
                                <button
                                    className="ldb-row-menu-btn"
                                    onClick={e => handleRowContextMenu(e, row.id)}
                                >
                                    ⋮
                                </button>
                            </div>
                        </div>
                    )
                })}

                {/* Add Row */}
                <div className="ldb-table-add-row">
                    <button className="ldb-add-row-btn" onClick={onAddRow}>
                        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                        <span>New Row</span>
                    </button>
                </div>
            </div>

            {/* Column Editor Popover — anchored below the trigger */}
            {(editingCol || addingCol) && (
                <ColumnEditor
                    column={editingCol ?? undefined}
                    anchorRect={editorAnchor}
                    onSave={handleColSave}
                    onDelete={editingCol ? handleColDelete : undefined}
                    onClose={() => { setEditingCol(null); setAddingCol(false); refocusTable() }}
                />
            )}

            {/* Row Context Menu — rendered via portal */}
            {contextMenu && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => { setContextMenu(null); refocusTable() }} />
                    <div className="ldb-context-menu" style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}>
                        <button onClick={() => { onDuplicateRow(contextMenu.rowId); setContextMenu(null); refocusTable() }}>
                            Duplicate Row
                        </button>
                        <button className="danger" onClick={() => { onDeleteRow(contextMenu.rowId); setContextMenu(null); refocusTable() }}>
                            Delete Row
                        </button>
                    </div>
                </>,
                document.body,
            )}
        </div>
    )
}
