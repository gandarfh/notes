import { useState, useCallback, useMemo } from 'react'

// ── Presets ────────────────────────────────────────────────

const PRESETS = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 min', value: '*/5 * * * *' },
    { label: 'Every 15 min', value: '*/15 * * * *' },
    { label: 'Every 30 min', value: '*/30 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 2 hours', value: '0 */2 * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Daily at 8am', value: '0 8 * * *' },
    { label: 'Weekdays at 9am', value: '0 9 * * 1-5' },
    { label: 'Weekly (Sun)', value: '0 0 * * 0' },
    { label: 'Monthly (1st)', value: '0 0 1 * *' },
] as const

type Mode = 'preset' | 'interval' | 'custom'

function cronToHuman(expr: string): string {
    if (!expr) return ''
    const match = PRESETS.find(p => p.value === expr)
    if (match) return match.label

    const parts = expr.split(/\s+/)
    if (parts.length !== 5) return expr
    const [min, hour, dom, , dow] = parts

    if (min.startsWith('*/') && hour === '*' && dom === '*' && dow === '*')
        return `Every ${min.slice(2)} minutes`
    if (min === '0' && hour.startsWith('*/') && dom === '*' && dow === '*')
        return `Every ${hour.slice(2)} hours`
    if (!min.includes('*') && !hour.includes('*') && !hour.includes('/') && dom === '*' && dow === '*')
        return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
    if (!min.includes('*') && !hour.includes('*') && !hour.includes('/') && dom === '*' && dow === '1-5')
        return `Weekdays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
    return expr
}

// ── Component ──────────────────────────────────────────────

interface Props {
    value: string
    onChange: (expr: string) => void
}

export function CronBuilder({ value, onChange }: Props) {
    const isPreset = PRESETS.some(p => p.value === value)
    const initialMode: Mode = !value ? 'preset' : isPreset ? 'preset' : 'custom'
    const [mode, setMode] = useState<Mode>(initialMode)
    const [intervalValue, setIntervalValue] = useState(5)
    const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>('minutes')

    const humanReadable = useMemo(() => cronToHuman(value), [value])

    const handleInterval = useCallback((val: number, unit: 'minutes' | 'hours') => {
        setIntervalValue(val)
        setIntervalUnit(unit)
        onChange(unit === 'minutes' ? `*/${val} * * * *` : `0 */${val} * * *`)
    }, [onChange])

    return (
        <div className="cron-builder">
            {/* Mode tabs */}
            <div className="cron-tabs">
                {(['preset', 'interval', 'custom'] as Mode[]).map(m => (
                    <button
                        key={m}
                        className={`cron-tab ${mode === m ? 'active' : ''}`}
                        onClick={() => {
                            setMode(m)
                            if (m === 'interval') handleInterval(intervalValue, intervalUnit)
                        }}
                    >
                        {m === 'preset' ? 'Presets' : m === 'interval' ? 'Interval' : 'Custom'}
                    </button>
                ))}
            </div>

            {/* Presets */}
            {mode === 'preset' && (
                <div className="cron-presets">
                    {PRESETS.map(p => (
                        <button
                            key={p.value}
                            className={`cron-preset ${value === p.value ? 'active' : ''}`}
                            onClick={() => onChange(p.value)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Interval */}
            {mode === 'interval' && (
                <div className="pl-inline">
                    <span className="pl-kw">Every</span>
                    <input
                        type="number"
                        className="pl-input pl-input-num"
                        min={1}
                        max={intervalUnit === 'minutes' ? 59 : 23}
                        value={intervalValue}
                        onChange={e => handleInterval(parseInt(e.target.value) || 1, intervalUnit)}
                    />
                    <select
                        className="pl-input"
                        style={{ flex: 'none', width: 'auto' }}
                        value={intervalUnit}
                        onChange={e => handleInterval(intervalValue, e.target.value as 'minutes' | 'hours')}
                    >
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                    </select>
                </div>
            )}

            {/* Custom */}
            {mode === 'custom' && (
                <div className="cron-custom">
                    <input
                        className="pl-input"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        placeholder="* * * * *"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace', letterSpacing: 2 }}
                    />
                    <div className="cron-field-labels">
                        <span>min</span><span>hour</span><span>day</span><span>month</span><span>weekday</span>
                    </div>
                </div>
            )}

            {/* Summary */}
            {value && (
                <div className="cron-summary">
                    <span className="cron-summary-text">⏱ {humanReadable}</span>
                    <code className="cron-summary-expr">{value}</code>
                </div>
            )}
        </div>
    )
}
