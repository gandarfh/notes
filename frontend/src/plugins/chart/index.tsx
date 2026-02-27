import './chart.css'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { BlockPlugin, PluginRendererProps } from '../sdk'
import type { LocalDatabase, ColumnDef } from './types'
import { ChartRenderer, defaultConfig, type ChartConfig, type ChartType, type DataPoint, type SeriesDef } from './ChartRenderer'
import { ChartTypePicker } from './ChartTypePicker'
import { NotebookEditor, type PipelineConfig, defaultPipelineConfig } from './NotebookEditor'
import { executePipeline, type Row, type DataFetcher } from './pipeline'

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

function ChartBlockRenderer({ block, ctx }: PluginRendererProps) {
    const rpc = ctx!.rpc

    // Parse config from block.content (re-parses when content changes)
    const config = useMemo(() => parseBlockConfig(block.content), [block.content])

    const [databases, setDatabases] = useState<LocalDatabase[]>([])
    const [dbColumns, setDbColumns] = useState<Record<string, ColumnDef[]>>({})
    const dbColumnsRef = useRef<Record<string, ColumnDef[]>>({})
    const [showEditor, setShowEditor] = useState(false)
    const [showTypePicker, setShowTypePicker] = useState(false)
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState('')
    const [refreshKey, setRefreshKey] = useState(0)
    const [dbSchemaKey, setDbSchemaKey] = useState(0) // bumped when any localdb schema changes
    const [pipelineError, setPipelineError] = useState<string | null>(null)
    const [executedRows, setExecutedRows] = useState<Row[]>([])

    // Column name resolver
    const resolveCol = useMemo(() => buildColNameResolver(dbColumns), [dbColumns])

    // Auto-refresh when a source database is updated (via SDK event bus)
    useEffect(() => {
        const sourceDbIds = config.pipeline.stages
            .filter((s: any) => s.databaseId)
            .map((s: any) => s.databaseId as string)
        if (sourceDbIds.length === 0) return

        // Listen for SDK events from localdb plugin
        const unsub1 = ctx!.events.on('localdb:changed', (payload: any) => {
            if (payload?.databaseId && sourceDbIds.includes(payload.databaseId)) {
                setRefreshKey(k => k + 1)
            }
        })

        // Also listen for backend events for backward compat
        const unsub2 = ctx!.events.onBackend('db:updated', (payload: any) => {
            if (payload?.databaseId && sourceDbIds.includes(payload.databaseId)) {
                setRefreshKey(k => k + 1)
            }
        })

        return () => { unsub1(); unsub2() }
    }, [config.pipeline.stages, ctx])

    // Subscribe to ALL localdb changes (SDK bus + backend events) to keep columns fresh
    // This also triggers the column ID migration when ETL replaces the schema.
    useEffect(() => {
        const unsub1 = ctx!.events.on('localdb:changed', () => {
            setDbSchemaKey(k => k + 1)
        })
        // db:updated fires from backend when ETL syncs data (localdb:changed does not)
        const unsub2 = ctx!.events.onBackend('db:updated', () => {
            setDbSchemaKey(k => k + 1)
        })
        return () => { unsub1(); unsub2() }
    }, [ctx])

    const persist = useCallback((next: ChartBlockConfig) => {
        ctx!.storage.setContent(JSON.stringify(next))
    }, [ctx])

    // Load databases & columns — re-runs when editor opens, data refreshes, or any localdb schema changes
    useEffect(() => {
        rpc.call<LocalDatabase[]>('ListLocalDatabases').then(dbs => {
            setDatabases(dbs)
            const newCols: Record<string, ColumnDef[]> = {}
            dbs.forEach(db => {
                try {
                    const parsed = JSON.parse(db.configJson || '{}')
                    newCols[db.id] = parsed.columns || []
                } catch { newCols[db.id] = [] }
            })

            // ─ Column ID migration ───────────────────────────────────────
            // When ETL 'replace' runs, localdb schema is recreated with new column UUIDs.
            // We remap old IDs → new IDs by matching column NAMES so the pipeline stays valid.
            const oldCols = dbColumnsRef.current
            const idMap = new Map<string, string>() // oldId -> newId

            for (const [dbId, newDbCols] of Object.entries(newCols)) {
                const oldDbCols = oldCols[dbId] || []
                if (!oldDbCols.length || !newDbCols.length) continue

                // Build name -> oldId lookup
                const nameToOldId = new Map<string, string>()
                for (const col of oldDbCols) nameToOldId.set(col.name, col.id)

                // For each new column, find the old ID for the same name
                for (const col of newDbCols) {
                    const oldId = nameToOldId.get(col.name)
                    if (oldId && oldId !== col.id) {
                        idMap.set(oldId, col.id)
                    }
                }
            }

            if (idMap.size > 0) {
                // Remap a single column reference string
                const remap = (v: string) => idMap.get(v) ?? v
                // Remap an array of column references
                const remapArr = (arr: string[]) => arr.map(remap)

                const migrateStages = (stages: any[]): any[] =>
                    stages.map(s => {
                        switch (s.type) {
                            case 'group':
                                return { ...s, groupBy: remapArr(s.groupBy || []) }
                            case 'pivot':
                                return {
                                    ...s,
                                    rowKeys: remapArr(s.rowKeys || []),
                                    pivotColumn: remap(s.pivotColumn || ''),
                                    valueColumns: remapArr(s.valueColumns || []),
                                }
                            case 'filter':
                                return {
                                    ...s,
                                    conditions: (s.conditions || []).map((c: any) => ({ ...c, column: remap(c.column) }))
                                }
                            case 'sort':
                                return { ...s, column: remap(s.column || '') }
                            case 'date_part':
                                return { ...s, field: remap(s.field || '') }
                            case 'percent':
                                return { ...s, column: remap(s.column || '') }
                            default: return s
                        }
                    })

                const currentConfig = JSON.parse(ctx!.storage.getContent() || '{}') as ChartBlockConfig
                const migratedPipeline = { ...currentConfig.pipeline, stages: migrateStages(currentConfig.pipeline?.stages || []) }
                ctx!.storage.setContent(JSON.stringify({ ...currentConfig, pipeline: migratedPipeline }))
            }

            dbColumnsRef.current = newCols
            setDbColumns(newCols)
        }).catch(() => { })
    }, [showEditor, refreshKey, dbSchemaKey, rpc, ctx])

    // Stable keys for pipeline execution dependency tracking
    const pipelineJSON = JSON.stringify(config.pipeline)
    const colKeys = Object.keys(dbColumns).sort().join(',')

    // Execute pipeline when pipeline config or columns change.
    // IMPORTANT: refreshKey is NOT a dep here — it only triggers a column reload.
    // The column reload sets new dbColumns → colKeys changes → this effect re-fires
    // with the already-migrated config. Adding refreshKey here would cause a race
    // where pipeline runs with the old config before migration completes.
    useEffect(() => {
        const pipeline = config.pipeline
        if (!pipeline.stages.length) return

        const firstSource = pipeline.stages.find(s => s.type === 'source')
        if (!firstSource || !(firstSource as any).databaseId) return

        setPipelineError(null)
        const fetcher: DataFetcher = {
            getRows: (dbId) => ctx!.rpc.call<{ dataJson: string }[]>('ListLocalDBRows', dbId),
        }
        executePipeline(pipeline, fetcher).then(rows => {
            setExecutedRows(rows)

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
    }, [pipelineJSON, colKeys])

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
                    executedRows={executedRows}
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
