import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
    IconLetterCase, IconHash, IconCalendar, IconClockHour4,
    IconSelector, IconTags, IconCheckbox, IconLink,
    IconPlayerPlay, IconProgress, IconStar,
    IconColumnInsertLeft, IconColumnInsertRight, IconTrash,
} from '@tabler/icons-react'
import type { ColumnDef, ColumnType } from './types'

// ── Column Editor ──────────────────────────────────────────
// Notion-style popover to edit a column definition.
// Auto-saves on backdrop click, discards on Escape.

export const COLUMN_TYPES: { value: ColumnType; label: string; Icon: React.FC<{ size?: number }> }[] = [
    { value: 'text', label: 'Text', Icon: IconLetterCase },
    { value: 'number', label: 'Number', Icon: IconHash },
    { value: 'date', label: 'Date', Icon: IconCalendar },
    { value: 'datetime', label: 'Date & Time', Icon: IconClockHour4 },
    { value: 'select', label: 'Select', Icon: IconSelector },
    { value: 'multi-select', label: 'Multi-Select', Icon: IconTags },
    { value: 'checkbox', label: 'Checkbox', Icon: IconCheckbox },
    { value: 'url', label: 'URL', Icon: IconLink },
    { value: 'timer', label: 'Timer', Icon: IconPlayerPlay },
    { value: 'progress', label: 'Progress', Icon: IconProgress },
    { value: 'rating', label: 'Rating', Icon: IconStar },
]

export function getColumnTypeIcon(type: ColumnType): React.FC<{ size?: number }> {
    return COLUMN_TYPES.find(t => t.value === type)?.Icon ?? IconLetterCase
}

// ── Tag Color Palette ──────────────────────────────────────

export const TAG_COLORS: { id: string; label: string; bg: string; fg: string; swatch: string }[] = [
    { id: 'default', label: 'Default', bg: 'var(--color-accent-muted)',  fg: 'var(--color-text-accent)', swatch: 'rgba(147, 130, 220, 0.35)' },
    { id: 'gray',    label: 'Gray',    bg: 'var(--overlay-8)',            fg: 'var(--color-text-secondary)', swatch: 'rgba(155, 155, 155, 0.45)' },
    { id: 'brown',   label: 'Brown',   bg: 'rgba(159, 107, 83, 0.12)',   fg: 'rgb(159, 107, 83)', swatch: 'rgb(159, 107, 83)' },
    { id: 'orange',  label: 'Orange',  bg: 'rgba(218, 160, 48, 0.12)',   fg: 'var(--color-warning)', swatch: 'rgb(218, 160, 48)' },
    { id: 'yellow',  label: 'Yellow',  bg: 'rgba(203, 185, 55, 0.12)',   fg: 'rgb(203, 185, 55)', swatch: 'rgb(203, 185, 55)' },
    { id: 'green',   label: 'Green',   bg: 'rgba(109, 186, 94, 0.12)',   fg: 'var(--color-success)', swatch: 'rgb(109, 186, 94)' },
    { id: 'blue',    label: 'Blue',    bg: 'rgba(82, 156, 202, 0.12)',   fg: 'rgb(82, 156, 202)', swatch: 'rgb(82, 156, 202)' },
    { id: 'purple',  label: 'Purple',  bg: 'rgba(154, 109, 215, 0.12)',  fg: 'rgb(154, 109, 215)', swatch: 'rgb(154, 109, 215)' },
    { id: 'pink',    label: 'Pink',    bg: 'rgba(205, 116, 159, 0.12)',  fg: 'rgb(205, 116, 159)', swatch: 'rgb(205, 116, 159)' },
    { id: 'red',     label: 'Red',     bg: 'rgba(212, 96, 78, 0.12)',    fg: 'var(--color-error)', swatch: 'rgb(212, 96, 78)' },
]

export function tagColorStyle(colorId?: string): React.CSSProperties | undefined {
    if (!colorId || colorId === 'default') return undefined
    const c = TAG_COLORS.find(t => t.id === colorId)
    if (!c) return undefined
    return { background: c.bg, color: c.fg }
}

// ── Anchor ─────────────────────────────────────────────────

export interface AnchorRect {
    left: number
    top: number
    width: number
}

// ── Option Editor Sub-popover ──────────────────────────────
// Notion-style: click a tag → opens popover with rename input,
// delete button, and color list as labeled rows.

function OptionEditorPopover({ opt, colorId, anchorEl, onRename, onDelete, onColorChange, onClose }: {
    opt: string
    colorId: string
    anchorEl: HTMLElement
    onRename: (oldName: string, newName: string) => void
    onDelete: (opt: string) => void
    onColorChange: (opt: string, colorId: string) => void
    onClose: () => void
}) {
    const [draft, setDraft] = useState(opt)
    const popRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

    useLayoutEffect(() => {
        const el = popRef.current
        if (!el) return
        const anchorRect = anchorEl.getBoundingClientRect()
        const popRect = el.getBoundingClientRect()
        let left = anchorRect.right + 6
        let top = anchorRect.top
        // Flip left if overflows right
        if (left + popRect.width > window.innerWidth - 8) {
            left = anchorRect.left - popRect.width - 6
        }
        // Clamp vertically
        if (top + popRect.height > window.innerHeight - 8) {
            top = window.innerHeight - popRect.height - 8
        }
        setPos({ left: Math.max(0, left), top: Math.max(0, top) })
    }, [anchorEl])

    const commitRename = () => {
        const trimmed = draft.trim()
        if (trimmed && trimmed !== opt) onRename(opt, trimmed)
    }

    return createPortal(
        <>
            <div className="ldb-backdrop" onClick={() => { commitRename(); onClose() }} />
            <div
                ref={popRef}
                className="ldb-option-editor"
                style={{
                    position: 'fixed',
                    left: pos?.left ?? -9999,
                    top: pos?.top ?? -9999,
                    zIndex: 10000,
                    visibility: pos ? 'visible' : 'hidden',
                }}
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); commitRename(); onClose() } }}
            >
                <input
                    ref={inputRef}
                    className="ldb-option-editor-input"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { commitRename(); onClose() } }}
                />

                <button className="ldb-option-editor-row danger" onClick={() => { onDelete(opt); onClose() }}>
                    <IconTrash size={14} />
                    <span>Delete</span>
                </button>

                <div className="ldb-option-editor-divider" />
                <label className="ldb-option-editor-section">Colors</label>

                {TAG_COLORS.map(c => (
                    <button
                        key={c.id}
                        className={`ldb-option-editor-row ${colorId === c.id ? 'active' : ''}`}
                        onClick={() => onColorChange(opt, c.id)}
                    >
                        <span className="ldb-color-swatch" style={{ background: c.swatch }} />
                        <span>{c.label}</span>
                        {colorId === c.id && <span className="ldb-col-type-check">✓</span>}
                    </button>
                ))}
            </div>
        </>,
        document.body,
    )
}

// ── Column Editor Component ────────────────────────────────

interface ColumnEditorProps {
    column: ColumnDef
    anchorRect: AnchorRect
    onSave: (col: ColumnDef) => void
    onDelete?: () => void
    onClose: () => void
    onInsertLeft?: () => void
    onInsertRight?: () => void
}

export function ColumnEditor({ column, anchorRect, onSave, onDelete, onClose, onInsertLeft, onInsertRight }: ColumnEditorProps) {
    const [name, setName] = useState(column.name)
    const [type, setType] = useState<ColumnType>(column.type)
    const [options, setOptions] = useState<string[]>(column.options ?? [])
    const [optionColors, setOptionColors] = useState<Record<string, string>>(column.optionColors ?? {})
    const [newOption, setNewOption] = useState('')
    const [editingOption, setEditingOption] = useState<string | null>(null)

    const popoverRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const optionRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

    // Focus input on mount
    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

    // Measure popover and compute position with viewport clamping
    useLayoutEffect(() => {
        const el = popoverRef.current
        if (!el) return
        const popRect = el.getBoundingClientRect()
        let top = anchorRect.top
        let left = anchorRect.left
        if (top + popRect.height > window.innerHeight - 8) {
            top = anchorRect.top - popRect.height - 4
        }
        const anchorRight = anchorRect.left + anchorRect.width
        if (left + popRect.width > window.innerWidth - 8) {
            left = anchorRight - popRect.width
        }
        setPos({ left: Math.max(0, left), top: Math.max(0, top) })
        el.focus()
    }, [anchorRect])

    const buildColumn = (): ColumnDef => {
        const isSelect = type === 'select' || type === 'multi-select'
        return {
            id: column.id,
            name: name.trim() || column.name,
            type,
            width: column.width,
            options: isSelect ? options : undefined,
            optionColors: isSelect && Object.keys(optionColors).length > 0 ? optionColors : undefined,
        }
    }

    const handleBackdropClick = () => {
        onSave(buildColumn())
    }

    const addOption = () => {
        if (!newOption.trim() || options.includes(newOption.trim())) return
        setOptions([...options, newOption.trim()])
        setNewOption('')
    }

    const removeOption = (opt: string) => {
        setOptions(options.filter(o => o !== opt))
        const next = { ...optionColors }
        delete next[opt]
        setOptionColors(next)
    }

    const renameOption = (oldName: string, newName: string) => {
        if (options.includes(newName)) return
        setOptions(options.map(o => o === oldName ? newName : o))
        const next = { ...optionColors }
        if (next[oldName]) {
            next[newName] = next[oldName]
            delete next[oldName]
        }
        setOptionColors(next)
    }

    const setOptionColor = (opt: string, colorId: string) => {
        const next = { ...optionColors }
        if (colorId === 'default') delete next[opt]
        else next[opt] = colorId
        setOptionColors(next)
    }

    const showOptions = type === 'select' || type === 'multi-select'
    const TypeIcon = COLUMN_TYPES.find(t => t.value === type)?.Icon ?? IconLetterCase

    return createPortal(
        <>
            <div className="ldb-backdrop" onClick={handleBackdropClick} />
            <div
                className="ldb-col-editor"
                ref={popoverRef}
                tabIndex={-1}
                onKeyDown={e => { if (e.key === 'Escape') onClose() }}
                style={{
                    position: 'fixed',
                    left: pos ? pos.left : anchorRect.left,
                    top: pos ? pos.top : anchorRect.top,
                    zIndex: 9999,
                    visibility: pos ? 'visible' : 'hidden',
                }}
            >
                {/* Name row — icon + input */}
                <div className="ldb-col-editor-name-row">
                    <TypeIcon size={16} />
                    <input
                        ref={inputRef}
                        className="ldb-col-editor-name-input"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onSave(buildColumn()) }}
                        placeholder="Column name"
                    />
                </div>

                {/* Type section */}
                <label className="ldb-col-editor-section">Type</label>
                <div className="ldb-col-type-list">
                    {COLUMN_TYPES.map(t => (
                        <button
                            key={t.value}
                            className={`ldb-col-type-row ${type === t.value ? 'active' : ''}`}
                            onClick={() => setType(t.value)}
                        >
                            <t.Icon size={14} />
                            <span>{t.label}</span>
                            {type === t.value && <span className="ldb-col-type-check">✓</span>}
                        </button>
                    ))}
                </div>

                {/* Options section (select/multi-select only) */}
                {showOptions && (
                    <div className="ldb-col-options">
                        <label className="ldb-col-editor-section">Options</label>
                        <div className="ldb-col-options-list">
                            {options.map(opt => (
                                <div
                                    key={opt}
                                    className="ldb-col-option-item"
                                    ref={el => { optionRefs.current[opt] = el }}
                                >
                                    <span
                                        className="ldb-color-swatch clickable"
                                        style={{ background: TAG_COLORS.find(c => c.id === (optionColors[opt] || 'default'))?.swatch }}
                                        onClick={() => setEditingOption(editingOption === opt ? null : opt)}
                                    />
                                    <span
                                        className="ldb-tag clickable"
                                        style={tagColorStyle(optionColors[opt])}
                                        onClick={() => setEditingOption(editingOption === opt ? null : opt)}
                                    >{opt}</span>
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
                                placeholder="New option (Enter to add)"
                            />
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="ldb-col-editor-divider" />

                {onInsertLeft && (
                    <button className="ldb-col-editor-action" onClick={onInsertLeft}>
                        <IconColumnInsertLeft size={14} />
                        <span>Insert Left</span>
                    </button>
                )}
                {onInsertRight && (
                    <button className="ldb-col-editor-action" onClick={onInsertRight}>
                        <IconColumnInsertRight size={14} />
                        <span>Insert Right</span>
                    </button>
                )}
                {onDelete && (
                    <button className="ldb-col-editor-action danger" onClick={onDelete}>
                        <IconTrash size={14} />
                        <span>Delete</span>
                    </button>
                )}
            </div>

            {/* Option editor sub-popover */}
            {editingOption && optionRefs.current[editingOption] && (
                <OptionEditorPopover
                    opt={editingOption}
                    colorId={optionColors[editingOption] || 'default'}
                    anchorEl={optionRefs.current[editingOption]!}
                    onRename={renameOption}
                    onDelete={removeOption}
                    onColorChange={setOptionColor}
                    onClose={() => setEditingOption(null)}
                />
            )}
        </>,
        document.body,
    )
}
