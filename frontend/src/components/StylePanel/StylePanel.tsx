import type { DrawingElement } from '../../drawing/types'
import { isArrowType } from '../../drawing/types'
import { useAppStore } from '../../store'

// ── Color presets ──
const STROKE_COLORS = [
    '#1e1e2e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#e8e8f0',
]
const BG_COLORS = [
    'transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#343446',
]

const FONTS = [
    { label: 'Sans', value: 'Inter' },
    { label: 'Mono', value: 'JetBrains Mono, monospace' },
    { label: 'Serif', value: 'Georgia, serif' },
    { label: 'Hand', value: 'Caveat, cursive' },
]

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

const ARROW_HEADS: { value: string; label: string; icon: React.ReactNode }[] = [
    { value: 'none', label: 'None', icon: <line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.4" /> },
    { value: 'arrow', label: 'Arrow', icon: <><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.4" /><polygon points="16,10 11,7 11,13" fill="currentColor" /></> },
    //  { value: 'triangle', label: 'Triangle', icon: <><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.4" /><polygon points="16,10 11,7 11,13" fill="none" stroke="currentColor" strokeWidth="1" /></> },
    { value: 'dot', label: 'Dot', icon: <><line x1="4" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.4" /><circle cx="15" cy="10" r="3" fill="currentColor" /></> },
    //  { value: 'bar', label: 'Bar', icon: <><line x1="4" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.4" /><line x1="15" y1="6" x2="15" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></> },
    //  { value: 'diamond', label: 'Diamond', icon: <><line x1="4" y1="10" x2="11" y2="10" stroke="currentColor" strokeWidth="1.4" /><polygon points="15,10 13,7.5 11,10 13,12.5" fill="currentColor" /></> },
]

// ── Exported types ──
export type AlignAction =
    | 'align-left' | 'align-center-h' | 'align-right'
    | 'align-top' | 'align-center-v' | 'align-bottom'
    | 'distribute-h' | 'distribute-v'

export type ReorderAction = 'toBack' | 'backward' | 'forward' | 'toFront'

interface Props {
    elements: DrawingElement[]
    onUpdate: (patch: Partial<DrawingElement>) => void
    onReorder?: (action: ReorderAction) => void
    onAlign?: (action: AlignAction) => void
    multiSelected?: boolean
}

function getCommon<K extends keyof DrawingElement>(els: DrawingElement[], key: K): DrawingElement[K] | undefined {
    if (els.length === 0) return undefined
    const val = els[0][key]
    return els.every(e => e[key] === val) ? val : undefined
}

const I = ({ children, ...p }: { children: React.ReactNode } & React.SVGProps<SVGSVGElement>) => (
    <svg width="20" height="20" viewBox="0 0 20 20" {...p}>{children}</svg>
)

// ═══════════════════════════════════════════════════════════════
// Panel 1: Element Design (bottom-center, top row)
//
// Each section = title line + one row of values below
// Grouped: [Stroke colors] | [Background colors] | [Stroke: width/style/fill/edges] | [Arrows]
// ═══════════════════════════════════════════════════════════════

function ElementPanel({ elements, onUpdate }: { elements: DrawingElement[]; onUpdate: Props['onUpdate'] }) {
    const types = new Set(elements.map(e => e.type))
    const hasShapes = types.has('rectangle') || types.has('ellipse') || types.has('diamond')
    const hasRect = types.has('rectangle')
    const hasArrows = types.has('arrow') || types.has('ortho-arrow')

    const strokeColor = getCommon(elements, 'strokeColor') ?? '#e8e8f0'
    const strokeWidth = getCommon(elements, 'strokeWidth') ?? 2
    const bgColor = getCommon(elements, 'backgroundColor') ?? 'transparent'
    const borderRadius = getCommon(elements, 'borderRadius') ?? 0
    const fillStyle = getCommon(elements, 'fillStyle') ?? 'hachure'
    const arrowStart = getCommon(elements, 'arrowStart') ?? 'none'
    const arrowEnd = getCommon(elements, 'arrowEnd') ?? 'arrow'
    const strokeDash = getCommon(elements, 'strokeDasharray') ?? ''
    const boardStyle = useAppStore(s => s.boardStyle)

    return (
        <div className="sp-row">
            {/* Stroke Color */}
            <div className="sp-section">
                <span className="sp-title">Stroke</span>
                <div className="sp-swatches">
                    {STROKE_COLORS.map(c => (
                        <button key={c} className={`sp-swatch ${strokeColor === c ? 'active' : ''}`}
                            style={{ background: c, border: c === '#1e1e2e' ? '1px solid var(--color-border-strong)' : undefined }}
                            onClick={() => onUpdate({ strokeColor: c })} />
                    ))}
                    <label className="sp-swatch sp-swatch-custom" title="Custom color">
                        <input type="color" value={strokeColor} onChange={e => onUpdate({ strokeColor: e.target.value })} />
                        <span style={{ background: strokeColor }} />
                    </label>
                </div>
            </div>

            {/* Background */}
            {hasShapes && (
                <div className="sp-section">
                    <span className="sp-title">Background</span>
                    <div className="sp-swatches">
                        {BG_COLORS.map(c => (
                            <button key={c} className={`sp-swatch ${bgColor === c ? 'active' : ''} ${c === 'transparent' ? 'sp-swatch-none' : ''}`}
                                style={{ background: c === 'transparent' ? undefined : c }}
                                onClick={() => onUpdate({ backgroundColor: c })} />
                        ))}
                        <label className="sp-swatch sp-swatch-custom" title="Custom color">
                            <input type="color" value={bgColor === 'transparent' ? '#343446' : bgColor} onChange={e => onUpdate({ backgroundColor: e.target.value })} />
                            <span style={{ background: bgColor === 'transparent' ? 'transparent' : bgColor }} />
                        </label>
                    </div>
                </div>
            )}

            {/* Stroke options: width + style + fill + edges — all combined */}
            <div className="sp-section">
                <span className="sp-title">Stroke</span>
                <div className="sp-options">
                    {/* Width */}
                    {([1, 2, 4] as const).map(w => (
                        <button key={w} className={`sp-opt-btn ${strokeWidth === w ? 'active' : ''}`} onClick={() => onUpdate({ strokeWidth: w })} title={`${w}px`}>
                            <I><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth={w} strokeLinecap="round" /></I>
                        </button>
                    ))}
                    <span className="sp-divider" />
                    {/* Style */}
                    <button className={`sp-opt-btn ${!strokeDash ? 'active' : ''}`} onClick={() => onUpdate({ strokeDasharray: '' })} title="Solid">
                        <I><line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></I>
                    </button>
                    <button className={`sp-opt-btn ${strokeDash === '8 4' ? 'active' : ''}`} onClick={() => onUpdate({ strokeDasharray: '8 4' })} title="Dashed">
                        <I><line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 3" strokeLinecap="round" /></I>
                    </button>
                    <button className={`sp-opt-btn ${strokeDash === '2 4' ? 'active' : ''}`} onClick={() => onUpdate({ strokeDasharray: '2 4' })} title="Dotted">
                        <I><line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="2" strokeDasharray="1.5 3.5" strokeLinecap="round" /></I>
                    </button>
                    {/* Fill (sketchy only) */}
                    {hasShapes && boardStyle === 'sketchy' && (<>
                        <span className="sp-divider" />
                        <button className={`sp-opt-btn ${fillStyle === 'solid' ? 'active' : ''}`} onClick={() => onUpdate({ fillStyle: 'solid' })} title="Solid fill">
                            <I><rect x="3" y="5" width="14" height="10" fill="currentColor" opacity="0.25" rx="1" /><rect x="3" y="5" width="14" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" rx="1" /></I>
                        </button>
                        <button className={`sp-opt-btn ${fillStyle === 'hachure' ? 'active' : ''}`} onClick={() => onUpdate({ fillStyle: 'hachure' })} title="Hachure fill">
                            <I><rect x="3" y="5" width="14" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" rx="1" />
                                <line x1="6" y1="5" x2="3" y2="12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                                <line x1="10" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                                <line x1="14" y1="5" x2="9" y2="15" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                            </I>
                        </button>
                    </>)}
                    {/* Edges */}
                    {hasRect && (<>
                        <span className="sp-divider" />
                        {([{ v: 0, title: 'Sharp' }, { v: 8, title: 'Round' }] as const).map(r => (
                            <button key={r.v} className={`sp-opt-btn ${borderRadius === r.v ? 'active' : ''}`}
                                onClick={() => onUpdate({ borderRadius: r.v, roundness: r.v > 0 })} title={r.title}>
                                <I><rect x="3" y="3" width="14" height="14" rx={Math.min(r.v, 7)} fill="none" stroke="currentColor" strokeWidth="1.4" /></I>
                            </button>
                        ))}
                    </>)}
                </div>
            </div>

            {/* Arrowheads: Start + End in one section */}
            {hasArrows && (
                <div className="sp-section">
                    <span className="sp-title">Arrows</span>
                    <div className="sp-options sp-arrow-opts">
                        {ARROW_HEADS.map(h => (
                            <button key={'s' + h.value} className={`sp-opt-btn ${arrowStart === h.value ? 'active' : ''}`}
                                onClick={() => onUpdate({ arrowStart: h.value as any })} title={`Start: ${h.label}`}>
                                <I style={{ transform: 'scaleX(-1)' }}>{h.icon}</I>
                            </button>
                        ))}
                        <span className="sp-divider" />
                        {ARROW_HEADS.map(h => (
                            <button key={'e' + h.value} className={`sp-opt-btn ${arrowEnd === h.value ? 'active' : ''}`}
                                onClick={() => onUpdate({ arrowEnd: h.value as any })} title={`End: ${h.label}`}>
                                <I>{h.icon}</I>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════
// Panel 2: Text Design (bottom-center, second row)
//
// [Font family] | [Size ± & Weight] | [Align H+V] | [Text color]
// ═══════════════════════════════════════════════════════════════

function TextPanel({ elements, onUpdate }: { elements: DrawingElement[]; onUpdate: Props['onUpdate'] }) {
    const fontSize = getCommon(elements, 'fontSize') ?? 14
    const fontFamily = getCommon(elements, 'fontFamily') ?? 'Inter'
    const fontWeight = getCommon(elements, 'fontWeight') ?? 400
    const textColor = getCommon(elements, 'textColor') ?? getCommon(elements, 'strokeColor') ?? '#e8e8f0'
    const textAlign = getCommon(elements, 'textAlign') ?? 'center'
    const verticalAlign = getCommon(elements, 'verticalAlign') ?? 'center'

    return (
        <div className="sp-row">
            {/* Font Family */}
            <div className="sp-section">
                <span className="sp-title">Font</span>
                <div className="sp-options sp-font-row">
                    {FONTS.map(f => (
                        <button key={f.value} className={`sp-opt-btn sp-font-btn ${fontFamily === f.value ? 'active' : ''}`}
                            style={{ fontFamily: f.value }} onClick={() => onUpdate({ fontFamily: f.value })}>
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Size + Weight combined */}
            <div className="sp-section">
                <span className="sp-title">Size</span>
                <div className="sp-options">
                    <button className="sp-opt-btn" onClick={() => {
                        const idx = FONT_SIZES.indexOf(fontSize as number)
                        if (idx > 0) onUpdate({ fontSize: FONT_SIZES[idx - 1] })
                        else { const s = FONT_SIZES.filter(s => s < (fontSize as number)); if (s.length) onUpdate({ fontSize: s[s.length - 1] }) }
                    }}>−</button>
                    <span className="sp-font-size-val">{fontSize}</span>
                    <button className="sp-opt-btn" onClick={() => {
                        const idx = FONT_SIZES.indexOf(fontSize as number)
                        if (idx >= 0 && idx < FONT_SIZES.length - 1) onUpdate({ fontSize: FONT_SIZES[idx + 1] })
                        else { const s = FONT_SIZES.filter(s => s > (fontSize as number)); if (s.length) onUpdate({ fontSize: s[0] }) }
                    }}>+</button>
                    <span className="sp-divider" />
                    {([{ v: 400, label: 'N' }, { v: 500, label: 'M' }, { v: 700, label: 'B' }] as const).map(w => (
                        <button key={w.v} className={`sp-opt-btn ${fontWeight === w.v ? 'active' : ''}`}
                            style={{ fontWeight: w.v }} onClick={() => onUpdate({ fontWeight: w.v })}
                            title={w.v === 400 ? 'Normal' : w.v === 500 ? 'Medium' : 'Bold'}>{w.label}</button>
                    ))}
                </div>
            </div>

            {/* Text Align H + V combined */}
            <div className="sp-section">
                <span className="sp-title">Align</span>
                <div className="sp-options">
                    {([
                        { v: 'left', icon: <><line x1="4" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.4" /><line x1="4" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1.4" /><line x1="4" y1="15" x2="14" y2="15" stroke="currentColor" strokeWidth="1.4" /></> },
                        { v: 'center', icon: <><line x1="4" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.4" /><line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.4" /><line x1="5" y1="15" x2="15" y2="15" stroke="currentColor" strokeWidth="1.4" /></> },
                        { v: 'right', icon: <><line x1="4" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.4" /><line x1="8" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.4" /><line x1="6" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.4" /></> },
                    ] as const).map(a => (
                        <button key={a.v} className={`sp-opt-btn ${textAlign === a.v ? 'active' : ''}`}
                            onClick={() => onUpdate({ textAlign: a.v })} title={a.v}><I>{a.icon}</I></button>
                    ))}
                    <span className="sp-divider" />
                    {([
                        { v: 'top', icon: <><line x1="4" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="1.4" /><line x1="8" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="1.2" opacity="0.5" /><line x1="7" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.2" opacity="0.3" /></> },
                        { v: 'center', icon: <><line x1="7" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.2" opacity="0.5" /><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.4" /><line x1="7" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="1.2" opacity="0.5" /></> },
                        { v: 'bottom', icon: <><line x1="7" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.2" opacity="0.3" /><line x1="8" y1="12" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" opacity="0.5" /><line x1="4" y1="16" x2="16" y2="16" stroke="currentColor" strokeWidth="1.4" /></> },
                    ] as const).map(a => (
                        <button key={a.v} className={`sp-opt-btn ${verticalAlign === a.v ? 'active' : ''}`}
                            onClick={() => onUpdate({ verticalAlign: a.v })} title={a.v}><I>{a.icon}</I></button>
                    ))}
                </div>
            </div>

            {/* Text Color */}
            <div className="sp-section">
                <span className="sp-title">Color</span>
                <div className="sp-swatches">
                    {STROKE_COLORS.map(c => (
                        <button key={c} className={`sp-swatch ${textColor === c ? 'active' : ''}`}
                            style={{ background: c, border: c === '#1e1e2e' ? '1px solid var(--color-border-strong)' : undefined }}
                            onClick={() => onUpdate({ textColor: c })} />
                    ))}
                    <label className="sp-swatch sp-swatch-custom" title="Custom color">
                        <input type="color" value={textColor} onChange={e => onUpdate({ textColor: e.target.value })} />
                        <span style={{ background: textColor }} />
                    </label>
                </div>
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════
// Panel 3: Utility (bottom-right, single column)
// ═══════════════════════════════════════════════════════════════

function UtilityPanel({ elements, onUpdate, onReorder, onAlign, multiSelected }: Props) {
    const opacity = getCommon(elements, 'opacity') ?? 1

    return (
        <div className="sp-utility" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            {/* Opacity */}
            <div className="sp-util-group">
                <span className="sp-title">Opacity</span>
                <div className="sp-opacity-col">
                    <span className="sp-opacity-val">{Math.round(opacity * 100)}</span>
                    <input type="range" min="10" max="100" step="5"
                        value={Math.round(opacity * 100)}
                        onChange={e => onUpdate({ opacity: Number(e.target.value) / 100 })}
                        className="sp-range-v" />
                </div>
            </div>

            {/* Layers — 2x2 grid */}
            {onReorder && (
                <div className="sp-util-group">
                    <span className="sp-title">Layers</span>
                    <div className="sp-grid-2x2">
                        <button className="sp-opt-btn" onClick={() => onReorder('toFront')} title="Bring to front">
                            <I><path d="M10 4L4 8M10 4L16 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /><path d="M10 8L4 12M10 8L16 12" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.5" /><path d="M10 12L4 16M10 12L16 16" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.3" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onReorder('forward')} title="Bring forward">
                            <I><path d="M10 6L5 10M10 6L15 10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /><path d="M10 11L5 15M10 11L15 15" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.4" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onReorder('backward')} title="Send backward">
                            <I><path d="M10 14L5 10M10 14L15 10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /><path d="M10 9L5 5M10 9L15 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.4" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onReorder('toBack')} title="Send to back">
                            <I><path d="M10 16L4 12M10 16L16 12" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /><path d="M10 12L4 8M10 12L16 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.5" /><path d="M10 8L4 4M10 8L16 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.3" /></I>
                        </button>
                    </div>
                </div>
            )}

            {/* Multi-Element Alignment — 2-col grid */}
            {multiSelected && onAlign && (
                <div className="sp-util-group">
                    <span className="sp-title">Align</span>
                    <div className="sp-grid-2x2">
                        <button className="sp-opt-btn" onClick={() => onAlign('align-left')} title="Align left">
                            <I><line x1="4" y1="3" x2="4" y2="17" stroke="currentColor" strokeWidth="1.6" /><rect x="6" y="5" width="8" height="3" fill="currentColor" rx="1" /><rect x="6" y="12" width="5" height="3" fill="currentColor" rx="1" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onAlign('align-right')} title="Align right">
                            <I><line x1="16" y1="3" x2="16" y2="17" stroke="currentColor" strokeWidth="1.6" /><rect x="6" y="5" width="8" height="3" fill="currentColor" rx="1" /><rect x="9" y="12" width="5" height="3" fill="currentColor" rx="1" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onAlign('align-top')} title="Align top">
                            <I><line x1="3" y1="4" x2="17" y2="4" stroke="currentColor" strokeWidth="1.6" /><rect x="5" y="6" width="3" height="8" fill="currentColor" rx="1" /><rect x="12" y="6" width="3" height="5" fill="currentColor" rx="1" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onAlign('align-bottom')} title="Align bottom">
                            <I><line x1="3" y1="16" x2="17" y2="16" stroke="currentColor" strokeWidth="1.6" /><rect x="5" y="6" width="3" height="8" fill="currentColor" rx="1" /><rect x="12" y="9" width="3" height="5" fill="currentColor" rx="1" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onAlign('align-center-h')} title="Center horizontal">
                            <I><line x1="10" y1="3" x2="10" y2="17" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" /><rect x="5" y="5" width="10" height="3" fill="currentColor" rx="1" /><rect x="7" y="12" width="6" height="3" fill="currentColor" rx="1" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onAlign('align-center-v')} title="Center vertical">
                            <I><line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" /><rect x="5" y="5" width="3" height="10" fill="currentColor" rx="1" /><rect x="12" y="7" width="3" height="6" fill="currentColor" rx="1" /></I>
                        </button>
                    </div>
                    <div className="sp-grid-2x2">
                        <button className="sp-opt-btn" onClick={() => onAlign('distribute-h')} title="Distribute horizontal">
                            <I><rect x="2" y="6" width="3" height="8" fill="currentColor" rx="1" /><rect x="8.5" y="6" width="3" height="8" fill="currentColor" rx="1" /><rect x="15" y="6" width="3" height="8" fill="currentColor" rx="1" /></I>
                        </button>
                        <button className="sp-opt-btn" onClick={() => onAlign('distribute-v')} title="Distribute vertical">
                            <I><rect x="6" y="2" width="8" height="3" fill="currentColor" rx="1" /><rect x="6" y="8.5" width="8" height="3" fill="currentColor" rx="1" /><rect x="6" y="15" width="8" height="3" fill="currentColor" rx="1" /></I>
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════
// Main StylePanel — composes the 3 sub-panels
// ═══════════════════════════════════════════════════════════════

export function StylePanel({ elements, onUpdate, onReorder, onAlign, multiSelected }: Props) {
    if (elements.length === 0) return null

    const hasText = new Set(elements.map(e => e.type)).has('text') || elements.some(e => e.text || e.label)

    return (
        <>
            {/* Two horizontal bars stacked at bottom-center */}
            <div className="style-panel" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                <ElementPanel elements={elements} onUpdate={onUpdate} />
                {hasText && <TextPanel elements={elements} onUpdate={onUpdate} />}
            </div>

            {/* Utility panel at bottom-right (vertical) */}
            <UtilityPanel elements={elements} onUpdate={onUpdate} onReorder={onReorder} onAlign={onAlign} multiSelected={multiSelected} />
        </>
    )
}
