import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { format, parse, parseISO, isValid } from 'date-fns'
import type { ColumnDef } from './types'
import { TimerCell, parseTimerValue } from './TimerCell'

// ── Cell Renderer ──────────────────────────────────────────
// Polymorphic cell renderer based on column type.

interface CellRendererProps {
    column: ColumnDef
    value: unknown
    onChange: (value: unknown) => void
    isEditing: boolean
}

export function CellRenderer({ column, value, onChange, isEditing }: CellRendererProps) {
    switch (column.type) {
        case 'text':
            return <TextCell value={String(value ?? '')} onChange={onChange} />
        case 'number':
            return <NumberCell value={value as number | null} onChange={onChange} />
        case 'date':
            return <DatePickerCell value={String(value ?? '')} onChange={onChange} showTime={false} />
        case 'datetime':
            return <DatePickerCell value={String(value ?? '')} onChange={onChange} showTime={true} />
        case 'select':
            return <SelectCell value={String(value ?? '')} options={column.options || []} onChange={onChange} />
        case 'multi-select':
            return <MultiSelectCell value={(value as string[]) || []} options={column.options || []} onChange={onChange} />
        case 'checkbox':
            return <CheckboxCell value={Boolean(value)} onChange={onChange} />
        case 'url':
            return <URLCell value={String(value ?? '')} onChange={onChange} />
        case 'timer':
            return <TimerCell value={parseTimerValue(value)} onChange={onChange} />
        case 'progress':
            return <ProgressCell value={typeof value === 'number' ? value : 0} onChange={onChange} />
        case 'rating':
            return <RatingCell value={typeof value === 'number' ? value : 0} onChange={onChange} />
        case 'formula':
            return <span className="ldb-cell-formula">{String(value ?? '—')}</span>
        case 'relation':
            return <span className="ldb-cell-relation">{String(value ?? '—')}</span>
        case 'rollup':
            return <span className="ldb-cell-rollup">{String(value ?? '—')}</span>
        default:
            return <span>{String(value ?? '')}</span>
    }
}

// ── Portal Dropdown ────────────────────────────────────────
// Renders children into a portal with a transparent backdrop
// that closes the dropdown when clicked, then refocuses the block.

function PortalDropdown({ anchorRef, open, onClose, children }: {
    anchorRef: React.RefObject<HTMLElement | null>
    open: boolean
    onClose: () => void
    children: React.ReactNode
}) {
    const [pos, setPos] = useState({ top: 0, left: 0 })

    useEffect(() => {
        if (!open || !anchorRef.current) return
        const rect = anchorRef.current.getBoundingClientRect()
        setPos({
            top: rect.bottom + 4,
            left: rect.left,
        })
    }, [open, anchorRef])

    if (!open) return null

    const handleBackdropClick = () => {
        onClose()
        // Refocus closest focusable ancestor so the block keeps focus
        setTimeout(() => {
            const focusable = anchorRef.current?.closest('[tabindex]') as HTMLElement | null
            focusable?.focus()
        }, 0)
    }

    return createPortal(
        <>
            <div className="ldb-backdrop" onClick={handleBackdropClick} />
            <div className="ldb-portal-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
                {children}
            </div>
        </>,
        document.body,
    )
}

// ── Text Cell ──────────────────────────────────────────────

function TextCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(value) }, [value])
    useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

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
            onBlur={() => { onChange(draft); setEditing(false) }}
            onKeyDown={e => {
                if (e.key === 'Enter') { onChange(draft); setEditing(false) }
                if (e.key === 'Escape') { setDraft(value); setEditing(false) }
            }}
        />
    )
}

// ── Number Cell ────────────────────────────────────────────

function NumberCell({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(String(value ?? ''))
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(String(value ?? '')) }, [value])
    useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

    if (!editing) {
        return (
            <div className="ldb-cell-number" onDoubleClick={() => setEditing(true)}>
                {value != null ? value.toLocaleString() : <span className="ldb-cell-placeholder">—</span>}
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
            onBlur={() => { onChange(draft ? Number(draft) : null); setEditing(false) }}
            onKeyDown={e => {
                if (e.key === 'Enter') { onChange(draft ? Number(draft) : null); setEditing(false) }
                if (e.key === 'Escape') { setDraft(String(value ?? '')); setEditing(false) }
            }}
        />
    )
}

// ── Date Picker Cell ───────────────────────────────────────
// Uses react-day-picker with custom styling matching our theme.

function DatePickerCell({ value, onChange, showTime }: {
    value: string
    onChange: (v: string) => void
    showTime: boolean
}) {
    const [open, setOpen] = useState(false)
    const [timeStr, setTimeStr] = useState(() => {
        if (!value || !showTime) return '12:00'
        try {
            const d = parseISO(value)
            return isValid(d) ? format(d, 'HH:mm') : '12:00'
        } catch { return '12:00' }
    })
    const triggerRef = useRef<HTMLDivElement>(null)

    const selected = value ? (() => {
        try {
            if (showTime) {
                const d = parseISO(value)
                return isValid(d) ? d : undefined
            }
            const d = parse(value, 'yyyy-MM-dd', new Date())
            return isValid(d) ? d : undefined
        } catch { return undefined }
    })() : undefined

    const displayValue = selected
        ? (showTime ? format(selected, 'MMM d, yyyy HH:mm') : format(selected, 'MMM d, yyyy'))
        : ''

    const closeAndRefocus = () => {
        setOpen(false)
        setTimeout(() => {
            const f = triggerRef.current?.closest('[tabindex]') as HTMLElement | null
            f?.focus()
        }, 0)
    }

    const handleSelect = (day: Date | undefined) => {
        if (!day) return
        if (showTime) {
            const [h, m] = timeStr.split(':').map(Number)
            day.setHours(h || 0, m || 0, 0, 0)
            onChange(day.toISOString())
        } else {
            onChange(format(day, 'yyyy-MM-dd'))
        }
        if (!showTime) closeAndRefocus()
    }

    const handleTimeChange = (newTime: string) => {
        setTimeStr(newTime)
        if (selected) {
            const [h, m] = newTime.split(':').map(Number)
            const d = new Date(selected)
            d.setHours(h || 0, m || 0, 0, 0)
            onChange(d.toISOString())
        }
    }

    const handleClear = () => {
        onChange('')
        closeAndRefocus()
    }

    return (
        <div className="ldb-cell-date" ref={triggerRef}>
            <button className="ldb-date-trigger" onClick={() => setOpen(!open)}>
                {displayValue || <span className="ldb-cell-placeholder">Pick date</span>}
            </button>

            <PortalDropdown anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
                <div className="ldb-datepicker" onMouseDown={e => e.stopPropagation()}>
                    <DayPicker
                        mode="single"
                        selected={selected}
                        onSelect={handleSelect}
                        showOutsideDays
                        classNames={{
                            root: 'ldb-rdp',
                            months: 'ldb-rdp-months',
                            month_caption: 'ldb-rdp-caption',
                            nav: 'ldb-rdp-nav',
                            button_previous: 'ldb-rdp-nav-btn',
                            button_next: 'ldb-rdp-nav-btn',
                            month_grid: 'ldb-rdp-table',
                            weekdays: 'ldb-rdp-head',
                            weekday: 'ldb-rdp-weekday',
                            day: 'ldb-rdp-day',
                            day_button: 'ldb-rdp-day-btn',
                            selected: 'ldb-rdp-selected',
                            today: 'ldb-rdp-today',
                            outside: 'ldb-rdp-outside',
                        }}
                    />
                    {showTime && (
                        <div className="ldb-datepicker-time">
                            <label>Time</label>
                            <input
                                type="time"
                                className="ldb-time-input"
                                value={timeStr}
                                onChange={e => handleTimeChange(e.target.value)}
                            />
                        </div>
                    )}
                    <div className="ldb-datepicker-footer">
                        <button className="ldb-datepicker-today" onClick={() => { handleSelect(new Date()); if (!showTime) closeAndRefocus() }}>Today</button>
                        {value && <button className="ldb-datepicker-clear" onClick={handleClear}>Clear</button>}
                    </div>
                </div>
            </PortalDropdown>
        </div>
    )
}

// ── Select Cell ────────────────────────────────────────────

function SelectCell({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)

    const closeAndRefocus = () => {
        setOpen(false)
        setTimeout(() => {
            const f = triggerRef.current?.closest('[tabindex]') as HTMLElement | null
            f?.focus()
        }, 0)
    }

    return (
        <div className="ldb-cell-select" ref={triggerRef}>
            <button className="ldb-select-trigger" onClick={() => setOpen(!open)}>
                {value ? <span className="ldb-tag" data-value={value}>{value}</span> : <span className="ldb-cell-placeholder">Select...</span>}
            </button>

            <PortalDropdown anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
                <div className="ldb-select-dropdown" onMouseDown={e => e.stopPropagation()}>
                    {options.map(opt => (
                        <div
                            key={opt}
                            className={`ldb-select-option ${opt === value ? 'active' : ''}`}
                            onClick={() => { onChange(opt); closeAndRefocus() }}
                        >
                            <span className="ldb-tag" data-value={opt}>{opt}</span>
                        </div>
                    ))}
                    {value && (
                        <div className="ldb-select-option clear" onClick={() => { onChange(''); closeAndRefocus() }}>
                            Clear
                        </div>
                    )}
                </div>
            </PortalDropdown>
        </div>
    )
}

// ── Multi-Select Cell ──────────────────────────────────────

function MultiSelectCell({ value, options, onChange }: { value: string[]; options: string[]; onChange: (v: string[]) => void }) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)

    const toggle = (opt: string) => {
        if (value.includes(opt)) {
            onChange(value.filter(v => v !== opt))
        } else {
            onChange([...value, opt])
        }
    }

    return (
        <div className="ldb-cell-select" ref={triggerRef}>
            <button className="ldb-select-trigger" onClick={() => setOpen(!open)}>
                {value.length > 0
                    ? value.map(v => <span key={v} className="ldb-tag" data-value={v}>{v}</span>)
                    : <span className="ldb-cell-placeholder">Select...</span>
                }
            </button>

            <PortalDropdown anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
                <div className="ldb-select-dropdown" onMouseDown={e => e.stopPropagation()}>
                    {options.map(opt => (
                        <div
                            key={opt}
                            className={`ldb-select-option ${value.includes(opt) ? 'active' : ''}`}
                            onClick={() => toggle(opt)}
                        >
                            <span className="ldb-tag" data-value={opt}>{opt}</span>
                            {value.includes(opt) && <span className="ldb-check">✓</span>}
                        </div>
                    ))}
                </div>
            </PortalDropdown>
        </div>
    )
}

// ── Checkbox Cell ──────────────────────────────────────────

function CheckboxCell({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="ldb-cell-checkbox">
            <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
            <span className="ldb-checkbox-mark" />
        </label>
    )
}

// ── URL Cell ───────────────────────────────────────────────

function URLCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(value) }, [value])
    useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

    if (!editing) {
        return (
            <div className="ldb-cell-url" onDoubleClick={() => setEditing(true)}>
                {value ? <a href={value} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>{value}</a> : <span className="ldb-cell-placeholder">Add URL</span>}
            </div>
        )
    }

    return (
        <input
            ref={inputRef}
            className="ldb-cell-input"
            type="url"
            value={draft}
            placeholder="https://"
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onChange(draft); setEditing(false) }}
            onKeyDown={e => {
                if (e.key === 'Enter') { onChange(draft); setEditing(false) }
                if (e.key === 'Escape') { setDraft(value); setEditing(false) }
            }}
        />
    )
}

// ── Progress Cell ──────────────────────────────────────────

function ProgressCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    return (
        <div className="ldb-cell-progress">
            <div className="ldb-progress-bar">
                <div className="ldb-progress-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
            </div>
            <input
                className="ldb-progress-input"
                type="number"
                min={0}
                max={100}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
            />
        </div>
    )
}

// ── Rating Cell ────────────────────────────────────────────

function RatingCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const max = 5
    return (
        <div className="ldb-cell-rating">
            {Array.from({ length: max }, (_, i) => (
                <button
                    key={i}
                    className={`ldb-star ${i < value ? 'active' : ''}`}
                    onClick={() => onChange(i + 1 === value ? 0 : i + 1)}
                >
                    ★
                </button>
            ))}
        </div>
    )
}
