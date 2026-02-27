import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnDef, LocalDBRow, ViewConfig } from './types'

// ── Kanban View ────────────────────────────────────────────
// Mouse-event based drag-and-drop (no HTML5 DnD API).

interface KanbanViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig?: ViewConfig
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: () => void
    onDeleteRow: (rowId: string) => void
    onDuplicateRow: (rowId: string) => void
    onColumnsChange: (columns: ColumnDef[]) => void
    onReorderRows?: (rowIds: string[]) => void
}

interface DragState {
    rowId: string
    sourceGroup: string
    title: string
    offsetX: number
    offsetY: number
    cardWidth: number
    cursorX: number
    cursorY: number
}

export function KanbanView({ columns, rows, viewConfig, onCellChange, onAddRow, onReorderRows }: KanbanViewProps) {
    const [drag, setDrag] = useState<DragState | null>(null)
    const [hoverGroup, setHoverGroup] = useState<string | null>(null)
    const [hoverIndex, setHoverIndex] = useState<number>(-1)
    const dragRef = useRef<DragState | null>(null)
    const colRefs = useRef<Map<string, HTMLDivElement>>(new Map())

    // Resolve columns from viewConfig or auto-detect
    const groupCol = (viewConfig?.groupByColumn
        ? columns.find(c => c.id === viewConfig.groupByColumn)
        : null
    ) || columns.find(c => c.type === 'select' || c.type === 'multi-select')

    const titleCol = (viewConfig?.titleColumn
        ? columns.find(c => c.id === viewConfig.titleColumn)
        : null
    ) || columns.find(c => c.type === 'text')

    const metaCols = columns.filter(c => c.id !== groupCol?.id && c.id !== titleCol?.id).slice(0, 3)

    if (!groupCol) {
        return (
            <div className="ldb-kanban-empty">
                <span>Add a <strong>Select</strong> column to use Kanban view</span>
            </div>
        )
    }

    const options = groupCol.options || []
    const allGroups = [...options, '__uncategorized']

    const getRowData = (row: LocalDBRow): Record<string, unknown> => {
        try { return JSON.parse(row.dataJson || '{}') } catch { return {} }
    }

    // Group rows
    const grouped: Record<string, LocalDBRow[]> = {}
    for (const g of allGroups) grouped[g] = []
    for (const row of rows) {
        const data = getRowData(row)
        const val = String(data[groupCol.id] ?? '')
        if (val && options.includes(val)) {
            grouped[val].push(row)
        } else {
            grouped['__uncategorized'].push(row)
        }
    }

    const getTitle = (data: Record<string, unknown>): string => {
        if (titleCol) return String(data[titleCol.id] ?? 'Untitled')
        for (const col of columns) {
            if (col.type === 'text' && data[col.id]) return String(data[col.id])
        }
        return 'Untitled'
    }

    // ── Mouse-based drag ──

    const handleMouseDown = useCallback((e: React.MouseEvent, rowId: string, sourceGroup: string, title: string) => {
        // Only left click
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()

        const card = e.currentTarget as HTMLElement
        const rect = card.getBoundingClientRect()
        const state: DragState = {
            rowId,
            sourceGroup,
            title,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            cardWidth: rect.width,
            cursorX: e.clientX,
            cursorY: e.clientY,
        }
        dragRef.current = state
        setDrag(state)
    }, [])

    // Track mouse movement + determine hover column/index
    useEffect(() => {
        if (!drag) return

        const handleMove = (e: MouseEvent) => {
            if (!dragRef.current) return
            const updated = { ...dragRef.current, cursorX: e.clientX, cursorY: e.clientY }
            dragRef.current = updated
            setDrag(updated)

            // Determine which column we're over
            let foundGroup: string | null = null
            let foundIndex = -1

            for (const [group, colEl] of colRefs.current.entries()) {
                const colRect = colEl.getBoundingClientRect()
                if (e.clientX >= colRect.left && e.clientX <= colRect.right &&
                    e.clientY >= colRect.top && e.clientY <= colRect.bottom) {
                    foundGroup = group

                    // Determine insertion index
                    const cards = Array.from(colEl.querySelectorAll('.ldb-kanban-card:not(.drag-source)'))
                    foundIndex = cards.length
                    for (let i = 0; i < cards.length; i++) {
                        const cardRect = cards[i].getBoundingClientRect()
                        const midY = cardRect.top + cardRect.height / 2
                        if (e.clientY < midY) {
                            foundIndex = i
                            break
                        }
                    }
                    break
                }
            }

            setHoverGroup(foundGroup)
            setHoverIndex(foundIndex)
        }

        const handleUp = () => {
            if (!dragRef.current) return
            const { rowId, sourceGroup } = dragRef.current

            // Execute the drop
            if (hoverGroup !== null) {
                // Change group if different column
                if (hoverGroup !== sourceGroup) {
                    const newValue = hoverGroup === '__uncategorized' ? '' : hoverGroup
                    onCellChange(rowId, groupCol!.id, newValue)
                }

                // Reorder
                if (onReorderRows) {
                    const targetGroupRows = grouped[hoverGroup] || []
                    const allOrderedIds = rows.map(r => r.id)
                    const withoutDragged = allOrderedIds.filter(id => id !== rowId)
                    const targetGroupIds = targetGroupRows.filter(r => r.id !== rowId).map(r => r.id)
                    const insertIdx = Math.min(hoverIndex, targetGroupIds.length)
                    const insertAfter = insertIdx > 0 ? targetGroupIds[insertIdx - 1] : null

                    let globalInsertIdx: number
                    if (insertAfter) {
                        globalInsertIdx = withoutDragged.indexOf(insertAfter) + 1
                    } else {
                        const firstInGroup = targetGroupIds[0]
                        globalInsertIdx = firstInGroup
                            ? withoutDragged.indexOf(firstInGroup)
                            : withoutDragged.length
                    }

                    withoutDragged.splice(globalInsertIdx, 0, rowId)
                    onReorderRows(withoutDragged)
                }
            }

            // Clean up
            dragRef.current = null
            setDrag(null)
            setHoverGroup(null)
            setHoverIndex(-1)
        }

        document.addEventListener('mousemove', handleMove)
        document.addEventListener('mouseup', handleUp)
        return () => {
            document.removeEventListener('mousemove', handleMove)
            document.removeEventListener('mouseup', handleUp)
        }
    }, [drag, hoverGroup, hoverIndex, rows, grouped, onCellChange, onReorderRows, groupCol])

    return (
        <>
            <div className="ldb-kanban">
                {allGroups.map(group => {
                    const groupRows = grouped[group] || []
                    const label = group === '__uncategorized' ? 'Uncategorized' : group
                    const isHovering = hoverGroup === group && drag != null

                    return (
                        <div
                            key={group}
                            className={`ldb-kanban-col ${isHovering ? 'drop-hover' : ''} ${drag ? 'drag-active' : ''}`}
                            ref={el => {
                                if (el) colRefs.current.set(group, el)
                                else colRefs.current.delete(group)
                            }}
                        >
                            <div className="ldb-kanban-col-header">
                                <span className="ldb-tag" data-value={group === '__uncategorized' ? '' : group}>{label}</span>
                                <span className="ldb-kanban-count">{groupRows.length}</span>
                            </div>

                            <div className="ldb-kanban-cards">
                                {groupRows.map((row, i) => {
                                    const data = getRowData(row)
                                    const isDragSource = drag?.rowId === row.id
                                    // Visual index: skip dragged card when counting
                                    const visualIdx = drag?.sourceGroup === group
                                        ? groupRows.slice(0, i).filter(r => r.id !== drag?.rowId).length
                                        : i
                                    const showIndicatorBefore = isHovering && !isDragSource && hoverIndex === visualIdx

                                    return (
                                        <div key={row.id}>
                                            {showIndicatorBefore && <div className="ldb-kanban-insert-line" />}
                                            <div
                                                className={`ldb-kanban-card ${isDragSource ? 'drag-source' : ''}`}
                                                onMouseDown={e => handleMouseDown(e, row.id, group, getTitle(data))}
                                            >
                                                <div className="ldb-kanban-card-title">{getTitle(data)}</div>
                                                {metaCols.map(col => {
                                                    const val = data[col.id]
                                                    if (val === undefined || val === null || val === '') return null
                                                    return (
                                                        <div key={col.id} className="ldb-kanban-card-meta">
                                                            <span className="ldb-kanban-meta-label">{col.name}</span>
                                                            <span className="ldb-kanban-meta-value">
                                                                {col.type === 'checkbox' ? (val ? '✓' : '✗') :
                                                                    col.type === 'select' ? <span className="ldb-tag" data-value={val}>{String(val)}</span> :
                                                                        String(val)}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                                {/* Insert line at end */}
                                {isHovering && hoverIndex >= groupRows.filter(r => r.id !== drag?.rowId).length && (
                                    <div className="ldb-kanban-insert-line" />
                                )}
                            </div>

                            <button className="ldb-kanban-add" onClick={onAddRow}>
                                + Add
                            </button>
                        </div>
                    )
                })}
            </div>

            {/* Floating drag ghost */}
            {drag && createPortal(
                <div
                    className="ldb-kanban-drag-ghost"
                    style={{
                        position: 'fixed',
                        left: drag.cursorX - drag.offsetX,
                        top: drag.cursorY - drag.offsetY,
                        width: drag.cardWidth,
                        pointerEvents: 'none',
                        zIndex: 10000,
                    }}
                >
                    <div className="ldb-kanban-card-title">{drag.title}</div>
                </div>,
                document.body,
            )}
        </>
    )
}
