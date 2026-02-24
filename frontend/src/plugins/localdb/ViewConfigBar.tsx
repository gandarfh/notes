import { createPortal } from 'react-dom'
import { useState, useRef, useEffect } from 'react'
import type { ColumnDef, ViewConfig } from '../../bridge/wails'
import type { ViewType } from './ViewSwitcher'

// ── View Config Bar ────────────────────────────────────────
// Small inline row showing which columns are used by the
// current view, with dropdowns to change them.

interface ViewConfigBarProps {
    activeView: ViewType
    columns: ColumnDef[]
    viewConfig: ViewConfig
    onConfigChange: (config: ViewConfig) => void
}

interface FieldPickerDef {
    key: keyof ViewConfig
    label: string
    filter?: (col: ColumnDef) => boolean
}

const VIEW_FIELDS: Record<string, FieldPickerDef[]> = {
    kanban: [
        { key: 'titleColumn', label: 'Title', filter: c => c.type === 'text' },
        { key: 'groupByColumn', label: 'Group by', filter: c => c.type === 'select' || c.type === 'multi-select' },
    ],
    calendar: [
        { key: 'titleColumn', label: 'Title', filter: c => c.type === 'text' },
        { key: 'dateColumn', label: 'Date', filter: c => c.type === 'date' || c.type === 'datetime' },
    ],
}

export function ViewConfigBar({ activeView, columns, viewConfig, onConfigChange }: ViewConfigBarProps) {
    const fields = VIEW_FIELDS[activeView]
    if (!fields || activeView === 'table') return null

    return (
        <div className="ldb-view-config-bar">
            {fields.map(field => {
                const eligible = field.filter ? columns.filter(field.filter) : columns
                const currentId = viewConfig[field.key]
                const currentCol = columns.find(c => c.id === currentId)

                return (
                    <FieldPicker
                        key={field.key}
                        label={field.label}
                        value={currentCol?.name || 'Auto'}
                        options={eligible}
                        selected={currentId}
                        onChange={colId => onConfigChange({ ...viewConfig, [field.key]: colId })}
                    />
                )
            })}
        </div>
    )
}

// ── Field Picker ───────────────────────────────────────────

function FieldPicker({ label, value, options, selected, onChange }: {
    label: string
    value: string
    options: ColumnDef[]
    selected?: string
    onChange: (colId: string | undefined) => void
}) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [pos, setPos] = useState({ top: 0, left: 0 })

    useEffect(() => {
        if (!open || !triggerRef.current) return
        const rect = triggerRef.current.getBoundingClientRect()
        setPos({ top: rect.bottom + 4, left: rect.left })
    }, [open])

    return (
        <div className="ldb-field-picker">
            <span className="ldb-field-picker-label">{label}:</span>
            <button ref={triggerRef} className="ldb-field-picker-btn" onClick={() => setOpen(!open)}>
                {value} ▾
            </button>

            {open && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => setOpen(false)} />
                    <div className="ldb-field-picker-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
                        <div
                            className={`ldb-field-picker-option ${!selected ? 'active' : ''}`}
                            onClick={() => { onChange(undefined); setOpen(false) }}
                        >
                            Auto (first match)
                        </div>
                        {options.map(col => (
                            <div
                                key={col.id}
                                className={`ldb-field-picker-option ${selected === col.id ? 'active' : ''}`}
                                onClick={() => { onChange(col.id); setOpen(false) }}
                            >
                                {col.name}
                            </div>
                        ))}
                    </div>
                </>,
                document.body,
            )}
        </div>
    )
}
