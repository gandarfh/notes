// ═══════════════════════════════════════════════════════════
// useEditableTitle — double-click title editing pattern
// ═══════════════════════════════════════════════════════════

import { useState, useCallback, useRef } from 'react'

/**
 * Hook for the double-click-to-edit title pattern.
 * Used by: localdb, chart, etl.
 *
 * @example
 * const title = useEditableTitle(config.title, (t) => updateConfig({ title: t }))
 *
 * {title.editing ? (
 *   <input {...title.inputProps} />
 * ) : (
 *   <span onDoubleClick={title.startEditing}>{title.display}</span>
 * )}
 */
export function useEditableTitle(
    initialTitle: string,
    onSave: (title: string) => void,
) {
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState(initialTitle)
    const inputRef = useRef<HTMLInputElement>(null)

    // Sync when initialTitle changes externally
    const lastInitial = useRef(initialTitle)
    if (initialTitle !== lastInitial.current) {
        lastInitial.current = initialTitle
        if (!editing) setValue(initialTitle)
    }

    const startEditing = useCallback(() => {
        setEditing(true)
        setValue(initialTitle)
        setTimeout(() => inputRef.current?.select(), 0)
    }, [initialTitle])

    const handleBlur = useCallback(() => {
        setEditing(false)
        const trimmed = value.trim()
        if (trimmed && trimmed !== initialTitle) {
            onSave(trimmed)
        } else {
            setValue(initialTitle)
        }
    }, [value, initialTitle, onSave])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            ; (e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
            setEditing(false)
            setValue(initialTitle)
        }
    }, [initialTitle])

    return {
        editing,
        display: value || initialTitle,
        startEditing,
        inputProps: {
            ref: inputRef,
            value,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
            onBlur: handleBlur,
            onKeyDown: handleKeyDown,
            autoFocus: true as const,
        },
    }
}
