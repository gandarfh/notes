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
    ComposedChart,
    FunnelChart, Funnel,
    Treemap,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'

// ── Types ──────────────────────────────────────────────────

export type ChartType =
    | 'bar' | 'stackedBar' | 'horizontalBar'
    | 'line' | 'stepLine'
    | 'area' | 'stackedArea'
    | 'composed'
    | 'pie' | 'donut'
    | 'scatter' | 'radar' | 'radialBar'
    | 'funnel' | 'treemap'
    | 'number' | 'waterfall'

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
            fontSize: 13,
            padding: '6px 10px',
        },
    }), [])

    // ── Cartesian (bar, line, area) ────────────────────────

    const renderCartesian = (
        ChartComp: typeof BarChart,
        DataComp: typeof Bar,
        type: 'bar' | 'line' | 'area',
        forceStacked = false,
        lineType?: 'monotone' | 'stepAfter',
    ) => (
        <ResponsiveContainer width="100%" height="100%">
            <ChartComp data={data}>
                {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                <XAxis dataKey="name" tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                {options.showTooltip && <Tooltip {...tooltipStyle} />}
                {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
                {series.map((s, i) => {
                    const color = s.color || COLORS[i % COLORS.length]
                    const stacked = forceStacked || options.stacked
                    const props: Record<string, unknown> = {
                        dataKey: s.key,
                        name: s.name,
                        isAnimationActive: animate,
                        stackId: stacked ? 'stack' : undefined,
                    }
                    if (type === 'bar') {
                        return <Bar key={s.key} {...props} fill={color} radius={stacked ? undefined : [3, 3, 0, 0]} />
                    } else if (type === 'area') {
                        return <Area key={s.key} {...props} dataKey={s.key} stroke={color} fill={color} fillOpacity={stacked ? 0.6 : 0.15} strokeWidth={2} type={lineType || 'monotone'} />
                    } else {
                        return <Line key={s.key} {...props} stroke={color} strokeWidth={2} dot={{ r: 3 }} type={lineType || 'monotone'} />
                    }
                })}
            </ChartComp>
        </ResponsiveContainer>
    )

    // ── Horizontal Bar ─────────────────────────────────────

    const renderHorizontalBar = () => (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
                {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                <YAxis dataKey="name" type="category" tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" width={80} />
                <XAxis type="number" tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                {options.showTooltip && <Tooltip {...tooltipStyle} />}
                {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
                {series.map((s, i) => (
                    <Bar
                        key={s.key}
                        dataKey={s.key}
                        name={s.name}
                        fill={s.color || COLORS[i % COLORS.length]}
                        radius={[0, 3, 3, 0]}
                        isAnimationActive={animate}
                        stackId={options.stacked ? 'stack' : undefined}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    )

    // ── Composed (bar + line) ──────────────────────────────

    const renderComposed = () => (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
                {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                <XAxis dataKey="name" tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                {options.showTooltip && <Tooltip {...tooltipStyle} />}
                {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
                {series.map((s, i) => {
                    const color = s.color || COLORS[i % COLORS.length]
                    if (i === 0) {
                        return (
                            <Bar
                                key={s.key} dataKey={s.key} name={s.name}
                                fill={color} radius={[3, 3, 0, 0]}
                                isAnimationActive={animate} fillOpacity={0.8}
                            />
                        )
                    }
                    return (
                        <Line
                            key={s.key} dataKey={s.key} name={s.name}
                            stroke={color} strokeWidth={2} dot={{ r: 3 }}
                            isAnimationActive={animate}
                        />
                    )
                })}
            </ComposedChart>
        </ResponsiveContainer>
    )

    // ── Waterfall ──────────────────────────────────────────

    const renderWaterfall = () => {
        const mainKey = series[0]?.key || 'value'
        let cumulative = 0
        const waterfallData = data.map((d, i) => {
            const val = Number(d[mainKey]) || 0
            const prev = cumulative
            cumulative += val
            return {
                name: d.name,
                invisible: prev,
                value: val,
                fill: i === data.length - 1 ? COLORS[4] : val >= 0 ? COLORS[2] : COLORS[3],
            }
        })

        return (
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfallData}>
                    {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                    <XAxis dataKey="name" tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                    <YAxis tick={{ fontSize: 14 }} stroke="var(--color-text-muted)" />
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    <ReferenceLine y={0} stroke="var(--color-border-default)" />
                    <Bar dataKey="invisible" stackId="waterfall" fill="transparent" isAnimationActive={false} />
                    <Bar dataKey="value" stackId="waterfall" isAnimationActive={animate} radius={[3, 3, 0, 0]}>
                        {waterfallData.map((d, i) => (
                            <Cell key={i} fill={d.fill} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        )
    }

    // ── KPI Number ─────────────────────────────────────────

    const renderNumber = () => {
        const mainKey = series[0]?.key || 'value'
        // Get last data point or sum
        const total = data.reduce((acc, d) => acc + (Number(d[mainKey]) || 0), 0)
        const label = series[0]?.name || mainKey

        // Format large numbers
        const formatNum = (n: number) => {
            if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
            if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K'
            if (n % 1 !== 0) return n.toFixed(1)
            return String(n)
        }

        return (
            <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                width: '100%', height: '100%', gap: 4,
            }}>
                <span style={{
                    fontSize: 48, fontWeight: 700, lineHeight: 1,
                    color: series[0]?.color || COLORS[0],
                    fontFamily: "'Inter', -apple-system, sans-serif",
                    letterSpacing: '-0.02em',
                }}>
                    {formatNum(total)}
                </span>
                <span style={{
                    fontSize: 13, fontWeight: 500, textTransform: 'uppercase',
                    color: 'var(--color-text-muted)', letterSpacing: '0.5px',
                }}>
                    {label}
                </span>
                {data.length > 1 && (
                    <span style={{
                        fontSize: 11, color: 'var(--color-text-muted)', opacity: 0.6,
                    }}>
                        {data.length} data points · sum
                    </span>
                )}
            </div>
        )
    }

    // ── Pie / Donut ────────────────────────────────────────

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
                        fontSize={13}
                    >
                        {data.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                    </Pie>
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
                </PieChart>
            </ResponsiveContainer>
        )
    }

    // ── Funnel ─────────────────────────────────────────────

    const renderFunnel = () => {
        const mainKey = series[0]?.key || 'value'
        const funnelData = data.map((d, i) => ({
            ...d, fill: COLORS[i % COLORS.length],
        }))
        return (
            <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                    <Funnel
                        dataKey={mainKey}
                        data={funnelData}
                        isAnimationActive={animate}
                        nameKey="name"
                    >
                        {funnelData.map((d, i) => (
                            <Cell key={i} fill={d.fill} />
                        ))}
                    </Funnel>
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
                </FunnelChart>
            </ResponsiveContainer>
        )
    }

    // ── Treemap ────────────────────────────────────────────

    const renderTreemap = () => {
        const mainKey = series[0]?.key || 'value'
        const treemapData = data.map((d, i) => ({
            name: d.name,
            size: Number(d[mainKey]) || 0,
            fill: COLORS[i % COLORS.length],
        }))

        return (
            <ResponsiveContainer width="100%" height="100%">
                <Treemap
                    data={treemapData}
                    dataKey="size"
                    nameKey="name"
                    aspectRatio={4 / 3}
                    isAnimationActive={animate}
                    content={({ x, y, width, height, name, fill }: any) => {
                        if (width < 30 || height < 20) return <g />
                        return (
                            <g>
                                <rect
                                    x={x} y={y} width={width} height={height}
                                    fill={fill} stroke="var(--color-surface)"
                                    strokeWidth={2} rx={4}
                                />
                                <text
                                    x={x + width / 2} y={y + height / 2}
                                    textAnchor="middle" dominantBaseline="middle"
                                    fill="#fff" fontSize={Math.min(14, width / 5)}
                                    fontWeight={600}
                                >
                                    {name}
                                </text>
                            </g>
                        )
                    }}
                />
            </ResponsiveContainer>
        )
    }

    // ── Radar ──────────────────────────────────────────────

    const renderRadar = () => (
        <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data}>
                <PolarGrid stroke="var(--color-border-subtle)" />
                {/* @ts-ignore Recharts type compat */}
                <PolarAngleAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
                {/* @ts-ignore Recharts type compat */}
                <PolarRadiusAxis tick={{ fontSize: 11 }} />
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
                {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
            </RadarChart>
        </ResponsiveContainer>
    )

    // ── Radial Bar ─────────────────────────────────────────

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
                        label={{ position: 'insideStart', fill: '#fff', fontSize: 12 }}
                    />
                    {options.showTooltip && <Tooltip {...tooltipStyle} />}
                    {options.showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
                </RadialBarChart>
            </ResponsiveContainer>
        )
    }

    // ── Scatter ────────────────────────────────────────────

    const renderScatter = () => (
        <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
                {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />}
                <XAxis dataKey="name" tick={{ fontSize: 13 }} stroke="var(--color-text-muted)" name="Name" />
                <YAxis dataKey={series[0]?.key || 'value'} tick={{ fontSize: 13 }} stroke="var(--color-text-muted)" />
                {options.showTooltip && <Tooltip {...tooltipStyle} />}
                <Scatter
                    data={data}
                    fill={series[0]?.color || COLORS[0]}
                    isAnimationActive={animate}
                />
            </ScatterChart>
        </ResponsiveContainer>
    )

    // ── Switch ─────────────────────────────────────────────

    switch (chartType) {
        case 'bar': return renderCartesian(BarChart as any, Bar as any, 'bar')
        case 'stackedBar': return renderCartesian(BarChart as any, Bar as any, 'bar', true)
        case 'horizontalBar': return renderHorizontalBar()
        case 'line': return renderCartesian(LineChart as any, Line as any, 'line')
        case 'stepLine': return renderCartesian(LineChart as any, Line as any, 'line', false, 'stepAfter')
        case 'area': return renderCartesian(AreaChart as any, Area as any, 'area')
        case 'stackedArea': return renderCartesian(AreaChart as any, Area as any, 'area', true)
        case 'composed': return renderComposed()
        case 'waterfall': return renderWaterfall()
        case 'number': return renderNumber()
        case 'pie': return renderPie(false)
        case 'donut': return renderPie(true)
        case 'funnel': return renderFunnel()
        case 'treemap': return renderTreemap()
        case 'radar': return renderRadar()
        case 'radialBar': return renderRadialBar()
        case 'scatter': return renderScatter()
        default: return renderCartesian(BarChart as any, Bar as any, 'bar')
    }
}
