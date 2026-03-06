import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DataGrid, type SortColumn, type ColumnWidths, type Column } from 'react-data-grid'
import type { ColumnDef, ColumnType, LocalDBRow, ViewConfig } from './types'
import { ColumnEditor, COLUMN_TYPES, type AnchorRect } from './ColumnEditor'
import { toGridColumns, type GridRow } from './columns'
import { RowDetailModal } from './RowDetailModal'

// ── Inline Column Creator ──────────────────────────────────

interface NewColDraft {
    name: string
    type: ColumnType
    nameEdited: boolean
}

interface InlineColumnCreatorProps {
    draft: NewColDraft
    onDraftChange: (draft: NewColDraft) => void
    onSave: (name: string, type: ColumnType) => void
    onCancel: () => void
}

function InlineColumnCreator({ draft, onDraftChange, onSave, onCancel }: InlineColumnCreatorProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const headerRef = useRef<HTMLDivElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null)

    // Auto-focus and position dropdown
    useEffect(() => {
        inputRef.current?.focus()
        updateDropdownPos()
    }, [])

    const updateDropdownPos = () => {
        const el = headerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        setDropdownPos({ left: rect.left, top: rect.bottom + 2 })
    }

    const currentType = COLUMN_TYPES.find(t => t.value === draft.type)
    const TypeIcon = currentType?.Icon

    const handleSelectType = (type: ColumnType) => {
        const typeInfo = COLUMN_TYPES.find(t => t.value === type)!
        const name = draft.nameEdited && draft.name.trim() ? draft.name.trim() : typeInfo.label
        onSave(name, type)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            const name = draft.nameEdited && draft.name.trim()
                ? draft.name.trim()
                : COLUMN_TYPES.find(t => t.value === draft.type)!.label
            onSave(name, draft.type)
        } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
        }
    }

    return (
        <>
            <div className="ldb-new-col-header" ref={headerRef}>
                {TypeIcon && <TypeIcon size={14} />}
                <input
                    ref={inputRef}
                    className="ldb-new-col-input"
                    placeholder="Column name"
                    value={draft.name}
                    onChange={e => onDraftChange({ ...draft, name: e.target.value, nameEdited: true })}
                    onKeyDown={handleKeyDown}
                />
            </div>
            {dropdownPos && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => {
                        // Click outside: save if name was edited, else cancel
                        if (draft.nameEdited && draft.name.trim()) {
                            onSave(draft.name.trim(), draft.type)
                        } else {
                            onCancel()
                        }
                    }} />
                    <div
                        className="ldb-new-col-dropdown"
                        style={{ left: dropdownPos.left, top: dropdownPos.top }}
                    >
                        <div className="ldb-col-type-list">
                            {COLUMN_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    className={`ldb-col-type-row ${draft.type === t.value ? 'active' : ''}`}
                                    onClick={() => handleSelectType(t.value)}
                                >
                                    <t.Icon size={14} />
                                    <span>{t.label}</span>
                                    {draft.type === t.value && <span className="ldb-col-type-check">✓</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                </>,
                document.body,
            )}
        </>
    )
}

// ── Table View ─────────────────────────────────────────────

interface TableViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig: ViewConfig
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: () => void
    onDeleteRow: (rowId: string) => void
    onDuplicateRow: (rowId: string) => void
    onColumnsChange: (columns: ColumnDef[]) => void
    onSortChange?: (sorting: { id: string; desc: boolean }[]) => void
}

export function TableView({ columns, rows, viewConfig, onCellChange, onAddRow, onDeleteRow, onDuplicateRow, onColumnsChange, onSortChange }: TableViewProps) {
    const [editingCol, setEditingCol] = useState<ColumnDef | null>(null)
    const [editorAnchor, setEditorAnchor] = useState<AnchorRect>({ left: 0, top: 0, width: 0 })
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowId: string } | null>(null)
    const [detailRow, setDetailRow] = useState<LocalDBRow | null>(null)
    const [newColDraft, setNewColDraft] = useState<NewColDraft | null>(null)
    const tableRef = useRef<HTMLDivElement>(null)

    // Row selection
    const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set())

    // Sort state
    const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>(
        (viewConfig.sorting ?? []).map(s => ({ columnKey: s.id, direction: s.desc ? 'DESC' as const : 'ASC' as const }))
    )

    // Convert rows to flat format for react-data-grid
    const gridRows = useMemo<GridRow[]>(() => rows.map(row => {
        try {
            const data = JSON.parse(row.dataJson || '{}')
            return { _id: row.id, _raw: row, ...data }
        } catch {
            return { _id: row.id, _raw: row }
        }
    }), [rows])

    // Custom select column with project-styled checkboxes
    const selectColumn = useMemo<Column<GridRow>>(() => ({
        key: '_select',
        name: '',
        width: 36,
        minWidth: 36,
        maxWidth: 36,
        resizable: false,
        sortable: false,
        draggable: false,
        headerCellClass: 'ldb-select-col-header',
        cellClass: 'ldb-select-col-cell',
        renderHeaderCell: () => {
            const allSelected = gridRows.length > 0 && selectedRows.size === gridRows.length
            return (
                <label className="ldb-cell-checkbox" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={allSelected} onChange={() => {
                        if (allSelected) setSelectedRows(new Set())
                        else setSelectedRows(new Set(gridRows.map(r => r._id)))
                    }} />
                    <span className="ldb-checkbox-mark" />
                </label>
            )
        },
        renderCell: ({ row }) => {
            const isSelected = selectedRows.has(row._id)
            return (
                <label className="ldb-cell-checkbox" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => {
                        const next = new Set(selectedRows)
                        if (isSelected) next.delete(row._id)
                        else next.add(row._id)
                        setSelectedRows(next)
                    }} />
                    <span className="ldb-checkbox-mark" />
                </label>
            )
        },
    }), [gridRows, selectedRows])

    // Track wrapper width for spacer column
    const [wrapperWidth, setWrapperWidth] = useState(0)
    useEffect(() => {
        const el = tableRef.current
        if (!el) return
        const ro = new ResizeObserver(([entry]) => setWrapperWidth(entry.contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // Convert columns for react-data-grid
    const gridColumns = useMemo(() => {
        const newColWidth = newColDraft ? 150 : 0
        const usedWidth = 36 + columns.reduce((sum, c) => sum + (c.width || 150), 0) + newColWidth + 40
        const spacerWidth = Math.max(0, wrapperWidth - usedWidth)
        return [
            selectColumn,
            ...toGridColumns(columns, onCellChange, (col, anchor) => {
                setEditorAnchor(anchor)
                setEditingCol(col)
            }),
            // Inline new column (when drafting)
            ...(newColDraft ? [{
                key: '_new_col',
                name: '',
                width: 150,
                minWidth: 150,
                resizable: false,
                sortable: false,
                draggable: false,
                headerCellClass: 'ldb-add-col-header',
                renderHeaderCell: () => (
                    <InlineColumnCreator
                        draft={newColDraft}
                        onDraftChange={setNewColDraft}
                        onSave={handleInlineColSave}
                        onCancel={handleInlineColCancel}
                    />
                ),
                renderCell: () => null,
            }] : []),
            // Add column button — right after the last column
            {
                key: '_add_col',
                name: '',
                width: 40,
                minWidth: 40,
                maxWidth: 40,
                resizable: false,
                sortable: false,
                draggable: false,
                headerCellClass: 'ldb-add-col-header',
                cellClass: 'ldb-add-col-cell',
                renderHeaderCell: () => (
                    <button className="ldb-add-col-btn" onClick={handleAddCol} title="Add column">
                        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button>
                ),
                renderCell: () => null,
            },
            // Spacer to fill remaining width (keeps header bar full-width)
            ...(spacerWidth > 0 ? [{
                key: '_spacer',
                name: '',
                width: spacerWidth,
                minWidth: 0,
                resizable: false,
                sortable: false,
                draggable: false,
                headerCellClass: 'ldb-spacer-cell',
                cellClass: 'ldb-spacer-cell',
                renderHeaderCell: () => null,
                renderCell: () => null,
            }] : []),
        ]
    }, [selectColumn, columns, onCellChange, wrapperWidth, newColDraft])

    // Refocus table wrapper so block keeps focus after popup close
    const refocusTable = () => {
        setTimeout(() => tableRef.current?.focus(), 0)
    }

    // Sort change — sync to viewConfig
    const handleSortColumnsChange = useCallback((newSort: readonly SortColumn[]) => {
        setSortColumns(newSort)
        onSortChange?.(newSort.map(s => ({ id: s.columnKey, desc: s.direction === 'DESC' })))
    }, [onSortChange])

    // Column reorder
    const handleColumnsReorder = useCallback((sourceKey: string, targetKey: string) => {
        const sourceIdx = columns.findIndex(c => c.id === sourceKey)
        const targetIdx = columns.findIndex(c => c.id === targetKey)
        if (sourceIdx < 0 || targetIdx < 0) return
        const newCols = [...columns]
        const [moved] = newCols.splice(sourceIdx, 1)
        newCols.splice(targetIdx, 0, moved)
        onColumnsChange(newCols)
    }, [columns, onColumnsChange])

    // Column resize
    const handleColumnWidthsChange = useCallback((newWidths: ColumnWidths) => {
        const updated = columns.map(c => {
            const cw = newWidths.get(c.id)
            return cw != null ? { ...c, width: cw.width } : c
        })
        onColumnsChange(updated)
    }, [columns, onColumnsChange])

    // Inline column creation
    const handleAddCol = () => {
        if (newColDraft) return // already drafting
        setNewColDraft({ name: '', type: 'text', nameEdited: false })
    }

    const handleInlineColSave = (name: string, type: ColumnType) => {
        onColumnsChange([...columns, {
            id: crypto.randomUUID(),
            name,
            type,
            width: 150,
        }])
        setNewColDraft(null)
        refocusTable()
    }

    const handleInlineColCancel = () => {
        setNewColDraft(null)
        refocusTable()
    }

    // Column editor handlers (for editing existing columns)
    const handleColSave = (col: ColumnDef) => {
        if (editingCol) {
            onColumnsChange(columns.map(c => c.id === editingCol.id ? col : c))
        }
        setEditingCol(null)
        refocusTable()
    }

    const handleColDelete = () => {
        if (editingCol) {
            onColumnsChange(columns.filter(c => c.id !== editingCol.id))
            setEditingCol(null)
            refocusTable()
        }
    }

    const handleInsertLeft = () => {
        if (!editingCol) return
        const idx = columns.findIndex(c => c.id === editingCol.id)
        if (idx < 0) return
        const newCol: ColumnDef = { id: crypto.randomUUID(), name: 'Column', type: 'text', width: 150 }
        const newCols = [...columns]
        newCols.splice(idx, 0, newCol)
        onColumnsChange(newCols)
        setEditingCol(null)
        refocusTable()
    }

    const handleInsertRight = () => {
        if (!editingCol) return
        const idx = columns.findIndex(c => c.id === editingCol.id)
        if (idx < 0) return
        const newCol: ColumnDef = { id: crypto.randomUUID(), name: 'Column', type: 'text', width: 150 }
        const newCols = [...columns]
        newCols.splice(idx + 1, 0, newCol)
        onColumnsChange(newCols)
        setEditingCol(null)
        refocusTable()
    }

    // Context menu
    const handleContextMenu = useCallback((args: { row: GridRow }, event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        setContextMenu({ x: event.clientX, y: event.clientY, rowId: args.row._id })
    }, [])

    // Bulk actions
    const selectedCount = selectedRows.size

    const handleBulkDelete = useCallback(() => {
        selectedRows.forEach(id => onDeleteRow(id))
        setSelectedRows(new Set())
    }, [selectedRows, onDeleteRow])

    const handleBulkDuplicate = useCallback(() => {
        selectedRows.forEach(id => onDuplicateRow(id))
        setSelectedRows(new Set())
    }, [selectedRows, onDuplicateRow])

    // Calculate grid height based on content (header + rows + border)
    const ROW_H = 36
    const gridContentHeight = ROW_H + gridRows.length * ROW_H + 2

    return (
        <div className="ldb-table-wrapper" ref={tableRef}>
            <DataGrid
                className="rdg-dark ldb-grid"
                style={{ blockSize: gridContentHeight }}
                columns={gridColumns}
                rows={gridRows}
                rowKeyGetter={(row: GridRow) => row._id}
                selectedRows={selectedRows}
                onSelectedRowsChange={setSelectedRows}
                sortColumns={sortColumns}
                onSortColumnsChange={handleSortColumnsChange}
                onColumnWidthsChange={handleColumnWidthsChange}
                onColumnsReorder={handleColumnsReorder}
                onCellContextMenu={handleContextMenu}
                enableVirtualization
                rowHeight={ROW_H}
                headerRowHeight={ROW_H}
                defaultColumnOptions={{ resizable: true, sortable: true }}
            />

            {/* Add Row */}
            <div className="ldb-table-add-row">
                <button className="ldb-add-row-btn" onClick={onAddRow}>
                    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    <span>New Row</span>
                </button>
            </div>

            {/* Column Editor Popover (edit mode only) */}
            {editingCol && (
                <ColumnEditor
                    column={editingCol}
                    anchorRect={editorAnchor}
                    onSave={handleColSave}
                    onDelete={handleColDelete}
                    onClose={() => { setEditingCol(null); refocusTable() }}
                    onInsertLeft={handleInsertLeft}
                    onInsertRight={handleInsertRight}
                />
            )}

            {/* Bulk Action Bar */}
            {selectedCount > 0 && (
                <div className="ldb-bulk-bar">
                    <span className="ldb-bulk-count">{selectedCount} row{selectedCount > 1 ? 's' : ''} selected</span>
                    <button className="ldb-bulk-btn" onClick={handleBulkDuplicate}>Duplicate</button>
                    <button className="ldb-bulk-btn danger" onClick={handleBulkDelete}>Delete</button>
                    <button className="ldb-bulk-btn" onClick={() => setSelectedRows(new Set())}>Deselect</button>
                </div>
            )}

            {/* Row Context Menu */}
            {contextMenu && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => { setContextMenu(null); refocusTable() }} />
                    <div className="ldb-context-menu" style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}>
                        <button onClick={() => {
                            const row = rows.find(r => r.id === contextMenu.rowId)
                            if (row) setDetailRow(row)
                            setContextMenu(null)
                        }}>
                            Open
                        </button>
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

            {/* Row Detail Modal */}
            {detailRow && (
                <RowDetailModal
                    row={detailRow}
                    columns={columns}
                    titleColumn={viewConfig.titleColumn}
                    onCellChange={onCellChange}
                    onClose={() => { setDetailRow(null); refocusTable() }}
                    onDelete={onDeleteRow}
                    onDuplicate={onDuplicateRow}
                />
            )}
        </div>
    )
}
