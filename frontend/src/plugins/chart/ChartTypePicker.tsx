import type { ChartType } from './ChartRenderer'

// ── Chart Type Picker ──────────────────────────────────────
// Visual grid for switching chart types.

interface ChartTypePickerProps {
    value: ChartType
    onChange: (type: ChartType) => void
}

const CHART_TYPES: { type: ChartType; label: string; icon: string }[] = [
    { type: 'bar', label: 'Bar', icon: '▌▊▎' },
    { type: 'line', label: 'Line', icon: '📈' },
    { type: 'area', label: 'Area', icon: '▓░' },
    { type: 'pie', label: 'Pie', icon: '◔' },
    { type: 'donut', label: 'Donut', icon: '◎' },
    { type: 'scatter', label: 'Scatter', icon: '⁙' },
    { type: 'radar', label: 'Radar', icon: '⬡' },
    { type: 'radialBar', label: 'Gauge', icon: '◐' },
]

export function ChartTypePicker({ value, onChange }: ChartTypePickerProps) {
    return (
        <div className="chart-type-picker">
            {CHART_TYPES.map(ct => (
                <button
                    key={ct.type}
                    className={`chart-type-btn ${value === ct.type ? 'active' : ''}`}
                    onClick={() => onChange(ct.type)}
                    title={ct.label}
                >
                    <span className="chart-type-icon">{ct.icon}</span>
                    <span className="chart-type-label">{ct.label}</span>
                </button>
            ))}
        </div>
    )
}
