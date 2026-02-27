import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnDef, ColumnType } from './types'

// ── Column Editor ──────────────────────────────────────────
// Popover to add or edit a column definition.
// Rendered via portal at viewport coordinates.

const COLUMN_TYPES: { value: ColumnType; label: string; icon: string }[] = [
    { value: 'text', label: 'Text', icon: 'Aa' },
    { value: 'number', label: 'Number', icon: '#' },
    { value: 'date', label: 'Date', icon: '📅' },
    { value: 'datetime', label: 'Date & Time', icon: '🕐' },
    { value: 'select', label: 'Select', icon: '▾' },
    { value: 'multi-select', label: 'Multi-Select', icon: '▾▾' },
    { value: 'checkbox', label: 'Checkbox', icon: '☑' },
    { value: 'url', label: 'URL', icon: '🔗' },
    { value: 'timer', label: 'Timer', icon: '⏱' },
    { value: 'progress', label: 'Progress', icon: '▓' },
    { value: 'rating', label: 'Rating', icon: '★' },
]

export interface AnchorRect {
    left: number
    top: number
    width: number
}

interface ColumnEditorProps {
    column?: ColumnDef        // undefined = adding new
    anchorRect: AnchorRect    // viewport-relative position
    onSave: (col: ColumnDef) => void
    onDelete?: () => void
    onClose: () => void
}

export function ColumnEditor({ column, anchorRect, onSave, onDelete, onClose }: ColumnEditorProps) {
    const [name, setName] = useState(column?.name ?? '')
    const [type, setType] = useState<ColumnType>(column?.type ?? 'text')
    const [options, setOptions] = useState<string[]>(column?.options ?? [])
    const [newOption, setNewOption] = useState('')

    const popoverRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { inputRef.current?.focus() }, [])

    const handleSave = () => {
        if (!name.trim()) return
        onSave({
            id: column?.id ?? crypto.randomUUID(),
            name: name.trim(),
            type,
            width: column?.width ?? 150,
            options: (type === 'select' || type === 'multi-select') ? options : undefined,
        })
    }

    const addOption = () => {
        if (!newOption.trim() || options.includes(newOption.trim())) return
        setOptions([...options, newOption.trim()])
        setNewOption('')
    }

    const removeOption = (opt: string) => {
        setOptions(options.filter(o => o !== opt))
    }

    const showOptions = type === 'select' || type === 'multi-select'

    return createPortal(
        <>
            <div className="ldb-backdrop" onClick={onClose} />
            <div
                className="ldb-col-editor"
                ref={popoverRef}
                style={{
                    position: 'fixed',
                    left: Math.max(0, anchorRect.left),
                    top: anchorRect.top,
                    zIndex: 9999,
                }}
            >
                <div className="ldb-col-editor-header">
                    <span>{column ? 'Edit Column' : 'Add Column'}</span>
                </div>

                <label className="ldb-col-editor-label">Name</label>
                <input
                    ref={inputRef}
                    className="ldb-col-editor-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                    placeholder="Column name"
                />

                <label className="ldb-col-editor-label">Type</label>
                <div className="ldb-col-type-grid">
                    {COLUMN_TYPES.map(t => (
                        <button
                            key={t.value}
                            className={`ldb-col-type-btn ${type === t.value ? 'active' : ''}`}
                            onClick={() => setType(t.value)}
                        >
                            <span className="ldb-col-type-icon">{t.icon}</span>
                            <span>{t.label}</span>
                        </button>
                    ))}
                </div>

                {showOptions && (
                    <div className="ldb-col-options">
                        <label className="ldb-col-editor-label">Options</label>
                        <div className="ldb-col-options-list">
                            {options.map(opt => (
                                <div key={opt} className="ldb-col-option-item">
                                    <span className="ldb-tag" data-value={opt}>{opt}</span>
                                    <button className="ldb-col-option-remove" onClick={() => removeOption(opt)}>×</button>
                                </div>
                            ))}
                        </div>
                        <div className="ldb-col-option-add">
                            <input
                                className="ldb-col-editor-input"
                                value={newOption}
                                onChange={e => setNewOption(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') addOption() }}
                                placeholder="New option"
                            />
                            <button className="ldb-col-option-add-btn" onClick={addOption}>+</button>
                        </div>
                    </div>
                )}

                <div className="ldb-col-editor-actions">
                    {onDelete && (
                        <button className="ldb-col-editor-delete" onClick={onDelete}>Delete</button>
                    )}
                    <div className="ldb-col-editor-spacer" />
                    <button className="ldb-col-editor-cancel" onClick={onClose}>Cancel</button>
                    <button className="ldb-col-editor-save" onClick={handleSave}>Save</button>
                </div>
            </div>
        </>,
        document.body,
    )
}
