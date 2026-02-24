import type { ChartType } from './ChartRenderer'
import {
    IconChartBar,
    IconChartHistogram,
    IconChartArrowsVertical,
    IconChartLine,
    IconChartArrows,
    IconChartArea,
    IconChartAreaLine,
    IconChartPie,
    IconChartDonut,
    IconChartFunnel,
    IconChartTreemap,
    IconChartDots,
    IconChartRadar,
    IconChartArcs,
    IconChartInfographic,
    IconHash,
    IconChartColumn,
} from '@tabler/icons-react'
import type { ComponentType } from 'react'

// ── Chart Type Picker ──────────────────────────────────────

interface ChartTypePickerProps {
    value: ChartType
    onChange: (type: ChartType) => void
}

const ICON_SIZE = 18

const CHART_TYPES: { type: ChartType; label: string; Icon: ComponentType<{ size?: number }> }[] = [
    { type: 'bar', label: 'Bar', Icon: IconChartBar },
    { type: 'stackedBar', label: 'Stacked', Icon: IconChartHistogram },
    { type: 'horizontalBar', label: 'H-Bar', Icon: IconChartArrowsVertical },
    { type: 'line', label: 'Line', Icon: IconChartLine },
    { type: 'stepLine', label: 'Step', Icon: IconChartArrows },
    { type: 'area', label: 'Area', Icon: IconChartArea },
    { type: 'stackedArea', label: 'S-Area', Icon: IconChartAreaLine },
    { type: 'composed', label: 'Composed', Icon: IconChartColumn },
    { type: 'waterfall', label: 'Waterfall', Icon: IconChartInfographic },
    { type: 'pie', label: 'Pie', Icon: IconChartPie },
    { type: 'donut', label: 'Donut', Icon: IconChartDonut },
    { type: 'funnel', label: 'Funnel', Icon: IconChartFunnel },
    { type: 'treemap', label: 'Treemap', Icon: IconChartTreemap },
    { type: 'number', label: 'Number', Icon: IconHash },
    { type: 'scatter', label: 'Scatter', Icon: IconChartDots },
    { type: 'radar', label: 'Radar', Icon: IconChartRadar },
    { type: 'radialBar', label: 'Gauge', Icon: IconChartArcs },
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
                    <ct.Icon size={ICON_SIZE} />
                    <span className="chart-type-label">{ct.label}</span>
                </button>
            ))}
        </div>
    )
}
