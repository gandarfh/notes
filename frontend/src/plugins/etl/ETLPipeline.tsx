import { useState, useEffect, useCallback } from 'react'
import { IconPlus, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import { api } from '../../bridge/wails'
import { Select } from '../chart/Select'

// ── Types ──────────────────────────────────────────────────

export type TransformType = 'filter' | 'rename' | 'select' | 'dedupe' | 'compute' | 'sort' | 'limit' | 'type_cast'

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
            // filter, dedupe, sort, limit, type_cast don't change column set
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
        api.discoverETLSchema(sourceType, cfgJSON)
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
            <div className="pl-stage">
                <div className="pl-stage-body" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>
                    Discovering source columns…
                </div>
            </div>
        )
    }

    if (sourceColumns.length === 0 && stages.length === 0) {
        return null // No source configured yet
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
                        ]}
                        onChange={v => updateConfig({ castType: v })}
                    />
                </div>
            )

        default:
            return null
    }
}

// ── Add Transform Menu ─────────────────────────────────────

function AddTransformMenu({ onAdd }: { onAdd: (type: TransformType) => void }) {
    const [open, setOpen] = useState(false)

    const types: TransformType[] = ['filter', 'select', 'rename', 'compute', 'dedupe', 'sort', 'limit', 'type_cast']

    return (
        <div className="pl-add-wrap">
            <button className="pl-add-btn" onClick={() => setOpen(!open)}>
                <IconPlus size={11} /> Add Transform
            </button>
            {open && (
                <div className="pl-add-menu" onMouseLeave={() => setOpen(false)}>
                    {types.map(t => (
                        <div key={t} className="pl-add-option" onClick={() => { onAdd(t); setOpen(false) }}>
                            <span className="pl-add-option-label">{STAGE_LABELS[t]}</span>
                            <span className="pl-add-option-desc">{STAGE_DESCS[t]}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
