import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconPlus, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import { rpcCall } from '../sdk'
import { Select } from '../shared/components/Select'

// ── Types ──────────────────────────────────────────────────

export type TransformType = 'filter' | 'rename' | 'select' | 'dedupe' | 'compute' | 'sort' | 'limit' | 'type_cast' | 'flatten' | 'string' | 'date_part' | 'default_value' | 'math'

export interface TransformStage {
    type: TransformType
    config: Record<string, any>
}

export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'

export const FILTER_OPS: { value: FilterOp; label: string }[] = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: '!contains' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
]

export const STAGE_LABELS: Record<TransformType, string> = {
    filter: 'Filter',
    rename: 'Rename',
    select: 'Select',
    dedupe: 'Dedupe',
    compute: 'Compute',
    sort: 'Sort',
    limit: 'Limit',
    type_cast: 'Type Cast',
    flatten: 'Flatten JSON',
    string: 'String',
    date_part: 'Date Part',
    default_value: 'Default Value',
    math: 'Math',
}

export const STAGE_DESCS: Record<TransformType, string> = {
    filter: 'Keep rows matching conditions',
    rename: 'Rename columns',
    select: 'Pick which columns to keep',
    dedupe: 'Remove duplicate rows',
    compute: 'Add calculated columns',
    sort: 'Order rows by column',
    limit: 'Cap number of rows',
    type_cast: 'Convert column types',
    flatten: 'Extract fields from JSON column',
    string: 'Manipulate text values',
    date_part: 'Extract part of a date',
    default_value: 'Fill empty values',
    math: 'Apply math functions',
}

// ── Column Tracking ────────────────────────────────────────

/** Track available columns through the pipeline stages. */
export function getColumnsAtStage(
    sourceColumns: string[],
    stages: TransformStage[],
    stageIndex: number,
): string[] {
    let cols = [...sourceColumns]

    for (let i = 0; i <= stageIndex && i < stages.length; i++) {
        const s = stages[i]
        switch (s.type) {
            case 'select': {
                const fields = (s.config.fields as string[]) || []
                if (fields.length > 0) cols = cols.filter(c => fields.includes(c))
                break
            }
            case 'rename': {
                const mapping = (s.config.mapping as Record<string, string>) || {}
                cols = cols.map(c => mapping[c] || c)
                break
            }
            case 'compute': {
                const columns = (s.config.columns as { name: string; expression: string }[]) || []
                for (const c of columns) {
                    if (c.name && !cols.includes(c.name)) cols.push(c.name)
                }
                break
            }
            case 'flatten': {
                const fields = (s.config.fields as { path: string; alias: string }[]) || []
                for (const f of fields) {
                    const outName = f.alias || f.path
                    if (outName && !cols.includes(outName)) cols.push(outName)
                }
                break
            }
            case 'string': {
                if (s.config.op === 'concat' || s.config.op === 'split') {
                    const tgt = s.config.targetField as string
                    if (tgt && !cols.includes(tgt)) cols.push(tgt)
                }
                break
            }
            case 'date_part': {
                const tgt = (s.config.targetField as string) || `${s.config.field || ''}_${s.config.part || ''}`
                if (tgt && !cols.includes(tgt)) cols.push(tgt)
                break
            }
            // filter, dedupe, sort, limit, type_cast, default_value, math don't change column set
        }
    }

    return cols
}

// ── Default stage factory ──────────────────────────────────

function defaultStage(type: TransformType): TransformStage {
    switch (type) {
        case 'filter': return { type, config: { field: '', op: 'eq', value: '' } }
        case 'rename': return { type, config: { mapping: {} } }
        case 'select': return { type, config: { fields: [] } }
        case 'dedupe': return { type, config: { key: '' } }
        case 'compute': return { type, config: { columns: [{ name: '', expression: '' }] } }
        case 'sort': return { type, config: { field: '', direction: 'asc' } }
        case 'limit': return { type, config: { count: 100 } }
        case 'type_cast': return { type, config: { field: '', castType: 'number' } }
        case 'flatten': return { type, config: { sourceField: '', fields: [{ path: '', alias: '' }] } }
        case 'string': return { type, config: { field: '', op: 'upper' } }
        case 'date_part': return { type, config: { field: '', part: 'year', targetField: '' } }
        case 'default_value': return { type, config: { field: '', defaultValue: '' } }
        case 'math': return { type, config: { field: '', op: 'round' } }
    }
}

// ── Props ──────────────────────────────────────────────────

interface ETLPipelineProps {
    stages: TransformStage[]
    sourceType: string
    sourceConfig: Record<string, any>
    onChange: (stages: TransformStage[]) => void
}

// ── Pipeline Editor ────────────────────────────────────────

export function ETLPipeline({ stages, sourceType, sourceConfig, onChange }: ETLPipelineProps) {
    const [sourceColumns, setSourceColumns] = useState<string[]>([])
    const [loadingSchema, setLoadingSchema] = useState(false)

    // Discover source columns when source config changes
    useEffect(() => {
        if (!sourceType) { setSourceColumns([]); return }

        // Check if source has enough config to discover
        const cfgJSON = JSON.stringify(sourceConfig || {})
        if (cfgJSON === '{}') { setSourceColumns([]); return }

        setLoadingSchema(true)
        rpcCall('DiscoverETLSchema', sourceType, cfgJSON)
            .then(schema => {
                if (schema?.fields) {
                    setSourceColumns(schema.fields.map((f: any) => f.name))
                }
            })
            .catch(() => setSourceColumns([]))
            .finally(() => setLoadingSchema(false))
    }, [sourceType, JSON.stringify(sourceConfig)])

    const updateStage = useCallback((idx: number, stage: TransformStage) => {
        const next = [...stages]
        next[idx] = stage
        onChange(next)
    }, [stages, onChange])

    const removeStage = useCallback((idx: number) => {
        onChange(stages.filter((_, i) => i !== idx))
    }, [stages, onChange])

    const moveStage = useCallback((idx: number, dir: -1 | 1) => {
        const next = [...stages]
        const target = idx + dir
        if (target < 0 || target >= next.length) return
            ;[next[idx], next[target]] = [next[target], next[idx]]
        onChange(next)
    }, [stages, onChange])

    const addStage = useCallback((type: TransformType) => {
        onChange([...stages, defaultStage(type)])
    }, [stages, onChange])

    const colOptions = (cols: string[]) => cols.map(c => ({ value: c, label: c }))

    if (loadingSchema) {
        return (
            <>
                <div className="pl-stage">
                    <div className="pl-stage-body" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>
                        Discovering source columns…
                    </div>
                </div>
                <AddTransformMenu onAdd={addStage} />
            </>
        )
    }

    return (
        <>
            {/* Source columns info */}
            {sourceColumns.length > 0 && (
                <div className="pl-stage">
                    <div className="pl-stage-header">
                        <span className="pl-stage-label">Source Columns</span>
                        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{sourceColumns.length} fields</span>
                    </div>
                    <div className="pl-stage-body">
                        <div className="pl-chips">
                            {sourceColumns.map(c => (
                                <span key={c} className="pl-chip" style={{ cursor: 'default' }}>{c}</span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Transform stages */}
            {stages.map((stage, idx) => {
                const availCols = getColumnsAtStage(sourceColumns, stages, idx - 1)

                return (
                    <div key={idx} className="pl-stage">
                        <div className="pl-stage-header">
                            <span className="pl-stage-label">{STAGE_LABELS[stage.type]}</span>
                            <div className="pl-stage-actions">
                                {idx > 0 && <button className="pl-stage-btn" onClick={() => moveStage(idx, -1)}><IconChevronUp size={10} /></button>}
                                {idx < stages.length - 1 && <button className="pl-stage-btn" onClick={() => moveStage(idx, 1)}><IconChevronDown size={10} /></button>}
                                <button className="pl-stage-btn pl-stage-btn-rm" onClick={() => removeStage(idx)}><IconX size={10} /></button>
                            </div>
                        </div>
                        <div className="pl-stage-body">
                            <TransformStageBody
                                stage={stage}
                                availableCols={availCols}
                                colOptions={colOptions(availCols)}
                                onChange={s => updateStage(idx, s)}
                            />
                        </div>
                    </div>
                )
            })}

            {/* Output columns preview */}
            {stages.length > 0 && (
                <div className="pl-stage">
                    <div className="pl-stage-header">
                        <span className="pl-stage-label">Output</span>
                        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
                            {getColumnsAtStage(sourceColumns, stages, stages.length - 1).length} fields
                        </span>
                    </div>
                    <div className="pl-stage-body">
                        <div className="pl-chips">
                            {getColumnsAtStage(sourceColumns, stages, stages.length - 1).map(c => (
                                <span key={c} className="pl-chip active" style={{ cursor: 'default' }}>{c}</span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Add transform stage */}
            <AddTransformMenu onAdd={addStage} />
        </>
    )
}

// ── Stage Body Renderer ────────────────────────────────────

function TransformStageBody({ stage, availableCols, colOptions, onChange }: {
    stage: TransformStage
    availableCols: string[]
    colOptions: { value: string; label: string }[]
    onChange: (stage: TransformStage) => void
}) {
    const updateConfig = (patch: Record<string, any>) => {
        onChange({ ...stage, config: { ...stage.config, ...patch } })
    }

    switch (stage.type) {
        case 'filter':
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="pl-inline">
                        <Select
                            value={stage.config.field || ''}
                            options={colOptions}
                            placeholder="Column…"
                            onChange={v => updateConfig({ field: v })}
                        />
                        <Select
                            value={stage.config.op || 'eq'}
                            options={FILTER_OPS}
                            onChange={v => updateConfig({ op: v })}
                        />
                        {!['is_empty', 'is_not_empty'].includes(stage.config.op) && (
                            <input
                                className="pl-input"
                                value={stage.config.value || ''}
                                onChange={e => updateConfig({ value: e.target.value })}
                                placeholder="Value…"
                            />
                        )}
                    </div>
                </div>
            )

        case 'rename': {
            const mapping = (stage.config.mapping || {}) as Record<string, string>
            const entries = Object.entries(mapping)
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entries.map(([oldName, newName], i) => (
                        <div key={i} className="pl-inline">
                            <Select
                                value={oldName}
                                options={colOptions}
                                placeholder="From…"
                                onChange={v => {
                                    const next = { ...mapping }
                                    delete next[oldName]
                                    next[v] = newName
                                    updateConfig({ mapping: next })
                                }}
                            />
                            <span className="pl-kw">→</span>
                            <input
                                className="pl-input"
                                value={newName}
                                onChange={e => {
                                    const next = { ...mapping, [oldName]: e.target.value }
                                    updateConfig({ mapping: next })
                                }}
                                placeholder="New name…"
                            />
                            <button className="pl-stage-btn pl-stage-btn-rm" onClick={() => {
                                const next = { ...mapping }
                                delete next[oldName]
                                updateConfig({ mapping: next })
                            }}><IconX size={10} /></button>
                        </div>
                    ))}
                    <button className="pl-add-btn" style={{ alignSelf: 'flex-start' }} onClick={() => {
                        const unused = availableCols.find(c => !mapping[c]) || ''
                        updateConfig({ mapping: { ...mapping, [unused]: '' } })
                    }}>
                        <IconPlus size={10} /> Add Rename
                    </button>
                </div>
            )
        }

        case 'select': {
            const fields = (stage.config.fields || []) as string[]
            return (
                <div className="pl-chips">
                    {availableCols.map(c => {
                        const active = fields.includes(c)
                        return (
                            <button
                                key={c}
                                className={`pl-chip ${active ? 'active' : ''}`}
                                onClick={() => {
                                    const next = active
                                        ? fields.filter(f => f !== c)
                                        : [...fields, c]
                                    updateConfig({ fields: next })
                                }}
                            >
                                {c}
                            </button>
                        )
                    })}
                </div>
            )
        }

        case 'dedupe':
            return (
                <div className="pl-inline">
                    <span className="pl-kw">by</span>
                    <Select
                        value={stage.config.key || ''}
                        options={colOptions}
                        placeholder="Key column…"
                        onChange={v => updateConfig({ key: v })}
                    />
                </div>
            )

        case 'compute': {
            const columns = (stage.config.columns || []) as { name: string; expression: string }[]
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {columns.map((col, i) => (
                        <div key={i} className="pl-inline">
                            <input
                                className="pl-input"
                                style={{ width: 90 }}
                                value={col.name}
                                onChange={e => {
                                    const next = [...columns]
                                    next[i] = { ...col, name: e.target.value }
                                    updateConfig({ columns: next })
                                }}
                                placeholder="Column name…"
                            />
                            <span className="pl-kw">=</span>
                            <input
                                className="pl-input"
                                style={{ flex: 1 }}
                                value={col.expression}
                                onChange={e => {
                                    const next = [...columns]
                                    next[i] = { ...col, expression: e.target.value }
                                    updateConfig({ columns: next })
                                }}
                                placeholder="{price} * {quantity}"
                            />
                            {columns.length > 1 && (
                                <button className="pl-stage-btn pl-stage-btn-rm" onClick={() => {
                                    updateConfig({ columns: columns.filter((_, j) => j !== i) })
                                }}><IconX size={10} /></button>
                            )}
                        </div>
                    ))}
                    <button className="pl-add-btn" style={{ alignSelf: 'flex-start' }} onClick={() => {
                        updateConfig({ columns: [...columns, { name: '', expression: '' }] })
                    }}>
                        <IconPlus size={10} /> Add Column
                    </button>
                </div>
            )
        }

        case 'sort':
            return (
                <div className="pl-inline">
                    <Select
                        value={stage.config.field || ''}
                        options={colOptions}
                        placeholder="Column…"
                        onChange={v => updateConfig({ field: v })}
                    />
                    <Select
                        value={stage.config.direction || 'asc'}
                        options={[
                            { value: 'asc', label: 'Ascending ↑' },
                            { value: 'desc', label: 'Descending ↓' },
                        ]}
                        onChange={v => updateConfig({ direction: v })}
                    />
                </div>
            )

        case 'limit':
            return (
                <div className="pl-inline">
                    <span className="pl-kw">max</span>
                    <input
                        className="pl-input"
                        type="number"
                        style={{ width: 70 }}
                        value={stage.config.count || 100}
                        onChange={e => updateConfig({ count: parseInt(e.target.value) || 100 })}
                        min={1}
                    />
                    <span className="pl-kw">rows</span>
                </div>
            )

        case 'type_cast':
            return (
                <div className="pl-inline">
                    <Select
                        value={stage.config.field || ''}
                        options={colOptions}
                        placeholder="Column…"
                        onChange={v => updateConfig({ field: v })}
                    />
                    <span className="pl-kw">→</span>
                    <Select
                        value={stage.config.castType || 'number'}
                        options={[
                            { value: 'number', label: 'Number' },
                            { value: 'string', label: 'String' },
                            { value: 'bool', label: 'Boolean' },
                            { value: 'date', label: 'Date' },
                            { value: 'datetime', label: 'Date & Time' },
                        ]}
                        onChange={v => updateConfig({ castType: v })}
                    />
                </div>
            )

        case 'flatten': {
            const fields = (stage.config.fields || []) as { path: string; alias: string }[]
            return (
                <div className="pl-stage-body">
                    <div className="pl-inline">
                        <span className="pl-kw">from</span>
                        <Select
                            value={stage.config.sourceField || ''}
                            options={colOptions}
                            placeholder="JSON column…"
                            onChange={v => updateConfig({ sourceField: v })}
                        />
                    </div>
                    {fields.map((f, i) => (
                        <div key={i} className="pl-inline" style={{ marginTop: 4 }}>
                            <input
                                className="pl-input"
                                style={{ flex: 1 }}
                                value={f.path}
                                onChange={e => {
                                    const next = [...fields]
                                    next[i] = { ...f, path: e.target.value }
                                    updateConfig({ fields: next })
                                }}
                                placeholder="path (e.g. providers.gitProvider)"
                            />
                            <span className="pl-kw">→</span>
                            <input
                                className="pl-input"
                                style={{ flex: 1 }}
                                value={f.alias}
                                onChange={e => {
                                    const next = [...fields]
                                    next[i] = { ...f, alias: e.target.value }
                                    updateConfig({ fields: next })
                                }}
                                placeholder="output column (optional)"
                            />
                            {fields.length > 1 && (
                                <button className="pl-stage-btn pl-stage-btn-rm" onClick={() => {
                                    updateConfig({ fields: fields.filter((_, j) => j !== i) })
                                }}><IconX size={10} /></button>
                            )}
                        </div>
                    ))}
                    <button className="pl-add-btn" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => {
                        updateConfig({ fields: [...fields, { path: '', alias: '' }] })
                    }}>
                        <IconPlus size={10} /> Add Field
                    </button>
                </div>
            )
        }

        case 'string': {
            const op = (stage.config.op || 'upper') as string
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="pl-inline">
                        {op !== 'concat' && (
                            <Select
                                value={stage.config.field || ''}
                                options={colOptions}
                                placeholder="Column…"
                                onChange={v => updateConfig({ field: v })}
                            />
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
                            onChange={v => updateConfig({ op: v })}
                        />
                    </div>
                    {op === 'replace' && (
                        <div className="pl-inline">
                            <input
                                className="pl-input"
                                value={stage.config.search || ''}
                                onChange={e => updateConfig({ search: e.target.value })}
                                placeholder="Search…"
                            />
                            <span className="pl-kw">→</span>
                            <input
                                className="pl-input"
                                value={stage.config.replaceWith || ''}
                                onChange={e => updateConfig({ replaceWith: e.target.value })}
                                placeholder="Replace with…"
                            />
                        </div>
                    )}
                    {op === 'concat' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div className="pl-inline">
                                <span className="pl-kw">into</span>
                                <input
                                    className="pl-input"
                                    value={stage.config.targetField || ''}
                                    onChange={e => updateConfig({ targetField: e.target.value })}
                                    placeholder="Output column…"
                                />
                            </div>
                            <input
                                className="pl-input"
                                value={(stage.config.parts || []).join('')}
                                onChange={e => updateConfig({ parts: parseConcatParts(e.target.value, availableCols) })}
                                placeholder="{first_name} {last_name}"
                            />
                        </div>
                    )}
                    {op === 'split' && (
                        <div className="pl-inline">
                            <span className="pl-kw">by</span>
                            <input
                                className="pl-input"
                                style={{ width: 50 }}
                                value={stage.config.separator || ''}
                                onChange={e => updateConfig({ separator: e.target.value })}
                                placeholder=","
                            />
                            <span className="pl-kw">#</span>
                            <input
                                className="pl-input"
                                type="number"
                                style={{ width: 50 }}
                                value={stage.config.index ?? 0}
                                onChange={e => updateConfig({ index: parseInt(e.target.value) || 0 })}
                                min={0}
                            />
                            <span className="pl-kw">→</span>
                            <input
                                className="pl-input"
                                value={stage.config.targetField || ''}
                                onChange={e => updateConfig({ targetField: e.target.value })}
                                placeholder="Output col…"
                            />
                        </div>
                    )}
                    {op === 'substring' && (
                        <div className="pl-inline">
                            <span className="pl-kw">from</span>
                            <input
                                className="pl-input"
                                type="number"
                                style={{ width: 50 }}
                                value={stage.config.start ?? 0}
                                onChange={e => updateConfig({ start: parseInt(e.target.value) || 0 })}
                                min={0}
                            />
                            <span className="pl-kw">to</span>
                            <input
                                className="pl-input"
                                type="number"
                                style={{ width: 50 }}
                                value={stage.config.end ?? 0}
                                onChange={e => updateConfig({ end: parseInt(e.target.value) || 0 })}
                                min={0}
                            />
                        </div>
                    )}
                </div>
            )
        }

        case 'date_part':
            return (
                <div className="pl-inline">
                    <Select
                        value={stage.config.field || ''}
                        options={colOptions}
                        placeholder="Date column…"
                        onChange={v => updateConfig({ field: v })}
                    />
                    <span className="pl-kw">→</span>
                    <Select
                        value={stage.config.part || 'year'}
                        options={[
                            { value: 'year', label: 'Year' },
                            { value: 'month', label: 'Month' },
                            { value: 'day', label: 'Day' },
                            { value: 'hour', label: 'Hour' },
                            { value: 'minute', label: 'Minute' },
                            { value: 'weekday', label: 'Weekday' },
                            { value: 'week', label: 'Week #' },
                        ]}
                        onChange={v => updateConfig({ part: v })}
                    />
                    <span className="pl-kw">as</span>
                    <input
                        className="pl-input"
                        value={stage.config.targetField || ''}
                        onChange={e => updateConfig({ targetField: e.target.value })}
                        placeholder="Output col…"
                    />
                </div>
            )

        case 'default_value':
            return (
                <div className="pl-inline">
                    <Select
                        value={stage.config.field || ''}
                        options={colOptions}
                        placeholder="Column…"
                        onChange={v => updateConfig({ field: v })}
                    />
                    <span className="pl-kw">default</span>
                    <input
                        className="pl-input"
                        value={stage.config.defaultValue || ''}
                        onChange={e => updateConfig({ defaultValue: e.target.value })}
                        placeholder="Default value…"
                    />
                </div>
            )

        case 'math':
            return (
                <div className="pl-inline">
                    <Select
                        value={stage.config.field || ''}
                        options={colOptions}
                        placeholder="Column…"
                        onChange={v => updateConfig({ field: v })}
                    />
                    <span className="pl-kw">→</span>
                    <Select
                        value={stage.config.op || 'round'}
                        options={[
                            { value: 'round', label: 'Round' },
                            { value: 'ceil', label: 'Ceil' },
                            { value: 'floor', label: 'Floor' },
                            { value: 'abs', label: 'Abs' },
                        ]}
                        onChange={v => updateConfig({ op: v })}
                    />
                </div>
            )

        default:
            return null
    }
}

// ── Helpers ────────────────────────────────────────────────

/** Parse a concat expression like "{first} {last}" into parts array */
function parseConcatParts(input: string, _cols: string[]): string[] {
    const parts: string[] = []
    let i = 0
    while (i < input.length) {
        if (input[i] === '{') {
            const end = input.indexOf('}', i)
            if (end !== -1) {
                parts.push(input.slice(i, end + 1))
                i = end + 1
            } else {
                parts.push(input.slice(i))
                break
            }
        } else {
            const next = input.indexOf('{', i)
            if (next !== -1) {
                parts.push(input.slice(i, next))
                i = next
            } else {
                parts.push(input.slice(i))
                break
            }
        }
    }
    return parts
}

// ── Add Transform Menu ─────────────────────────────────────

function AddTransformMenu({ onAdd }: { onAdd: (type: TransformType) => void }) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

    useEffect(() => {
        if (!open || !triggerRef.current) return
        const rect = triggerRef.current.getBoundingClientRect()
        setPos({ top: rect.bottom + 2, left: rect.left })
    }, [open])

    const types: TransformType[] = ['filter', 'select', 'rename', 'compute', 'string', 'date_part', 'type_cast', 'dedupe', 'sort', 'limit', 'flatten', 'default_value', 'math']

    return (
        <div className="pl-add-wrap" ref={triggerRef}>
            <button className="pl-add-btn" onClick={() => setOpen(!open)}>
                <IconPlus size={11} /> Add Transform
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
                                key={t}
                                className="pl-add-option"
                                onClick={() => { onAdd(t); setOpen(false) }}
                            >
                                <span className="pl-add-option-label">{STAGE_LABELS[t]}</span>
                                <span className="pl-add-option-desc">{STAGE_DESCS[t]}</span>
                            </div>
                        ))}
                    </div>
                </>,
                document.body
            )}
        </div>
    )
}
