import { useState, useCallback, useRef, useEffect } from 'react'
import { rollup, sum, mean, min, max } from 'd3-array'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { LocalDatabase, ColumnDef } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { ChartRenderer, defaultConfig, type ChartConfig, type ChartType, type DataPoint, type SeriesDef } from './ChartRenderer'
import { ChartTypePicker } from './ChartTypePicker'

// ── Query Builder Types ────────────────────────────────────

type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max'

interface ChartQuery {
    id: string                // a, b, c ...
    databaseId: string
    metric: string            // column id for the value (ignored for count)
    aggregation: Aggregation
    groupBy: string           // column id to group results by
    color: string
}

interface ChartBlockConfig extends ChartConfig {
    queries: ChartQuery[]
}

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']
const LETTERS = 'abcdefghijklmnop'.split('')

function newQuery(index: number): ChartQuery {
    return {
        id: LETTERS[index] || `q${index}`,
        databaseId: '',
        metric: '',
        aggregation: 'sum',
        groupBy: '',
        color: COLORS[index % COLORS.length],
    }
}

function defaultBlockConfig(): ChartBlockConfig {
    return {
        ...defaultConfig(),
        data: [],
        series: [],
        queries: [newQuery(0)],
    }
}

// ── d3-based aggregation ───────────────────────────────────

interface ParsedRow { group: string; value: number }

function d3Aggregate(rows: ParsedRow[], agg: Aggregation): Map<string, number> {
    return rollup(
        rows,
        group => {
            const vals = group.map(r => r.value)
            switch (agg) {
                case 'count': return group.length
                case 'sum': return sum(vals) ?? 0
                case 'avg': return mean(vals) ?? 0
                case 'min': return min(vals) ?? 0
                case 'max': return max(vals) ?? 0
            }
        },
        r => r.group,
    )
}

// ── Chart Block Renderer ───────────────────────────────────

function ChartBlockRenderer({ block, onContentChange }: BlockRendererProps) {
    const configRef = useRef<ChartBlockConfig | null>(null)
    const [databases, setDatabases] = useState<LocalDatabase[]>([])
    const [dbColumns, setDbColumns] = useState<Record<string, ColumnDef[]>>({})
    const [showConfig, setShowConfig] = useState(false)
    const [showTypePicker, setShowTypePicker] = useState(false)
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState('')
    const [refreshKey, setRefreshKey] = useState(0)

    const getConfig = useCallback((): ChartBlockConfig => {
        if (configRef.current) return configRef.current
        try {
            const parsed = JSON.parse(block.content || '{}') as Partial<ChartBlockConfig>
            const cfg = { ...defaultBlockConfig(), ...parsed }
            if (!cfg.queries || cfg.queries.length === 0) cfg.queries = [newQuery(0)]
            configRef.current = cfg
            return cfg
        } catch {
            const cfg = defaultBlockConfig()
            configRef.current = cfg
            return cfg
        }
    }, [block.content])

    const config = getConfig()

    const persist = useCallback((next: ChartBlockConfig) => {
        configRef.current = next
        onContentChange(JSON.stringify(next))
    }, [onContentChange])

    // Load databases
    useEffect(() => {
        api.listLocalDatabases().then(dbs => {
            setDatabases(dbs)
            const cols: Record<string, ColumnDef[]> = {}
            dbs.forEach(db => {
                try {
                    const parsed = JSON.parse(db.configJson || '{}')
                    cols[db.id] = parsed.columns || []
                } catch { cols[db.id] = [] }
            })
            setDbColumns(cols)
        }).catch(() => { })
    }, [showConfig, refreshKey])

    // Execute queries and build chart data
    useEffect(() => {
        const validQueries = config.queries.filter(q => q.databaseId && q.groupBy && (q.aggregation === 'count' || q.metric))
        if (validQueries.length === 0) return

        const run = async () => {
            // Collect all unique group labels across all queries
            const allLabels = new Set<string>()
            const queryResults: { query: ChartQuery; groups: Record<string, number> }[] = []

            for (const q of validQueries) {
                const rows = await api.listLocalDBRows(q.databaseId)

                // Parse rows into { group, value } for d3
                const parsed: ParsedRow[] = rows.map(row => {
                    let d: Record<string, unknown> = {}
                    try { d = JSON.parse(row.dataJson || '{}') } catch { }
                    const group = String(d[q.groupBy] ?? 'Other')
                    const value = q.aggregation === 'count' ? 1 : (Number(d[q.metric]) || 0)
                    return { group, value }
                })

                // d3 rollup: group → aggregate
                const grouped = d3Aggregate(parsed, q.aggregation)

                const aggregated: Record<string, number> = {}
                grouped.forEach((val, label) => {
                    allLabels.add(label)
                    aggregated[label] = val
                })
                queryResults.push({ query: q, groups: aggregated })
            }

            // Build chart data points — one per label
            const labels = Array.from(allLabels).sort()
            const data: DataPoint[] = labels.map(label => {
                const point: DataPoint = { name: label }
                queryResults.forEach(({ query, groups }) => {
                    point[query.id] = groups[label] ?? 0
                })
                return point
            })

            // Build series
            const series: SeriesDef[] = queryResults.map(({ query }) => {
                const db = databases.find(d => d.id === query.databaseId)
                const cols = dbColumns[query.databaseId] || []
                const metricCol = cols.find(c => c.id === query.metric)
                const groupCol = cols.find(c => c.id === query.groupBy)
                const label = query.aggregation === 'count'
                    ? `count by ${groupCol?.name || '?'}`
                    : `${query.aggregation}(${metricCol?.name || '?'}) by ${groupCol?.name || '?'}`
                const dbName = db?.name || ''
                return {
                    key: query.id,
                    color: query.color,
                    name: dbName ? `${dbName}: ${label}` : label,
                }
            })

            persist({ ...config, data, series })
        }

        run().catch(() => { })
    }, [
        config.queries.map(q => `${q.databaseId}|${q.metric}|${q.aggregation}|${q.groupBy}`).join(','),
        refreshKey,
    ])

    // Query mutation helpers
    const updateQuery = (idx: number, partial: Partial<ChartQuery>) => {
        const queries = [...config.queries]
        const old = queries[idx]
        queries[idx] = { ...old, ...partial }
        // Reset metric/groupBy when DB changes
        if (partial.databaseId && partial.databaseId !== old.databaseId) {
            queries[idx].metric = ''
            queries[idx].groupBy = ''
        }
        persist({ ...config, queries })
    }

    const addQuery = () => {
        persist({ ...config, queries: [...config.queries, newQuery(config.queries.length)] })
    }

    const removeQuery = (idx: number) => {
        if (config.queries.length <= 1) return
        persist({ ...config, queries: config.queries.filter((_, i) => i !== idx) })
    }

    const handleTypeChange = (type: ChartType) => {
        persist({ ...config, chartType: type })
        setShowTypePicker(false)
    }

    const handleTitleSubmit = () => {
        setEditingTitle(false)
        if (titleValue.trim() && titleValue !== config.title) {
            persist({ ...config, title: titleValue.trim() })
        }
    }

    const hasValidQuery = config.queries.some(q => q.databaseId && q.groupBy && (q.aggregation === 'count' || q.metric))

    return (
        <div className="chart-block" onMouseDown={e => e.stopPropagation()}>
            {/* Header */}
            <div className="chart-header">
                <div className="chart-header-left">
                    {editingTitle ? (
                        <input
                            className="chart-title-input"
                            value={titleValue}
                            onChange={e => setTitleValue(e.target.value)}
                            onBlur={handleTitleSubmit}
                            onKeyDown={e => { if (e.key === 'Enter') handleTitleSubmit(); if (e.key === 'Escape') { setEditingTitle(false); setTitleValue(config.title) } }}
                            autoFocus
                        />
                    ) : (
                        <span className="chart-title" onDoubleClick={() => { setEditingTitle(true); setTitleValue(config.title) }}>
                            {config.title}
                        </span>
                    )}
                    <span className="chart-type-badge" onClick={() => setShowTypePicker(!showTypePicker)}>
                        {config.chartType}
                    </span>
                </div>
                <div className="chart-header-right">
                    <button className="chart-toolbar-btn" onClick={() => setRefreshKey(k => k + 1)} title="Refresh data">↻</button>
                    <button
                        className={`chart-toolbar-btn ${showConfig ? 'active' : ''}`}
                        onClick={() => { setShowConfig(!showConfig); setShowTypePicker(false) }}
                    >
                        Query
                    </button>
                    <button
                        className={`chart-toolbar-btn ${showTypePicker ? 'active' : ''}`}
                        onClick={() => { setShowTypePicker(!showTypePicker); setShowConfig(false) }}
                    >
                        Type
                    </button>
                </div>
            </div>

            {/* Type picker */}
            {showTypePicker && <ChartTypePicker value={config.chartType} onChange={handleTypeChange} />}

            {/* Query builder */}
            {showConfig && (
                <div className="chart-query-builder">
                    {config.queries.map((q, idx) => {
                        const cols = dbColumns[q.databaseId] || []
                        const numericCols = cols.filter(c => c.type === 'number' || c.type === 'progress' || c.type === 'rating')

                        return (
                            <div key={q.id} className="chart-query-row" style={{ borderLeftColor: q.color }}>
                                <span className="chart-query-letter" style={{ color: q.color }}>{q.id}</span>

                                {/* Aggregation */}
                                <select
                                    className="chart-query-select chart-query-agg"
                                    value={q.aggregation}
                                    onChange={e => updateQuery(idx, { aggregation: e.target.value as Aggregation })}
                                >
                                    <option value="count">count</option>
                                    <option value="sum">sum</option>
                                    <option value="avg">avg</option>
                                    <option value="min">min</option>
                                    <option value="max">max</option>
                                </select>

                                {/* Metric column (not needed for count) */}
                                {q.aggregation !== 'count' && (
                                    <>
                                        <span className="chart-query-of">of</span>
                                        <select
                                            className="chart-query-select"
                                            value={q.metric}
                                            onChange={e => updateQuery(idx, { metric: e.target.value })}
                                        >
                                            <option value="">metric…</option>
                                            {numericCols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </>
                                )}

                                <span className="chart-query-of">from</span>

                                {/* Database picker */}
                                <select
                                    className="chart-query-select chart-query-db"
                                    value={q.databaseId}
                                    onChange={e => updateQuery(idx, { databaseId: e.target.value })}
                                >
                                    <option value="">database…</option>
                                    {databases.map(db => <option key={db.id} value={db.id}>{db.name}</option>)}
                                </select>

                                <span className="chart-query-of">by</span>

                                {/* Group by column */}
                                <select
                                    className="chart-query-select"
                                    value={q.groupBy}
                                    onChange={e => updateQuery(idx, { groupBy: e.target.value })}
                                >
                                    <option value="">group by…</option>
                                    {cols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>

                                {/* Remove query */}
                                {config.queries.length > 1 && (
                                    <button className="chart-query-remove" onClick={() => removeQuery(idx)}>✕</button>
                                )}
                            </div>
                        )
                    })}
                    <button className="chart-query-add" onClick={addQuery}>+ Add query</button>
                </div>
            )}

            {/* Chart area */}
            <div className="chart-area">
                {hasValidQuery && config.data.length > 0 ? (
                    <ChartRenderer config={config} />
                ) : (
                    <div className="chart-empty">
                        <span className="chart-empty-icon">📊</span>
                        <span className="chart-empty-text">Click <strong>Query</strong> to build your chart</span>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Icon ───────────────────────────────────────────────────

function ChartIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <rect x="1" y="9" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5" />
            <rect x="5" y="5" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7" />
            <rect x="9" y="7" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.6" />
            <rect x="13" y="2" width="3" height="13" rx="0.5" fill="currentColor" opacity="0.8" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const chartPlugin: BlockPlugin = {
    type: 'chart',
    label: 'Chart',
    Icon: ChartIcon,
    defaultSize: { width: 500, height: 350 },
    Renderer: ChartBlockRenderer,
    headerLabel: 'Chart',
}
