import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { remapForTheme } from '../../drawing/canvasRender'

// ── Color palette (Excalidraw-inspired) ──────────────────────

const PALETTE: string[][] = [
    // Row 1: grayscale
    ['#1e1e2e', '#545475', '#828298', '#bfbfcf', '#e8e8f0'],
    // Row 2: vivid colors
    ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#9c36b5'],
    // Row 3: pastel/soft
    ['#ffc9c9', '#ffec99', '#b2f2bb', '#a5d8ff', '#eebefa'],
]

/** Generate 5 shades of a base color (lighter → darker) */
function generateShades(hex: string): string[] {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)

    return [0.3, 0.5, 0.7, 0.85, 1.0].map(factor => {
        // Mix with white for lighter shades  
        const nr = Math.round(255 - (255 - r) * factor)
        const ng = Math.round(255 - (255 - g) * factor)
        const nb = Math.round(255 - (255 - b) * factor)
        return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
    })
}

// ── Component ────────────────────────────────────────────────

interface ColorPickerProps {
    color: string
    onChange: (color: string) => void
    /** 'stroke' shows dark swatch border; 'bg' adds transparent option */
    variant?: 'stroke' | 'bg'
}

export function ColorPicker({ color, onChange, variant = 'stroke' }: ColorPickerProps) {
    const [open, setOpen] = useState(false)
    const [hexInput, setHexInput] = useState(color.replace('#', ''))
    const [shadesFor, setShadesFor] = useState<string | null>(null)
    const [popoverPos, setPopoverPos] = useState<{ bottom: number; right: number }>({ bottom: 0, right: 0 })
    const popoverRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLLabelElement>(null)

    // Sync hex input when color changes externally
    useEffect(() => { setHexInput(color.replace('#', '')) }, [color])

    // Close on outside click
    useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                btnRef.current && !btnRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const selectColor = useCallback((c: string) => {
        onChange(c)
        setHexInput(c.replace('#', ''))
    }, [onChange])

    const commitHex = useCallback(() => {
        const clean = hexInput.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
        if (clean.length === 3 || clean.length === 6) {
            const full = clean.length === 3
                ? `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
                : `#${clean}`
            onChange(full)
        }
    }, [hexInput, onChange])

    // Find which palette color to show shades for
    const allColors = PALETTE.flat()
    const activeShadesColor = shadesFor ?? (allColors.includes(color) ? color : null)
    const shades = activeShadesColor ? generateShades(activeShadesColor) : null

    return (
        <div className="cp-wrapper">
            <label
                ref={btnRef}
                className="sp-swatch sp-swatch-custom"
                title="Custom color"
                onClick={(e) => {
                    e.preventDefault()
                    if (!open && btnRef.current) {
                        const rect = btnRef.current.getBoundingClientRect()
                        setPopoverPos({
                            bottom: window.innerHeight - rect.top + 8,
                            right: window.innerWidth - rect.right - 8,
                        })
                    }
                    setOpen(!open)
                }}
            >
                <span style={{ background: remapForTheme(color) }} />
            </label>

            {open && createPortal(
                <div
                    ref={popoverRef}
                    className="cp-popover"
                    style={{ bottom: popoverPos.bottom, right: popoverPos.right }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    {/* Color Grid */}
                    <span className="cp-label">Colors</span>
                    <div className="cp-grid">
                        {PALETTE.map((row, ri) => (
                            <div key={ri} className="cp-row">
                                {row.map(c => (
                                    <button
                                        key={c}
                                        className={`cp-cell ${color === c ? 'active' : ''}`}
                                        style={{ background: remapForTheme(c) }}
                                        onClick={() => { selectColor(c); setShadesFor(c) }}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>

                    {/* Shades */}
                    <span className="cp-label">Shades</span>
                    {shades ? (
                        <div className="cp-shades">
                            {shades.map((s, i) => (
                                <button
                                    key={i}
                                    className={`cp-cell ${color === s ? 'active' : ''}`}
                                    style={{ background: s }}
                                    onClick={() => selectColor(s)}
                                />
                            ))}
                        </div>
                    ) : (
                        <span className="cp-hint">Select a color above</span>
                    )}

                    {/* Hex Input */}
                    <span className="cp-label">Hex code</span>
                    <div className="cp-hex-row">
                        <span className="cp-hash">#</span>
                        <input
                            className="cp-hex-input"
                            value={hexInput}
                            maxLength={6}
                            onChange={e => setHexInput(e.target.value)}
                            onBlur={commitHex}
                            onKeyDown={e => { if (e.key === 'Enter') commitHex() }}
                        />
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
