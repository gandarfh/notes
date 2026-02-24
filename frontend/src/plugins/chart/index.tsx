import { useState, useCallback, useRef, useEffect } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { LocalDatabase, ColumnDef } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { ChartRenderer, defaultConfig, type ChartConfig, type ChartType, type DataPoint, type SeriesDef } from './ChartRenderer'
import { ChartTypePicker } from './ChartTypePicker'
import { NotebookEditor, defaultNotebookConfig, type NotebookConfig, type FilterCondition, type Metric } from './NotebookEditor'

// ── Block Config ───────────────────────────────────────────

interface ChartBlockConfig extends ChartConfig {
    notebook: NotebookConfig
}

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

function defaultBlockConfig(): ChartBlockConfig {
    return {
        ...defaultConfig(),
        data: [],
        series: [],
        notebook: defaultNotebookConfig(),
    }
}

// ── Filter pipeline ────────────────────────────────────────

function matchesFilter(value: unknown, f: FilterCondition): boolean {
    const s = String(value ?? '')
    const v = f.value

    switch (f.operator) {
        // Text
        case 'is': return s === v
        case 'is_not': return s !== v
        case 'contains': return s.toLowerCase().includes(v.toLowerCase())
        case 'starts_with': return s.toLowerCase().startsWith(v.toLowerCase())
        case 'ends_with': return s.toLowerCase().endsWith(v.toLowerCase())
        // Number
        case 'eq': return Number(s) === Number(v)
        case 'neq': return Number(s) !== Number(v)
        case 'gt': return Number(s) > Number(v)
        case 'lt': return Number(s) < Number(v)
        case 'gte': return Number(s) >= Number(v)
        case 'lte': return Number(s) <= Number(v)
        case 'between': return Number(s) >= Number(v) && Number(s) <= Number(f.value2 ?? v)
        // Checkbox
        case 'is_true': return s === 'true' || s === '1'
        case 'is_false': return s === 'false' || s === '0' || s === ''
        // Date
        case 'before': return s < v
        case 'after': return s > v
        default: return true
    }
}

// ── Aggregation ────────────────────────────────────────────

function aggregate(values: number[], agg: Metric['aggregation']): number {
    if (values.length === 0) return 0
    switch (agg) {
        case 'count': return values.length
        case 'sum': return values.reduce((a, b) => a + b, 0)
        case 'avg': return values.reduce((a, b) => a + b, 0) / values.length
        case 'min': return Math.min(...values)
        case 'max': return Math.max(...values)
    }
}

function groupAndAggregate(
    data: Record<string, unknown>[],
    metric: Metric,
    groupByKeys: string[],
): Map<string, number> {
    const groups = new Map<string, number[]>()
    const keyOf = (d: Record<string, unknown>) =>
        groupByKeys.map(k => String(d[k] ?? 'Other')).join(' × ')

    for (const row of data) {
        const key = keyOf(row)
        if (!groups.has(key)) groups.set(key, [])
        const val = metric.aggregation === 'count' ? 1 : (Number(row[metric.column!]) || 0)
        groups.get(key)!.push(val)
    }

    const result = new Map<string, number>()
    groups.forEach((vals, key) => result.set(key, aggregate(vals, metric.aggregation)))
    return result
}

// ── Full pipeline execution ────────────────────────────────

async function executePipeline(
    nb: NotebookConfig,
    columns: ColumnDef[],
): Promise<{ data: DataPoint[]; series: SeriesDef[] }> {
    if (!nb.databaseId || nb.summarize.groupBy.length === 0) return { data: [], series: [] }

    // 1. Fetch data
    const rawRows = await api.listLocalDBRows(nb.databaseId)
    let rows: Record<string, unknown>[] = rawRows.map(r => {
        try { return JSON.parse(r.dataJson || '{}') } catch { return {} }
    })

    // 2. Filter
    for (const f of nb.filters) {
        if (!f.column) continue
        rows = rows.filter(row => matchesFilter(row[f.column], f))
    }

    // 3. Summarize
    const allLabels = new Set<string>()
    const metricResults: { metric: Metric; idx: number; groups: Map<string, number> }[] = []

    nb.summarize.metrics.forEach((m, idx) => {
        if (m.aggregation !== 'count' && !m.column) return
        const groups = groupAndAggregate(rows, m, nb.summarize.groupBy)
        groups.forEach((_val: number, label: string) => allLabels.add(label))
        metricResults.push({ metric: m, idx, groups })
    })

    // 4. Build data points
    let labels = Array.from(allLabels)

    // 5. Sort
    if (nb.sort.length > 0) {
        const sortRule = nb.sort[0]
        // Check if sorting by a metric result or a label
        const metricIdx = metricResults.findIndex(m => {
            const col = columns.find(c => c.id === sortRule.column)
            return col && m.metric.column === sortRule.column
        })

        if (metricIdx >= 0) {
            const groups = metricResults[metricIdx].groups
            labels.sort((a, b) => {
                const va = groups.get(a) ?? 0
                const vb = groups.get(b) ?? 0
                return sortRule.direction === 'asc' ? va - vb : vb - va
            })
        } else {
            labels.sort((a, b) => sortRule.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a))
        }
    } else {
        labels.sort()
    }

    // 6. Limit
    if (nb.limit && nb.limit > 0) {
        labels = labels.slice(0, nb.limit)
    }

    const data: DataPoint[] = labels.map(label => {
        const point: DataPoint = { name: label }
        metricResults.forEach(({ idx, groups }) => {
            point[`m${idx}`] = groups.get(label) ?? 0
        })
        return point
    })

    const series: SeriesDef[] = metricResults.map(({ metric, idx }) => {
        const col = columns.find(c => c.id === metric.column)
        const name = metric.aggregation === 'count'
            ? 'Count'
            : `${metric.aggregation}(${col?.name || '?'})`
        return { key: `m${idx}`, color: COLORS[idx % COLORS.length], name }
    })

    return { data, series }
}

// ── Chart Block Renderer ───────────────────────────────────

function ChartBlockRenderer({ block, onContentChange }: BlockRendererProps) {
    const configRef = useRef<ChartBlockConfig | null>(null)
    const [databases, setDatabases] = useState<LocalDatabase[]>([])
    const [dbColumns, setDbColumns] = useState<Record<string, ColumnDef[]>>({})
    const [showEditor, setShowEditor] = useState(false)
    const [showTypePicker, setShowTypePicker] = useState(false)
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState('')
    const [refreshKey, setRefreshKey] = useState(0)

    const getConfig = useCallback((): ChartBlockConfig => {
        if (configRef.current) return configRef.current
        try {
            const parsed = JSON.parse(block.content || '{}') as Partial<ChartBlockConfig>
            const cfg = { ...defaultBlockConfig(), ...parsed }
            if (!cfg.notebook) cfg.notebook = defaultNotebookConfig()
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
    }, [showEditor, refreshKey])

    // Execute pipeline
    useEffect(() => {
        const nb = config.notebook
        if (!nb.databaseId) return

        const columns = dbColumns[nb.databaseId] || []
        executePipeline(nb, columns).then(({ data, series }) => {
            if (JSON.stringify(data) !== JSON.stringify(config.data) || JSON.stringify(series) !== JSON.stringify(config.series)) {
                persist({ ...config, data, series })
            }
        }).catch(() => { })
    }, [
        JSON.stringify(config.notebook),
        Object.keys(dbColumns).length,
        refreshKey,
    ])

    const handleNotebookChange = (notebook: NotebookConfig) => {
        persist({ ...config, notebook })
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

    const currentColumns = dbColumns[config.notebook.databaseId] || []
    const hasData = config.data.length > 0

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
                    <span className="chart-type-badge" onClick={() => { setShowTypePicker(!showTypePicker); setShowEditor(false) }}>
                        {config.chartType}
                    </span>
                </div>
                <div className="chart-header-right">
                    <button className="chart-toolbar-btn" onClick={() => setRefreshKey(k => k + 1)} title="Refresh">↻</button>
                    <button
                        className={`chart-toolbar-btn ${showEditor ? 'active' : ''}`}
                        onClick={() => { setShowEditor(!showEditor); setShowTypePicker(false) }}
                    >
                        Editor
                    </button>
                    <button
                        className={`chart-toolbar-btn ${showTypePicker ? 'active' : ''}`}
                        onClick={() => { setShowTypePicker(!showTypePicker); setShowEditor(false) }}
                    >
                        Type
                    </button>
                </div>
            </div>

            {/* Type picker */}
            {showTypePicker && <ChartTypePicker value={config.chartType} onChange={handleTypeChange} />}

            {/* Notebook editor */}
            {showEditor && (
                <NotebookEditor
                    config={config.notebook}
                    columns={currentColumns}
                    databases={databases.map(d => ({ id: d.id, name: d.name }))}
                    onChange={handleNotebookChange}
                />
            )}

            {/* Chart area */}
            <div className="chart-area">
                {hasData ? (
                    <ChartRenderer config={config} />
                ) : (
                    <div className="chart-empty">
                        <span className="chart-empty-icon">📊</span>
                        <span className="chart-empty-text">
                            Click <strong>Editor</strong> to build your query
                        </span>
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
    defaultSize: { width: 500, height: 400 },
    Renderer: ChartBlockRenderer,
    headerLabel: 'Chart',
}
