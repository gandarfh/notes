import { useState, useCallback, useEffect, useMemo } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { LocalDatabase, ColumnDef } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { ChartRenderer, defaultConfig, type ChartConfig, type ChartType, type DataPoint, type SeriesDef } from './ChartRenderer'
import { ChartTypePicker } from './ChartTypePicker'
import { NotebookEditor, type PipelineConfig, defaultPipelineConfig } from './NotebookEditor'
import { executePipeline, type Row } from './pipeline'

// ── Block Config ───────────────────────────────────────────

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

interface ChartBlockConfig extends ChartConfig {
    pipeline: PipelineConfig
}

function parseBlockConfig(content: string): ChartBlockConfig {
    try {
        const parsed = JSON.parse(content || '{}') as Partial<ChartBlockConfig>
        const cfg = { ...defaultConfig(), data: [], series: [], ...parsed }

        // Migrate from old NotebookConfig → PipelineConfig
        if (!cfg.pipeline) {
            const nb = (parsed as any).notebook
            if (nb?.databaseId) {
                cfg.pipeline = {
                    stages: [{ type: 'source' as const, databaseId: nb.databaseId }],
                    viz: { xAxis: nb.xAxis || '', series: [] },
                }
            } else {
                cfg.pipeline = defaultPipelineConfig()
            }
        }
        return cfg as ChartBlockConfig
    } catch {
        return { ...defaultConfig(), data: [], series: [], pipeline: defaultPipelineConfig() }
    }
}

// ── Column name resolver ───────────────────────────────────

function buildColNameResolver(dbColumns: Record<string, ColumnDef[]>): (id: string) => string {
    const map = new Map<string, string>()
    for (const cols of Object.values(dbColumns)) {
        for (const c of cols) {
            map.set(c.id, c.name)
        }
    }
    return (id: string) => map.get(id) || id
}

// ── Row → Chart Data ───────────────────────────────────────

function rowsToChart(
    rows: Row[],
    viz: PipelineConfig['viz'],
    resolveCol: (id: string) => string,
): { data: DataPoint[]; series: SeriesDef[] } {
    if (!viz.xAxis || viz.series.length === 0 || rows.length === 0) {
        return { data: [], series: [] }
    }

    const data: DataPoint[] = rows.map(row => {
        const point: DataPoint = { name: String(row[viz.xAxis] ?? '') }
        for (const key of viz.series) {
            point[key] = Number(row[key]) || 0
        }
        return point
    })

    const series: SeriesDef[] = viz.series.map((key, i) => ({
        key,
        color: COLORS[i % COLORS.length],
        name: resolveCol(key),
    }))

    return { data, series }
}

// ── Chart Block Renderer ───────────────────────────────────

function ChartBlockRenderer({ block, onContentChange }: BlockRendererProps) {
    // Parse config from block.content (re-parses when content changes)
    const config = useMemo(() => parseBlockConfig(block.content), [block.content])

    const [databases, setDatabases] = useState<LocalDatabase[]>([])
    const [dbColumns, setDbColumns] = useState<Record<string, ColumnDef[]>>({})
    const [showEditor, setShowEditor] = useState(false)
    const [showTypePicker, setShowTypePicker] = useState(false)
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState('')
    const [refreshKey, setRefreshKey] = useState(0)
    const [pipelineError, setPipelineError] = useState<string | null>(null)

    // Column name resolver
    const resolveCol = useMemo(() => buildColNameResolver(dbColumns), [dbColumns])

    const persist = useCallback((next: ChartBlockConfig) => {
        onContentChange(JSON.stringify(next))
    }, [onContentChange])

    // Load databases & columns
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

    // Execute pipeline whenever pipeline config or columns change
    const pipelineJSON = JSON.stringify(config.pipeline)
    const colKeys = Object.keys(dbColumns).sort().join(',')

    useEffect(() => {
        const pipeline = config.pipeline
        if (!pipeline.stages.length) return

        const firstSource = pipeline.stages.find(s => s.type === 'source')
        if (!firstSource || !(firstSource as any).databaseId) return

        setPipelineError(null)
        executePipeline(pipeline).then(rows => {
            // Collect actual keys from output rows
            const availableKeys = new Set<string>()
            for (const row of rows) {
                for (const key of Object.keys(row)) availableKeys.add(key)
            }

            // Auto-clean viz.series: remove stale keys that no longer exist in output
            const cleanedSeries = pipeline.viz.series.filter(k => availableKeys.has(k))
            const cleanedViz = { ...pipeline.viz, series: cleanedSeries }

            const { data, series } = rowsToChart(rows, cleanedViz, resolveCol)

            // Persist cleaned viz + new data/series
            const updatedPipeline = cleanedSeries.length !== pipeline.viz.series.length
                ? { ...pipeline, viz: cleanedViz }
                : pipeline
            persist({ ...config, pipeline: updatedPipeline, data, series })
        }).catch(err => {
            setPipelineError(String(err))
        })
    }, [pipelineJSON, colKeys, refreshKey])

    const handlePipelineChange = (pipeline: PipelineConfig) => {
        persist({ ...config, pipeline })
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

            {/* Pipeline editor */}
            {showEditor && (
                <NotebookEditor
                    config={config.pipeline}
                    databases={databases.map(d => ({ id: d.id, name: d.name }))}
                    dbColumns={dbColumns}
                    onChange={handlePipelineChange}
                />
            )}

            {/* Chart area */}
            <div className="chart-area">
                {pipelineError ? (
                    <div className="chart-empty">
                        <span className="chart-empty-text" style={{ color: 'var(--color-danger)' }}>
                            Pipeline error: {pipelineError}
                        </span>
                    </div>
                ) : hasData ? (
                    <ChartRenderer config={config} />
                ) : (
                    <div className="chart-empty">
                        <span className="chart-empty-text">
                            Click <strong>Editor</strong> to build your data pipeline
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

// ── Plugin ─────────────────────────────────────────────────

export const chartPlugin: BlockPlugin = {
    type: 'chart',
    label: 'Chart',
    Icon: ChartIcon,
    defaultSize: { width: 500, height: 400 },
    Renderer: ChartBlockRenderer,
    headerLabel: 'Chart',
}
