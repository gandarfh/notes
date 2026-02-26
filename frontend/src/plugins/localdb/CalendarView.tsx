import { useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isToday, parseISO, parse, isValid } from 'date-fns'
import type { ColumnDef, LocalDBRow, ViewConfig } from './types'

// ── Calendar View ──────────────────────────────────────────
// Month grid with clickable days → centered detail modal.

interface CalendarViewProps {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig?: ViewConfig
    onCellChange: (rowId: string, colId: string, value: unknown) => void
    onAddRow: () => void
    onDeleteRow: (rowId: string) => void
    onDuplicateRow: (rowId: string) => void
    onColumnsChange: (columns: ColumnDef[]) => void
}

interface SelectedDay {
    dateKey: string
    dateLabel: string
    items: { row: LocalDBRow; title: string; data: Record<string, unknown> }[]
}

export function CalendarView({ columns, rows, viewConfig, onDeleteRow }: CalendarViewProps) {
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // Resolve columns from viewConfig or auto-detect
    const dateCol = (viewConfig?.dateColumn
        ? columns.find(c => c.id === viewConfig.dateColumn)
        : null
    ) || columns.find(c => c.type === 'date' || c.type === 'datetime')

    const titleCol = (viewConfig?.titleColumn
        ? columns.find(c => c.id === viewConfig.titleColumn)
        : null
    ) || columns.find(c => c.type === 'text')

    const detailCols = columns.filter(c => c.id !== dateCol?.id && c.id !== titleCol?.id)

    if (!dateCol) {
        return (
            <div className="ldb-calendar-empty">
                <span>Add a <strong>Date</strong> column to use Calendar view</span>
            </div>
        )
    }

    const getRowData = (row: LocalDBRow): Record<string, unknown> => {
        try { return JSON.parse(row.dataJson || '{}') } catch { return {} }
    }

    const parseDate = (val: unknown): Date | null => {
        if (!val) return null
        const str = String(val)
        try {
            const d = parseISO(str)
            if (isValid(d)) return d
            const d2 = parse(str, 'yyyy-MM-dd', new Date())
            if (isValid(d2)) return d2
        } catch { /* ignore */ }
        return null
    }

    const formatValue = (col: ColumnDef, val: unknown): string => {
        if (val === undefined || val === null || val === '') return '—'
        if (col.type === 'checkbox') return val ? '✓ Yes' : '✗ No'
        if (col.type === 'rating') return '★'.repeat(Number(val) || 0)
        if (col.type === 'progress') return `${val}%`
        if (col.type === 'date' || col.type === 'datetime') {
            const d = parseDate(val)
            return d ? format(d, 'MMM d, yyyy') : String(val)
        }
        return String(val)
    }

    // Build calendar grid
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calStart = startOfWeek(monthStart)
    const calEnd = endOfWeek(monthEnd)

    const days: Date[] = []
    let day = calStart
    while (day <= calEnd) {
        days.push(day)
        day = addDays(day, 1)
    }

    // Group rows by date
    const rowsByDate = useMemo(() => {
        const map: Record<string, { row: LocalDBRow; title: string; data: Record<string, unknown> }[]> = {}
        for (const row of rows) {
            const data = getRowData(row)
            const d = parseDate(data[dateCol.id])
            if (!d) continue
            const key = format(d, 'yyyy-MM-dd')
            if (!map[key]) map[key] = []
            const title = titleCol ? String(data[titleCol.id] ?? 'Untitled') : 'Untitled'
            map[key].push({ row, title, data })
        }
        return map
    }, [rows, dateCol.id, titleCol?.id])

    const handleDayClick = (dateKey: string) => {
        const items = rowsByDate[dateKey]
        if (!items || items.length === 0) return
        const d = parseISO(dateKey)
        setSelectedDay({
            dateKey,
            dateLabel: isValid(d) ? format(d, 'EEEE, MMMM d') : dateKey,
            items,
        })
    }

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    return (
        <div className="ldb-calendar" ref={containerRef}>
            <div className="ldb-calendar-nav">
                <button className="ldb-calendar-nav-btn" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>‹</button>
                <span className="ldb-calendar-month">{format(currentMonth, 'MMMM yyyy')}</span>
                <button className="ldb-calendar-nav-btn" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>›</button>
            </div>

            <div className="ldb-calendar-grid">
                {weekdays.map(wd => (
                    <div key={wd} className="ldb-calendar-weekday">{wd}</div>
                ))}

                {days.map(d => {
                    const key = format(d, 'yyyy-MM-dd')
                    const items = rowsByDate[key] || []
                    const inMonth = isSameMonth(d, currentMonth)
                    const hasItems = items.length > 0

                    return (
                        <div
                            key={key}
                            className={`ldb-calendar-day ${!inMonth ? 'outside' : ''} ${isToday(d) ? 'today' : ''} ${hasItems ? 'has-items' : ''}`}
                            onClick={() => handleDayClick(key)}
                        >
                            <span className="ldb-calendar-day-num">{format(d, 'd')}</span>
                            <div className="ldb-calendar-day-items">
                                {items.slice(0, 3).map(({ row, title, data }) => {
                                    const selectCol = columns.find(c => c.type === 'select' && data[c.id])
                                    const tagValue = selectCol ? String(data[selectCol.id]) : null
                                    return (
                                        <div key={row.id} className="ldb-calendar-item" title={title}>
                                            {tagValue && <span className="ldb-calendar-item-dot" data-value={tagValue} />}
                                            <span className="ldb-calendar-item-title">{title}</span>
                                        </div>
                                    )
                                })}
                                {items.length > 3 && (
                                    <span className="ldb-calendar-more">+{items.length - 3} more</span>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* ── Centered detail modal ── */}
            {selectedDay && (
                <div className="ldb-calendar-modal-overlay" onClick={() => setSelectedDay(null)}>
                    <div className="ldb-calendar-modal" onClick={e => e.stopPropagation()}>
                        <div className="ldb-calendar-modal-header">
                            <span className="ldb-calendar-modal-date">{selectedDay.dateLabel}</span>
                            <button className="ldb-calendar-modal-close" onClick={() => setSelectedDay(null)}>✕</button>
                        </div>
                        <div className="ldb-calendar-modal-body">
                            {selectedDay.items.map(({ row, title, data }) => (
                                <div key={row.id} className="ldb-calendar-modal-card">
                                    <div className="ldb-calendar-modal-card-header">
                                        <span className="ldb-calendar-modal-card-title">{title}</span>
                                        <button
                                            className="ldb-calendar-modal-card-delete"
                                            onClick={() => { onDeleteRow(row.id); setSelectedDay(null) }}
                                        >Delete</button>
                                    </div>
                                    <div className="ldb-calendar-modal-card-fields">
                                        {detailCols.map(col => {
                                            const val = data[col.id]
                                            return (
                                                <div key={col.id} className="ldb-calendar-modal-field">
                                                    <span className="ldb-calendar-modal-field-label">{col.name}</span>
                                                    <span className="ldb-calendar-modal-field-value">
                                                        {col.type === 'select' && val ? (
                                                            <span className="ldb-tag" data-value={val}>{String(val)}</span>
                                                        ) : formatValue(col, val)}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
