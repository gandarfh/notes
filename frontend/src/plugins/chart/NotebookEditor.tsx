import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconPlus, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import type { ColumnDef } from '../../bridge/wails'
import type { Row } from './pipeline'
import { Select } from './Select'
import {
    type PipelineConfig, type Stage, type FilterCondition, type MetricDef,
    type Aggregation, type FilterOp, type VizConfig,
    type StringStage,
    defaultPipelineConfig, getColumnsAtStage,
    STAGE_LABELS, FILTER_OPS, AGG_OPTIONS,
} from './pipeline'

// Re-export for chart/index.tsx
export { type PipelineConfig, defaultPipelineConfig } from './pipeline'

// ── Props ──────────────────────────────────────────────────

interface Props {
    config: PipelineConfig
    databases: { id: string; name: string }[]
    dbColumns: Record<string, ColumnDef[]>
    executedRows?: Row[]
    onChange: (config: PipelineConfig) => void
}

// ── Editor ─────────────────────────────────────────────────

export function NotebookEditor({ config, databases, dbColumns, executedRows, onChange }: Props) {
    const updateStage = (idx: number, stage: Stage) => {
        const next = [...config.stages]
        next[idx] = stage
        onChange({ ...config, stages: next })
    }

    const removeStage = (idx: number) => {
        onChange({ ...config, stages: config.stages.filter((_, i) => i !== idx) })
    }

    const moveStage = (idx: number, dir: -1 | 1) => {
        const next = [...config.stages]
        const target = idx + dir
        if (target < 0 || target >= next.length) return
            ;[next[idx], next[target]] = [next[target], next[idx]]
        onChange({ ...config, stages: next })
    }

    const addStage = (type: Stage['type']) => {
        let stage: Stage
        switch (type) {
            case 'source': stage = { type: 'source', databaseId: '' }; break
            case 'join': stage = { type: 'join', databaseId: '', leftKey: '', rightKey: '', joinType: 'left' }; break
            case 'filter': stage = { type: 'filter', conditions: [{ column: '', op: 'eq', value: '' }], logic: 'and' }; break
            case 'compute': stage = { type: 'compute', columns: [{ name: '', expression: '' }] }; break
            case 'group': stage = { type: 'group', groupBy: [], metrics: [{ column: '', agg: 'count' }] }; break
            case 'sort': stage = { type: 'sort', column: '', direction: 'asc' }; break
            case 'limit': stage = { type: 'limit', count: 100 }; break
            case 'percent': stage = { type: 'percent', column: '' }; break
            case 'date_part': stage = { type: 'date_part', field: '', part: 'year', targetField: '' }; break
            case 'string': stage = { type: 'string', field: '', op: 'upper' }; break
            case 'math': stage = { type: 'math', field: '', op: 'round' }; break
            case 'default_value': stage = { type: 'default_value', field: '', defaultValue: '' }; break
            case 'type_cast': stage = { type: 'type_cast', field: '', castType: 'number' }; break
            case 'pivot': stage = { type: 'pivot', rowKey: '', pivotColumn: '', valueColumn: '' }; break
            default: return
        }
        onChange({ ...config, stages: [...config.stages, stage] })
    }

    const updateViz = (viz: Partial<VizConfig>) => {
        onChange({ ...config, viz: { ...config.viz, ...viz } })
    }

    // Available columns at the end of the pipeline
    // If we have executed rows, derive columns from actual data (handles pivot's dynamic columns)
    const finalCols = useMemo(() => {
        if (executedRows && executedRows.length > 0) {
            const cols = new Set<string>()
            for (const row of executedRows) {
                for (const key of Object.keys(row)) cols.add(key)
            }
            return Array.from(cols)
        }
        return getColumnsAtStage(config.stages, config.stages.length - 1, dbColumns)
    }, [executedRows, config.stages, dbColumns])

    // Column name resolver
    const colName = (id: string, dbId?: string): string => {
        if (dbId) {
            const col = (dbColumns[dbId] || []).find(c => c.id === id)
            if (col) return col.name
        }
        for (const cols of Object.values(dbColumns)) {
            const col = cols.find(c => c.id === id)
            if (col) return col.name
        }
        return id
    }

    // Convert columns array to options
    const colOptions = (cols: string[]) => cols.map(c => ({ value: c, label: colName(c) }))
    const dbOptions = databases.map(db => ({ value: db.id, label: db.name }))

    return (
        <div className="pl-editor">
            {/* Stages */}
            {config.stages.map((stage, idx) => {
                const availCols = getColumnsAtStage(config.stages, idx - 1, dbColumns)

                return (
                    <div key={idx} className="pl-stage">
                        <div className="pl-stage-header">
                            <span className="pl-stage-label">{STAGE_LABELS[stage.type]}</span>
                            <div className="pl-stage-actions">
                                {idx > 0 && <button className="pl-stage-btn" onClick={() => moveStage(idx, -1)}><IconChevronUp size={10} /></button>}
                                {idx < config.stages.length - 1 && <button className="pl-stage-btn" onClick={() => moveStage(idx, 1)}><IconChevronDown size={10} /></button>}
                                {config.stages.length > 1 && <button className="pl-stage-btn pl-stage-btn-rm" onClick={() => removeStage(idx)}><IconX size={10} /></button>}
                            </div>
                        </div>
                        <div className="pl-stage-body">
                            <StageBody
                                stage={stage}
                                dbOptions={dbOptions}
                                dbColumns={dbColumns}
                                availableColumns={availCols}
                                colOptions={colOptions(availCols)}
                                colName={colName}
                                onChange={s => updateStage(idx, s)}
                            />
                        </div>
                    </div>
                )
            })}

            {/* Add stage */}
            <AddStageMenu onAdd={addStage} />

            {/* Viz config */}
            {finalCols.length > 0 && (
                <div className="pl-stage pl-stage-viz">
                    <div className="pl-stage-header">
                        <span className="pl-stage-label">Visualize</span>
                    </div>
                    <div className="pl-stage-body">
                        <div className="pl-field">
                            <label className="pl-label">X axis</label>
                            <Select
                                value={config.viz.xAxis}
                                options={colOptions(finalCols)}
                                placeholder="Select…"
                                onChange={v => updateViz({ xAxis: v })}
                            />
                        </div>
                        <div className="pl-field">
                            <label className="pl-label">Series</label>
                            <div className="pl-chips">
                                {finalCols.filter(c => c !== config.viz.xAxis).map(c => {
                                    const active = config.viz.series.includes(c)
                                    return (
                                        <button
                                            key={c}
                                            className={`pl-chip ${active ? 'active' : ''}`}
                                            onClick={() => {
                                                const series = active
                                                    ? config.viz.series.filter(s => s !== c)
                                                    : [...config.viz.series, c]
                                                updateViz({ series })
                                            }}
                                        >
                                            {colName(c)}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Stage Body Renderer ────────────────────────────────────

function StageBody({ stage, dbOptions, dbColumns, availableColumns, colOptions, colName, onChange }: {
    stage: Stage
    dbOptions: { value: string; label: string }[]
    dbColumns: Record<string, ColumnDef[]>
    availableColumns: string[]
    colOptions: { value: string; label: string }[]
    colName: (id: string, dbId?: string) => string
    onChange: (stage: Stage) => void
}) {
    switch (stage.type) {
        case 'source':
            return (
                <Select
                    value={stage.databaseId}
                    options={dbOptions}
                    placeholder="Select database…"
                    onChange={v => onChange({ ...stage, databaseId: v })}
                    className="pl-sel--full"
                />
            )

        case 'join': {
            const rightCols = (dbColumns[stage.databaseId] || []).map(c => ({ value: c.id, label: c.name }))
            return (
                <div className="pl-join">
                    <div className="pl-field">
                        <label className="pl-label">With</label>
                        <Select value={stage.databaseId} options={dbOptions} placeholder="Database…" onChange={v => onChange({ ...stage, databaseId: v })} />
                    </div>
                    <div className="pl-field">
                        <label className="pl-label">Type</label>
                        <Select
                            value={stage.joinType}
                            options={[{ value: 'left', label: 'Left join' }, { value: 'inner', label: 'Inner join' }]}
                            onChange={v => onChange({ ...stage, joinType: v as 'inner' | 'left' })}
                            size="sm"
                        />
                    </div>
                    <div className="pl-field">
                        <label className="pl-label">On</label>
                        <Select value={stage.leftKey} options={colOptions} placeholder="Left key…" onChange={v => onChange({ ...stage, leftKey: v })} />
                        <span className="pl-kw">=</span>
                        <Select value={stage.rightKey} options={rightCols} placeholder="Right key…" onChange={v => onChange({ ...stage, rightKey: v })} />
                    </div>
                </div>
            )
        }

        case 'filter':
            return (
                <div className="pl-filter">
                    {stage.conditions.map((c, i) => (
                        <div key={i} className="pl-filter-row">
                            {i > 0 && (
                                <Select
                                    value={stage.logic}
                                    options={[{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }]}
                                    onChange={v => onChange({ ...stage, logic: v as 'and' | 'or' })}
                                    size="xs"
                                />
                            )}
                            <Select
                                value={c.column}
                                options={colOptions}
                                placeholder="Column…"
                                onChange={v => {
                                    const next = [...stage.conditions]; next[i] = { ...c, column: v }
                                    onChange({ ...stage, conditions: next })
                                }}
                            />
                            <Select
                                value={c.op}
                                options={FILTER_OPS.map(op => ({ value: op.value, label: op.label }))}
                                onChange={v => {
                                    const next = [...stage.conditions]; next[i] = { ...c, op: v as FilterOp }
                                    onChange({ ...stage, conditions: next })
                                }}
                                size="sm"
                            />
                            {c.op !== 'is_empty' && c.op !== 'is_not_empty' && (
                                <input className="pl-input" placeholder="value" value={c.value} onChange={e => {
                                    const next = [...stage.conditions]; next[i] = { ...c, value: e.target.value }
                                    onChange({ ...stage, conditions: next })
                                }} />
                            )}
                            <button className="pl-rm" onClick={() => onChange({ ...stage, conditions: stage.conditions.filter((_, j) => j !== i) })}><IconX size={10} /></button>
                        </div>
                    ))}
                    <button className="pl-add-inline" onClick={() => onChange({ ...stage, conditions: [...stage.conditions, { column: '', op: 'eq' as FilterOp, value: '' }] })}>
                        + Condition
                    </button>
                </div>
            )

        case 'compute':
            return (
                <div className="pl-compute">
                    {stage.columns.map((c, i) => (
                        <div key={i} className="pl-compute-row">
                            <input className="pl-input pl-input-sm" placeholder="column name" value={c.name} onChange={e => {
                                const next = [...stage.columns]; next[i] = { ...c, name: e.target.value }
                                onChange({ ...stage, columns: next })
                            }} />
                            <span className="pl-kw">=</span>
                            <input className="pl-input" placeholder="{price} * {quantity}" value={c.expression} onChange={e => {
                                const next = [...stage.columns]; next[i] = { ...c, expression: e.target.value }
                                onChange({ ...stage, columns: next })
                            }} />
                            <button className="pl-rm" onClick={() => onChange({ ...stage, columns: stage.columns.filter((_, j) => j !== i) })}><IconX size={10} /></button>
                        </div>
                    ))}
                    <button className="pl-add-inline" onClick={() => onChange({ ...stage, columns: [...stage.columns, { name: '', expression: '' }] })}>
                        + Column
                    </button>
                </div>
            )

        case 'group':
            return (
                <div className="pl-group">
                    <div className="pl-field">
                        <label className="pl-label">By</label>
                        <div className="pl-chips">
                            {availableColumns.map(c => {
                                const active = stage.groupBy.includes(c)
                                return (
                                    <button
                                        key={c}
                                        className={`pl-chip ${active ? 'active' : ''}`}
                                        onClick={() => {
                                            const groupBy = active ? stage.groupBy.filter(g => g !== c) : [...stage.groupBy, c]
                                            onChange({ ...stage, groupBy })
                                        }}
                                    >
                                        {colName(c)}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    <div className="pl-field">
                        <label className="pl-label">Metrics</label>
                        <div className="pl-metrics">
                            {stage.metrics.map((m, i) => (
                                <div key={i} className="pl-metric-row">
                                    <Select
                                        value={m.agg}
                                        options={AGG_OPTIONS.map(a => ({ value: a.value, label: a.label }))}
                                        onChange={v => {
                                            const next = [...stage.metrics]; next[i] = { ...m, agg: v as Aggregation }
                                            onChange({ ...stage, metrics: next })
                                        }}
                                        size="sm"
                                    />
                                    {m.agg !== 'count' && (
                                        <>
                                            <span className="pl-kw">of</span>
                                            <Select
                                                value={m.column}
                                                options={colOptions}
                                                placeholder="Column…"
                                                onChange={v => {
                                                    const next = [...stage.metrics]; next[i] = { ...m, column: v }
                                                    onChange({ ...stage, metrics: next })
                                                }}
                                            />
                                        </>
                                    )}
                                    <input className="pl-input pl-input-sm" placeholder="as…" value={m.as || ''} onChange={e => {
                                        const next = [...stage.metrics]; next[i] = { ...m, as: e.target.value || undefined }
                                        onChange({ ...stage, metrics: next })
                                    }} />
                                    {stage.metrics.length > 1 && (
                                        <button className="pl-rm" onClick={() => onChange({ ...stage, metrics: stage.metrics.filter((_, j) => j !== i) })}><IconX size={10} /></button>
                                    )}
                                </div>
                            ))}
                            <button className="pl-add-inline" onClick={() => onChange({ ...stage, metrics: [...stage.metrics, { column: '', agg: 'count' }] })}>
                                + Metric
                            </button>
                        </div>
                    </div>
                </div>
            )

        case 'sort':
            return (
                <div className="pl-inline">
                    <Select value={stage.column} options={colOptions} placeholder="Column…" onChange={v => onChange({ ...stage, column: v })} />
                    <Select
                        value={stage.direction}
                        options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]}
                        onChange={v => onChange({ ...stage, direction: v as 'asc' | 'desc' })}
                        size="sm"
                    />
                </div>
            )

        case 'limit':
            return (
                <div className="pl-inline">
                    <span className="pl-kw">Show first</span>
                    <input className="pl-input pl-input-num" type="number" min={1} value={stage.count} onChange={e => onChange({ ...stage, count: parseInt(e.target.value) || 100 })} />
                    <span className="pl-kw">rows</span>
                </div>
            )

        case 'percent':
            return (
                <div className="pl-inline">
                    <Select value={stage.column} options={colOptions} placeholder="Column…" onChange={v => onChange({ ...stage, column: v })} />
                    <span className="pl-kw">as</span>
                    <input className="pl-input pl-input-sm" placeholder={stage.column ? `${stage.column}_%` : '%'} value={stage.as || ''} onChange={e => onChange({ ...stage, as: e.target.value || undefined })} />
                </div>
            )

        case 'date_part':
            return (
                <div className="pl-inline">
                    <Select value={stage.field} options={colOptions} placeholder="Date column…" onChange={v => onChange({ ...stage, field: v })} />
                    <span className="pl-kw">→</span>
                    <Select
                        value={stage.part}
                        options={[
                            { value: 'year', label: 'Year' },
                            { value: 'month', label: 'Month' },
                            { value: 'day', label: 'Day' },
                            { value: 'hour', label: 'Hour' },
                            { value: 'minute', label: 'Minute' },
                            { value: 'weekday', label: 'Weekday' },
                            { value: 'week', label: 'Week #' },
                        ]}
                        onChange={v => onChange({ ...stage, part: v as any })}
                        size="sm"
                    />
                    <span className="pl-kw">as</span>
                    <input className="pl-input pl-input-sm" value={stage.targetField || ''} onChange={e => onChange({ ...stage, targetField: e.target.value })} placeholder="Output col…" />
                </div>
            )

        case 'string': {
            const op = stage.op || 'upper'
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="pl-inline">
                        {op !== 'concat' && (
                            <Select value={stage.field} options={colOptions} placeholder="Column…" onChange={v => onChange({ ...stage, field: v })} />
                        )}
                        <Select
                            value={op}
                            options={[
                                { value: 'upper', label: 'UPPER' },
                                { value: 'lower', label: 'lower' },
                                { value: 'trim', label: 'Trim' },
                                { value: 'replace', label: 'Replace' },
                                { value: 'concat', label: 'Concat' },
                                { value: 'split', label: 'Split' },
                                { value: 'substring', label: 'Substring' },
                            ]}
                            onChange={v => onChange({ ...stage, op: v as StringStage['op'] })}
                            size="sm"
                        />
                    </div>
                    {op === 'replace' && (
                        <div className="pl-inline">
                            <input className="pl-input" value={stage.search || ''} onChange={e => onChange({ ...stage, search: e.target.value })} placeholder="Search…" />
                            <span className="pl-kw">→</span>
                            <input className="pl-input" value={stage.replaceWith || ''} onChange={e => onChange({ ...stage, replaceWith: e.target.value })} placeholder="Replace…" />
                        </div>
                    )}
                    {op === 'concat' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div className="pl-inline">
                                <span className="pl-kw">into</span>
                                <input className="pl-input" value={stage.targetField || ''} onChange={e => onChange({ ...stage, targetField: e.target.value })} placeholder="Output col…" />
                            </div>
                            <input className="pl-input" value={(stage.parts || []).join('')} onChange={e => onChange({ ...stage, parts: parseConcatParts(e.target.value) })} placeholder="{first} {last}" />
                        </div>
                    )}
                    {op === 'split' && (
                        <div className="pl-inline">
                            <span className="pl-kw">by</span>
                            <input className="pl-input" style={{ width: 50 }} value={stage.separator || ''} onChange={e => onChange({ ...stage, separator: e.target.value })} placeholder="," />
                            <span className="pl-kw">#</span>
                            <input className="pl-input" type="number" style={{ width: 50 }} value={stage.index ?? 0} onChange={e => onChange({ ...stage, index: parseInt(e.target.value) || 0 })} min={0} />
                            <span className="pl-kw">→</span>
                            <input className="pl-input" value={stage.targetField || ''} onChange={e => onChange({ ...stage, targetField: e.target.value })} placeholder="Output col…" />
                        </div>
                    )}
                    {op === 'substring' && (
                        <div className="pl-inline">
                            <span className="pl-kw">from</span>
                            <input className="pl-input" type="number" style={{ width: 50 }} value={stage.start ?? 0} onChange={e => onChange({ ...stage, start: parseInt(e.target.value) || 0 })} min={0} />
                            <span className="pl-kw">to</span>
                            <input className="pl-input" type="number" style={{ width: 50 }} value={stage.end ?? 0} onChange={e => onChange({ ...stage, end: parseInt(e.target.value) || 0 })} min={0} />
                        </div>
                    )}
                </div>
            )
        }

        case 'math':
            return (
                <div className="pl-inline">
                    <Select value={stage.field} options={colOptions} placeholder="Column…" onChange={v => onChange({ ...stage, field: v })} />
                    <span className="pl-kw">→</span>
                    <Select
                        value={stage.op}
                        options={[
                            { value: 'round', label: 'Round' },
                            { value: 'ceil', label: 'Ceil' },
                            { value: 'floor', label: 'Floor' },
                            { value: 'abs', label: 'Abs' },
                        ]}
                        onChange={v => onChange({ ...stage, op: v as any })}
                        size="sm"
                    />
                </div>
            )

        case 'default_value':
            return (
                <div className="pl-inline">
                    <Select value={stage.field} options={colOptions} placeholder="Column…" onChange={v => onChange({ ...stage, field: v })} />
                    <span className="pl-kw">default</span>
                    <input className="pl-input" value={stage.defaultValue || ''} onChange={e => onChange({ ...stage, defaultValue: e.target.value })} placeholder="Default value…" />
                </div>
            )

        case 'type_cast':
            return (
                <div className="pl-inline">
                    <Select value={stage.field} options={colOptions} placeholder="Column…" onChange={v => onChange({ ...stage, field: v })} />
                    <span className="pl-kw">→</span>
                    <Select
                        value={stage.castType}
                        options={[
                            { value: 'number', label: 'Number' },
                            { value: 'string', label: 'String' },
                            { value: 'bool', label: 'Boolean' },
                            { value: 'date', label: 'Date' },
                            { value: 'datetime', label: 'Date & Time' },
                        ]}
                        onChange={v => onChange({ ...stage, castType: v as any })}
                        size="sm"
                    />
                </div>
            )

        case 'pivot':
            return (
                <div className="pl-join">
                    <div className="pl-field">
                        <label className="pl-label">Rows</label>
                        <Select value={stage.rowKey} options={colOptions} placeholder="Row key…" onChange={v => onChange({ ...stage, rowKey: v })} />
                    </div>
                    <div className="pl-field">
                        <label className="pl-label">Columns</label>
                        <Select value={stage.pivotColumn} options={colOptions} placeholder="Pivot column…" onChange={v => onChange({ ...stage, pivotColumn: v })} />
                    </div>
                    <div className="pl-field">
                        <label className="pl-label">Values</label>
                        <Select value={stage.valueColumn} options={colOptions} placeholder="Value column…" onChange={v => onChange({ ...stage, valueColumn: v })} />
                    </div>
                </div>
            )

        default:
            return null
    }
}

// ── Helpers ────────────────────────────────────────────────

function parseConcatParts(input: string): string[] {
    const parts: string[] = []
    let i = 0
    while (i < input.length) {
        if (input[i] === '{') {
            const end = input.indexOf('}', i)
            if (end !== -1) { parts.push(input.slice(i, end + 1)); i = end + 1 }
            else { parts.push(input.slice(i)); break }
        } else {
            const next = input.indexOf('{', i)
            if (next !== -1) { parts.push(input.slice(i, next)); i = next }
            else { parts.push(input.slice(i)); break }
        }
    }
    return parts
}

// ── Add Stage Menu ─────────────────────────────────────────

function AddStageMenu({ onAdd }: { onAdd: (type: Stage['type']) => void }) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

    useEffect(() => {
        if (!open || !triggerRef.current) return
        const rect = triggerRef.current.getBoundingClientRect()
        setPos({ top: rect.bottom + 2, left: rect.left })
    }, [open])

    const types: { type: Stage['type']; label: string; desc: string }[] = [
        { type: 'source', label: 'Source', desc: 'Load data from a database' },
        { type: 'join', label: 'Join', desc: 'Merge with another database' },
        { type: 'filter', label: 'Filter', desc: 'Keep rows matching conditions' },
        { type: 'compute', label: 'Compute', desc: 'Add calculated columns' },
        { type: 'string', label: 'String', desc: 'Manipulate text values' },
        { type: 'date_part', label: 'Date Part', desc: 'Extract part of a date' },
        { type: 'type_cast', label: 'Type Cast', desc: 'Convert column types' },
        { type: 'math', label: 'Math', desc: 'Apply math functions' },
        { type: 'default_value', label: 'Default Value', desc: 'Fill empty values' },
        { type: 'group', label: 'Group', desc: 'Aggregate by categories' },
        { type: 'pivot', label: 'Pivot', desc: 'Turn row values into columns' },
        { type: 'percent', label: 'Percent', desc: 'Add % of total column' },
        { type: 'sort', label: 'Sort', desc: 'Order rows' },
        { type: 'limit', label: 'Limit', desc: 'Cap row count' },
    ]

    return (
        <div className="pl-add-wrap" ref={triggerRef}>
            <button className="pl-add-btn" onClick={() => setOpen(!open)}>
                <IconPlus size={11} /> Add Stage
            </button>
            {open && pos && createPortal(
                <>
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className="pl-add-menu"
                        style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 200, zIndex: 9999 }}
                    >
                        {types.map(t => (
                            <div
                                key={t.type}
                                className="pl-add-option"
                                onClick={() => { onAdd(t.type); setOpen(false) }}
                            >
                                <span className="pl-add-option-label">{t.label}</span>
                                <span className="pl-add-option-desc">{t.desc}</span>
                            </div>
                        ))}
                    </div>
                </>,
                document.body
            )}
        </div>
    )
}
