import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnDef, LocalDBRow, ViewConfig } from './types'
import { RowDetailModal } from './RowDetailModal'
import { tagColorStyle, TAG_COLORS } from './ColumnEditor'

// ── Kanban View ────────────────────────────────────────────
// Mouse-event based drag-and-drop (no HTML5 DnD API).

interface KanbanViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig?: ViewConfig
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: (initialData?: Record<string, unknown>) => void
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

/** Get bg/fg colors for a group option */
function getGroupColors(optionColors: Record<string, string> | undefined, group: string) {
    if (!optionColors || group === '__uncategorized') return null
    const colorId = optionColors[group]
    if (!colorId || colorId === 'default') return null
    const c = TAG_COLORS.find(t => t.id === colorId)
    if (!c) return null
    return { bg: c.bg, fg: c.fg }
}

export function KanbanView({ columns, rows, viewConfig, onCellChange, onAddRow, onDeleteRow, onDuplicateRow, onReorderRows }: KanbanViewProps) {
    const [drag, setDrag] = useState<DragState | null>(null)
    const [hoverGroup, setHoverGroup] = useState<string | null>(null)
    const [hoverIndex, setHoverIndex] = useState<number>(-1)
    const [detailRow, setDetailRow] = useState<LocalDBRow | null>(null)
    const dragRef = useRef<DragState | null>(null)
    const colRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const hoverGroupRef = useRef<string | null>(null)
    const hoverIndexRef = useRef<number>(-1)

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
    const optionColors = groupCol.optionColors
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

    // Keep refs in sync with state for use in imperative handlers
    useEffect(() => { hoverGroupRef.current = hoverGroup }, [hoverGroup])
    useEffect(() => { hoverIndexRef.current = hoverIndex }, [hoverIndex])

    // ── Mouse-based drag with click detection ──
    // Listeners are registered imperatively on mousedown and cleaned up on mouseup.
    // This avoids stale-closure issues with useEffect dependencies.

    const handleMouseDown = useCallback((e: React.MouseEvent, rowId: string, sourceGroup: string, title: string) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()

        let firstDocX: number | null = null
        let firstDocY: number | null = null
        let dragging = false

        const card = e.currentTarget as HTMLElement
        const state: DragState = {
            rowId,
            sourceGroup,
            title,
            // Placeholder offsets — recalculated on drag start from document event
            offsetX: 0,
            offsetY: 0,
            cardWidth: card.getBoundingClientRect().width,
            cursorX: e.clientX,
            cursorY: e.clientY,
        }
        dragRef.current = state

        const findHover = (cx: number, cy: number) => {
            let foundGroup: string | null = null
            let foundIndex = -1

            for (const [group, colEl] of colRefs.current.entries()) {
                const colRect = colEl.getBoundingClientRect()
                if (cx >= colRect.left && cx <= colRect.right &&
                    cy >= colRect.top && cy <= colRect.bottom) {
                    foundGroup = group
                    const cards = Array.from(colEl.querySelectorAll('.ldb-kanban-card:not(.drag-source)'))
                    foundIndex = cards.length
                    for (let i = 0; i < cards.length; i++) {
                        const cardRect = cards[i].getBoundingClientRect()
                        if (cy < cardRect.top + cardRect.height / 2) {
                            foundIndex = i
                            break
                        }
                    }
                    break
                }
            }
            setHoverGroup(foundGroup)
            setHoverIndex(foundIndex)
            hoverGroupRef.current = foundGroup
            hoverIndexRef.current = foundIndex
        }

        const handleMove = (ev: MouseEvent) => {
            // Use first document mousemove as reference (always viewport space),
            // avoiding coordinate mismatch from CSS zoom on the React mousedown event.
            if (firstDocX === null) { firstDocX = ev.clientX; firstDocY = ev.clientY }
            if (!dragging) {
                const dx = ev.clientX - firstDocX
                const dy = ev.clientY - firstDocY!
                if (Math.sqrt(dx * dx + dy * dy) < 5) return
                dragging = true
                // Compute offset from document mousemove (viewport space) and
                // getBoundingClientRect (also viewport space) — avoids CSS zoom mismatch
                // from the React mousedown event coordinates.
                const rect = card.getBoundingClientRect()
                state.offsetX = ev.clientX - rect.left
                state.offsetY = ev.clientY - rect.top
                state.cardWidth = rect.width
                state.cursorX = ev.clientX
                state.cursorY = ev.clientY
                dragRef.current = { ...state }
                setDrag({ ...state })
            }

            const updated = { ...dragRef.current!, cursorX: ev.clientX, cursorY: ev.clientY }
            dragRef.current = updated
            setDrag(updated)
            findHover(ev.clientX, ev.clientY)
        }

        const handleUp = () => {
            document.removeEventListener('mousemove', handleMove)
            document.removeEventListener('mouseup', handleUp)

            if (dragging && dragRef.current) {
                const { rowId: dragRowId, sourceGroup: src } = dragRef.current
                const hg = hoverGroupRef.current
                const hi = hoverIndexRef.current

                if (hg !== null) {
                    if (hg !== src) {
                        onCellChange(dragRowId, groupCol!.id, hg === '__uncategorized' ? '' : hg)
                    }
                    if (onReorderRows) {
                        const targetGroupRows = grouped[hg] || []
                        const allOrderedIds = rows.map(r => r.id)
                        const withoutDragged = allOrderedIds.filter(id => id !== dragRowId)
                        const targetGroupIds = targetGroupRows.filter(r => r.id !== dragRowId).map(r => r.id)
                        const insertIdx = Math.min(hi, targetGroupIds.length)
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
                        withoutDragged.splice(globalInsertIdx, 0, dragRowId)
                        onReorderRows(withoutDragged)
                    }
                }
            } else if (!dragging) {
                // Click — open detail modal
                const row = rows.find(r => r.id === rowId)
                if (row) setDetailRow(row)
            }

            dragRef.current = null
            setDrag(null)
            setHoverGroup(null)
            setHoverIndex(-1)
            hoverGroupRef.current = null
            hoverIndexRef.current = -1
        }

        document.addEventListener('mousemove', handleMove)
        document.addEventListener('mouseup', handleUp)
    }, [rows, grouped, onCellChange, onReorderRows, groupCol])

    // Keep detailRow in sync with rows (e.g. after cell edits)
    const currentDetailRow = detailRow ? rows.find(r => r.id === detailRow.id) || null : null

    return (
        <>
            <div className="ldb-kanban">
                {allGroups.map(group => {
                    const groupRows = grouped[group] || []
                    const label = group === '__uncategorized' ? 'Uncategorized' : group
                    const isHovering = hoverGroup === group && drag != null

                    // Hide empty uncategorized when not dragging
                    if (group === '__uncategorized' && groupRows.length === 0 && !drag) return null

                    const colors = getGroupColors(optionColors, group)
                    const colStyle: React.CSSProperties = colors
                        ? { background: colors.bg, '--col-accent': colors.fg } as React.CSSProperties
                        : {}

                    return (
                        <div
                            key={group}
                            className={`ldb-kanban-col ${isHovering ? 'drop-hover' : ''} ${drag ? 'drag-active' : ''}`}
                            style={colStyle}
                            ref={el => {
                                if (el) colRefs.current.set(group, el)
                                else colRefs.current.delete(group)
                            }}
                        >
                            <div className="ldb-kanban-col-header">
                                <span className="ldb-tag" style={tagColorStyle(optionColors?.[group])}>{label}</span>
                                <span className="ldb-kanban-count">{groupRows.length}</span>
                            </div>

                            <div className="ldb-kanban-cards">
                                {groupRows.map((row, i) => {
                                    const data = getRowData(row)
                                    const isDragSource = drag?.rowId === row.id
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
                                                    const isSelect = col.type === 'select'
                                                    return (
                                                        <div key={col.id} className="ldb-kanban-card-meta">
                                                            <span className="ldb-kanban-meta-label">{col.name}</span>
                                                            <span className="ldb-kanban-meta-value">
                                                                {col.type === 'checkbox' ? (val ? '✓' : '✗') :
                                                                    isSelect ? <span className="ldb-tag" style={tagColorStyle(col.optionColors?.[String(val)])}>{String(val)}</span> :
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

                            <button
                                className="ldb-kanban-add"
                                onClick={() => onAddRow({ [groupCol.id]: group === '__uncategorized' ? '' : group })}
                            >
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

            {/* Row detail modal */}
            {currentDetailRow && (
                <RowDetailModal
                    row={currentDetailRow}
                    columns={columns}
                    titleColumn={titleCol?.id}
                    onCellChange={onCellChange}
                    onClose={() => setDetailRow(null)}
                    onDelete={onDeleteRow}
                    onDuplicate={onDuplicateRow}
                />
            )}
        </>
    )
}
