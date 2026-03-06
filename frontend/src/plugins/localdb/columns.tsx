import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { format, parse, parseISO, isValid } from 'date-fns'
import type { Column } from 'react-data-grid'
import type { ColumnDef } from './types'
import { TimerCell, parseTimerValue } from './TimerCell'
import { getColumnTypeIcon, tagColorStyle, type AnchorRect } from './ColumnEditor'

// ── Row type for react-data-grid ────────────────────────────

export interface GridRow {
    _id: string
    _raw: import('./types').LocalDBRow
    [key: string]: unknown
}

// ── Column mapping ──────────────────────────────────────────
// All cells use inline editing (renderCell only, no renderEditCell).
// react-data-grid is used only for layout, virtualization, resize, and reorder.

type CellChangeHandler = (rowId: string, colId: string, value: unknown) => void

export function toGridColumns(
    columns: ColumnDef[],
    onCellChange: CellChangeHandler,
    onEditColumn?: (col: ColumnDef, anchor: AnchorRect) => void,
): Column<GridRow>[] {
    return columns.map(col => ({
        key: col.id,
        name: col.name,
        width: col.width,
        minWidth: 60,
        resizable: true,
        sortable: true,
        draggable: true,
        renderHeaderCell: () => {
            const TypeIcon = getColumnTypeIcon(col.type)
            return (
                <div
                    className="ldb-header-cell"
                    onClick={e => {
                        e.stopPropagation()
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        onEditColumn?.(col, { left: rect.left, top: rect.bottom + 4, width: rect.width })
                    }}
                >
                    <TypeIcon size={14} />
                    <span>{col.name}</span>
                </div>
            )
        },
        renderCell: ({ row }) => (
            <InlineCell column={col} row={row} onCellChange={onCellChange} />
        ),
    }))
}

// ── Inline Cell — unified component for all types ───────────

function InlineCell({ column, row, onCellChange }: {
    column: ColumnDef
    row: GridRow
    onCellChange: CellChangeHandler
}) {
    const value = row[column.id]
    const rowId = row._id
    const onChange = (v: unknown) => onCellChange(rowId, column.id, v)

    switch (column.type) {
        case 'text':
            return <TextInline value={String(value ?? '')} onChange={onChange} />
        case 'number':
            return <NumberInline value={value as number | null} onChange={onChange} />
        case 'url':
            return <URLInline value={String(value ?? '')} onChange={onChange} />
        case 'checkbox':
            return <CheckboxInline value={Boolean(value)} onChange={onChange} />
        case 'rating':
            return <RatingInline value={typeof value === 'number' ? value : 0} onChange={onChange} />
        case 'timer':
            return <TimerCell value={parseTimerValue(value)} onChange={onChange} />
        case 'progress':
            return <ProgressInline value={typeof value === 'number' ? value : 0} onChange={onChange} />
        case 'date':
            return <DateInline value={String(value ?? '')} showTime={false} onChange={onChange} />
        case 'datetime':
            return <DateInline value={String(value ?? '')} showTime={true} onChange={onChange} />
        case 'select':
            return <SelectInline value={String(value ?? '')} options={column.options || []} optionColors={column.optionColors} onChange={onChange} />
        case 'multi-select':
            return <MultiSelectInline value={(value as string[]) || []} options={column.options || []} optionColors={column.optionColors} onChange={onChange} />
        case 'formula':
            return <span className="ldb-cell-formula">{String(value ?? '\u2014')}</span>
        case 'relation':
            return <span className="ldb-cell-relation">{String(value ?? '\u2014')}</span>
        case 'rollup':
            return <span className="ldb-cell-rollup">{String(value ?? '\u2014')}</span>
        default:
            return <span>{String(value ?? '')}</span>
    }
}

// ── Text Inline ─────────────────────────────────────────────

function TextInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(value) }, [value])
    useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

    const commit = () => { onChange(draft); setEditing(false) }
    const cancel = () => { setDraft(value); setEditing(false) }

    if (!editing) {
        return (
            <div className="ldb-cell-text" onDoubleClick={() => setEditing(true)}>
                {value || <span className="ldb-cell-placeholder">Empty</span>}
            </div>
        )
    }

    return (
        <input
            ref={inputRef}
            className="ldb-cell-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit() }
                if (e.key === 'Escape') { e.preventDefault(); cancel() }
                e.stopPropagation()
            }}
        />
    )
}

// ── Number Inline ───────────────────────────────────────────

function NumberInline({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(String(value ?? ''))
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(String(value ?? '')) }, [value])
    useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

    const commit = () => { onChange(draft ? Number(draft) : null); setEditing(false) }
    const cancel = () => { setDraft(String(value ?? '')); setEditing(false) }

    if (!editing) {
        return (
            <div className="ldb-cell-number" onDoubleClick={() => setEditing(true)}>
                {value != null ? value.toLocaleString() : <span className="ldb-cell-placeholder">&mdash;</span>}
            </div>
        )
    }

    return (
        <input
            ref={inputRef}
            className="ldb-cell-input"
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit() }
                if (e.key === 'Escape') { e.preventDefault(); cancel() }
                e.stopPropagation()
            }}
        />
    )
}

// ── URL Inline ──────────────────────────────────────────────

function URLInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(value) }, [value])
    useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

    const commit = () => { onChange(draft); setEditing(false) }
    const cancel = () => { setDraft(value); setEditing(false) }

    if (!editing) {
        return (
            <div className="ldb-cell-url" onDoubleClick={() => setEditing(true)}>
                {value ? <a href={value} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{value}</a> : <span className="ldb-cell-placeholder">Add URL</span>}
            </div>
        )
    }

    return (
        <input
            ref={inputRef}
            className="ldb-cell-input"
            type="url"
            placeholder="https://"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit() }
                if (e.key === 'Escape') { e.preventDefault(); cancel() }
                e.stopPropagation()
            }}
        />
    )
}

// ── Checkbox Inline ─────────────────────────────────────────

function CheckboxInline({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="ldb-cell-checkbox" onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
            <span className="ldb-checkbox-mark" />
        </label>
    )
}

// ── Rating Inline ───────────────────────────────────────────

function RatingInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    return (
        <div className="ldb-cell-rating" onClick={e => e.stopPropagation()}>
            {Array.from({ length: 5 }, (_, i) => (
                <button key={i} className={`ldb-star ${i < value ? 'active' : ''}`} onClick={() => onChange(i + 1 === value ? 0 : i + 1)}>★</button>
            ))}
        </div>
    )
}

// ── Progress Inline ─────────────────────────────────────────

function ProgressInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    return (
        <div className="ldb-cell-progress" onClick={e => e.stopPropagation()}>
            <div className="ldb-progress-bar">
                <div className="ldb-progress-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
            </div>
            <input className="ldb-progress-input" type="number" min={0} max={100} value={value}
                onChange={e => onChange(Number(e.target.value))} onClick={e => e.stopPropagation()} />
        </div>
    )
}

// ── Portal helper ───────────────────────────────────────────

function PortalDropdown({ anchorRef, open, onClose, children }: {
    anchorRef: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: React.ReactNode
}) {
    const [pos, setPos] = useState({ top: 0, left: 0 })
    useEffect(() => {
        if (!open || !anchorRef.current) return
        const rect = anchorRef.current.getBoundingClientRect()
        setPos({ top: rect.bottom + 4, left: rect.left })
    }, [open, anchorRef])
    if (!open) return null
    return createPortal(
        <>
            <div className="ldb-backdrop" onClick={onClose} />
            <div className="ldb-portal-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
                {children}
            </div>
        </>,
        document.body,
    )
}

// ── Date Inline ─────────────────────────────────────────────

function DateInline({ value, showTime, onChange }: { value: string; showTime: boolean; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false)
    const [timeStr, setTimeStr] = useState(() => {
        if (!value || !showTime) return '12:00'
        try { const d = parseISO(value); return isValid(d) ? format(d, 'HH:mm') : '12:00' } catch { return '12:00' }
    })
    const triggerRef = useRef<HTMLDivElement>(null)

    const selected = value ? (() => {
        try {
            if (showTime) { const d = parseISO(value); return isValid(d) ? d : undefined }
            const d = parse(value, 'yyyy-MM-dd', new Date()); return isValid(d) ? d : undefined
        } catch { return undefined }
    })() : undefined

    const displayValue = selected ? (showTime ? format(selected, 'MMM d, yyyy HH:mm') : format(selected, 'MMM d, yyyy')) : ''
    const close = () => setOpen(false)

    const handleSelect = (day: Date | undefined) => {
        if (!day) return
        if (showTime) { const [h, m] = timeStr.split(':').map(Number); day.setHours(h || 0, m || 0, 0, 0); onChange(day.toISOString()) }
        else { onChange(format(day, 'yyyy-MM-dd')) }
        if (!showTime) close()
    }

    const handleTimeChange = (newTime: string) => {
        setTimeStr(newTime)
        if (selected) { const [h, m] = newTime.split(':').map(Number); const d = new Date(selected); d.setHours(h || 0, m || 0, 0, 0); onChange(d.toISOString()) }
    }

    return (
        <div className="ldb-cell-date" ref={triggerRef} onClick={e => e.stopPropagation()}>
            <button className="ldb-date-trigger" onClick={() => setOpen(!open)}>
                {displayValue || <span className="ldb-cell-placeholder">Pick date</span>}
            </button>
            <PortalDropdown anchorRef={triggerRef} open={open} onClose={close}>
                <div className="ldb-datepicker" onMouseDown={e => e.stopPropagation()}>
                    <DayPicker mode="single" selected={selected} onSelect={handleSelect} showOutsideDays
                        classNames={{ root: 'ldb-rdp', months: 'ldb-rdp-months', month_caption: 'ldb-rdp-caption', nav: 'ldb-rdp-nav', button_previous: 'ldb-rdp-nav-btn', button_next: 'ldb-rdp-nav-btn', month_grid: 'ldb-rdp-table', weekdays: 'ldb-rdp-head', weekday: 'ldb-rdp-weekday', day: 'ldb-rdp-day', day_button: 'ldb-rdp-day-btn', selected: 'ldb-rdp-selected', today: 'ldb-rdp-today', outside: 'ldb-rdp-outside' }} />
                    {showTime && (
                        <div className="ldb-datepicker-time">
                            <label>Time</label>
                            <input type="time" className="ldb-time-input" value={timeStr} onChange={e => handleTimeChange(e.target.value)} />
                        </div>
                    )}
                    <div className="ldb-datepicker-footer">
                        <button className="ldb-datepicker-today" onClick={() => { handleSelect(new Date()); if (!showTime) close() }}>Today</button>
                        {value && <button className="ldb-datepicker-clear" onClick={() => { onChange(''); close() }}>Clear</button>}
                    </div>
                </div>
            </PortalDropdown>
        </div>
    )
}

// ── Select Inline ───────────────────────────────────────────

function SelectInline({ value, options, optionColors, onChange }: { value: string; options: string[]; optionColors?: Record<string, string>; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)
    const close = () => setOpen(false)

    return (
        <div className="ldb-cell-select" ref={triggerRef} onClick={e => e.stopPropagation()}>
            <button className="ldb-select-trigger" onClick={() => setOpen(!open)}>
                {value ? <span className="ldb-tag" style={tagColorStyle(optionColors?.[value])}>{value}</span> : <span className="ldb-cell-placeholder">Select...</span>}
            </button>
            <PortalDropdown anchorRef={triggerRef} open={open} onClose={close}>
                <div className="ldb-select-dropdown" onMouseDown={e => e.stopPropagation()}>
                    {options.map(opt => (
                        <div key={opt} className={`ldb-select-option ${opt === value ? 'active' : ''}`} onClick={() => { onChange(opt); close() }}>
                            <span className="ldb-tag" style={tagColorStyle(optionColors?.[opt])}>{opt}</span>
                        </div>
                    ))}
                    {value && <div className="ldb-select-option clear" onClick={() => { onChange(''); close() }}>Clear</div>}
                </div>
            </PortalDropdown>
        </div>
    )
}

// ── Multi-Select Inline ─────────────────────────────────────

function MultiSelectInline({ value, options, optionColors, onChange }: { value: string[]; options: string[]; optionColors?: Record<string, string>; onChange: (v: string[]) => void }) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)
    const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])

    return (
        <div className="ldb-cell-select" ref={triggerRef} onClick={e => e.stopPropagation()}>
            <button className="ldb-select-trigger" onClick={() => setOpen(!open)}>
                {value.length > 0 ? value.map(v => <span key={v} className="ldb-tag" style={tagColorStyle(optionColors?.[v])}>{v}</span>) : <span className="ldb-cell-placeholder">Select...</span>}
            </button>
            <PortalDropdown anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
                <div className="ldb-select-dropdown" onMouseDown={e => e.stopPropagation()}>
                    {options.map(opt => (
                        <div key={opt} className={`ldb-select-option ${value.includes(opt) ? 'active' : ''}`} onClick={() => toggle(opt)}>
                            <span className="ldb-tag" style={tagColorStyle(optionColors?.[opt])}>{opt}</span>
                            {value.includes(opt) && <span className="ldb-check">{'\u2713'}</span>}
                        </div>
                    ))}
                </div>
            </PortalDropdown>
        </div>
    )
}
