import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown } from '@tabler/icons-react'

// ── Custom Select ──────────────────────────────────────────

interface Option {
    value: string
    label: string
}

interface SelectProps {
    value: string
    options: Option[]
    placeholder?: string
    onChange: (value: string) => void
    className?: string
    size?: 'default' | 'sm' | 'xs'
}

export function Select({ value, options, placeholder = 'Select…', onChange, className = '', size = 'default' }: SelectProps) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

    const selected = options.find(o => o.value === value)
    const label = selected?.label || placeholder

    // Compute position when opening
    useEffect(() => {
        if (!open || !triggerRef.current) return
        const rect = triggerRef.current.getBoundingClientRect()
        setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 120) })
    }, [open])

    const sizeClass = size !== 'default' ? ` pl-sel--${size}` : ''

    return (
        <div className={`pl-sel ${className}${sizeClass}`} ref={triggerRef}>
            <button
                className={`pl-sel-trigger ${!selected ? 'pl-sel-placeholder' : ''}`}
                onClick={() => setOpen(!open)}
                type="button"
            >
                <span className="pl-sel-text">{label}</span>
                <IconChevronDown size={10} className="pl-sel-arrow" />
            </button>
            {open && pos && createPortal(
                <>
                    {/* Invisible backdrop — catches any click outside the menu */}
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className="pl-sel-menu"
                        style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
                    >
                        {placeholder && (
                            <div
                                className={`pl-sel-option ${!value ? 'active' : ''}`}
                                onClick={() => { onChange(''); setOpen(false) }}
                            >
                                {placeholder}
                            </div>
                        )}
                        {options.map(opt => (
                            <div
                                key={opt.value}
                                className={`pl-sel-option ${opt.value === value ? 'active' : ''}`}
                                onClick={() => { onChange(opt.value); setOpen(false) }}
                            >
                                {opt.label}
                            </div>
                        ))}
                    </div>
                </>,
                document.body
            )}
        </div>
    )
}
