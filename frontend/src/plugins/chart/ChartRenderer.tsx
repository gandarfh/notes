import { useMemo } from 'react'
import {
    ResponsiveContainer,
    BarChart, Bar,
    LineChart, Line,
    AreaChart, Area,
    PieChart, Pie, Cell,
    ScatterChart, Scatter,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    RadialBarChart, RadialBar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

// ── Types ──────────────────────────────────────────────────

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'radar' | 'radialBar'

export interface SeriesDef {
    key: string
    color: string
    name: string
}

export interface DataPoint {
    name: string
    [key: string]: string | number
}

export interface ChartConfig {
    chartType: ChartType
    title: string
    data: DataPoint[]
    series: SeriesDef[]
    options: {
        showGrid?: boolean
        showLegend?: boolean
        showTooltip?: boolean
        stacked?: boolean
        animate?: boolean
    }
}

// ── Color palette ──────────────────────────────────────────

const COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a855f7',
]

// ── Default config ─────────────────────────────────────────

export function defaultConfig(): ChartConfig {
    return {
        chartType: 'bar',
        title: 'Chart',
        data: [
            { name: 'Jan', value: 40 },
            { name: 'Feb', value: 55 },
            { name: 'Mar', value: 35 },
            { name: 'Apr', value: 70 },
            { name: 'May', value: 50 },
        ],
        series: [{ key: 'value', color: COLORS[0], name: 'Value' }],
        options: {
            showGrid: true,
            showLegend: true,
            showTooltip: true,
            stacked: false,
            animate: true,
        },
    }
}

// ── Renderer ───────────────────────────────────────────────

interface ChartRendererProps {
    config: ChartConfig
}

export function ChartRenderer({ config }: ChartRendererProps) {
    const { chartType, data, series, options } = config
    const animate = options.animate !== false

    const tooltipStyle = useMemo(() => ({
        contentStyle: {
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 6,
            fontSize: 11,
            padding: '6px 10px',
        },
    }), [])

    const renderCartesian = (ChartComp: typeof BarChart, DataComp: typeof Bar, type: 'bar' | 'line' | 'area') => (
        <ResponsiveContainer width="100%" height="100%">
            <ChartComp data={data}>
                {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                {options.showTooltip && <Tooltip {...tooltipStyle} />}
                {options.showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
                {series.map((s, i) => {
                    const color = s.color || COLORS[i % COLORS.length]
                    const props: Record<string, unknown> = {
                        key: s.key,
                        dataKey: s.key,
                        name: s.name,
                        isAnimationActive: animate,
                        stackId: options.stacked ? 'stack' : undefined,
                    }
                    if (type === 'bar') {
                        return <Bar {...props} fill={color} radius={[3, 3, 0, 0]} />
                    } else if (type === 'area') {
                        return <Area {...props} dataKey={s.key} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
                    } else {
                        return <Line {...props} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
                    }
                })}
            </ChartComp>
        </ResponsiveContainer>
    )

    const renderPie = (donut: boolean) => {
        const mainKey = series[0]?.key || 'value'
        return (
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={data}
                        dataKey={mainKey}
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={donut ? '50%' : 0}
                        outerRadius="75%"
                        isAnimationActive={animate}
                        label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={10}
                    >
                        {data.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                    </Pie>
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    {options.showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
                </PieChart>
            </ResponsiveContainer>
        )
    }

    const renderRadar = () => {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={data}>
                    <PolarGrid stroke="var(--color-border-subtle)" />
                    {/* @ts-ignore Recharts type compat */}
                    <PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                    {/* @ts-ignore Recharts type compat */}
                    <PolarRadiusAxis tick={{ fontSize: 9 }} />
                    {series.map((s, i) => (
                        <Radar
                            key={s.key}
                            dataKey={s.key}
                            name={s.name}
                            stroke={s.color || COLORS[i % COLORS.length]}
                            fill={s.color || COLORS[i % COLORS.length]}
                            fillOpacity={0.2}
                            isAnimationActive={animate}
                        />
                    ))}
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    {options.showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
                </RadarChart>
            </ResponsiveContainer>
        )
    }

    const renderRadialBar = () => {
        const mainKey = series[0]?.key || 'value'
        return (
            <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                    innerRadius="20%"
                    outerRadius="90%"
                    data={data.map((d, i) => ({ ...d, fill: COLORS[i % COLORS.length] }))}
                >
                    <RadialBar
                        dataKey={mainKey}
                        isAnimationActive={animate}
                        label={{ position: 'insideStart', fill: '#fff', fontSize: 10 }}
                    />
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    {options.showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
                </RadialBarChart>
            </ResponsiveContainer>
        )
    }

    const renderScatter = () => {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                    {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" name="Name" />
                    <YAxis dataKey={series[0]?.key || 'value'} tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    <Scatter
                        data={data}
                        fill={series[0]?.color || COLORS[0]}
                        isAnimationActive={animate}
                    />
                </ScatterChart>
            </ResponsiveContainer>
        )
    }

    switch (chartType) {
        case 'bar': return renderCartesian(BarChart as any, Bar as any, 'bar')
        case 'line': return renderCartesian(LineChart as any, Line as any, 'line')
        case 'area': return renderCartesian(AreaChart as any, Area as any, 'area')
        case 'pie': return renderPie(false)
        case 'donut': return renderPie(true)
        case 'radar': return renderRadar()
        case 'radialBar': return renderRadialBar()
        case 'scatter': return renderScatter()
        default: return renderCartesian(BarChart as any, Bar as any, 'bar')
    }
}
