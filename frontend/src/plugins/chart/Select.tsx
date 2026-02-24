import { useState, useRef, useEffect } from 'react'
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
    const ref = useRef<HTMLDivElement>(null)

    const selected = options.find(o => o.value === value)
    const label = selected?.label || placeholder

    // Close on outside click
    useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const sizeClass = size !== 'default' ? ` pl-sel--${size}` : ''

    return (
        <div className={`pl-sel ${className}${sizeClass}`} ref={ref}>
            <button
                className={`pl-sel-trigger ${!selected ? 'pl-sel-placeholder' : ''}`}
                onClick={() => setOpen(!open)}
                type="button"
            >
                <span className="pl-sel-text">{label}</span>
                <IconChevronDown size={10} className="pl-sel-arrow" />
            </button>
            {open && (
                <div className="pl-sel-menu">
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
            )}
        </div>
    )
}
