import { useState } from 'react'
import type { ColumnDef } from '../../bridge/wails'

// ── Config Types ───────────────────────────────────────────

export type FilterOperator =
    | 'is' | 'is_not' | 'contains' | 'starts_with' | 'ends_with'
    | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between'
    | 'is_true' | 'is_false'
    | 'before' | 'after'

export interface FilterCondition {
    column: string
    operator: FilterOperator
    value: string
    value2?: string  // for 'between'
}

export interface Metric {
    aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
    column?: string  // not needed for count
}

export interface SortRule {
    column: string
    direction: 'asc' | 'desc'
}

export interface NotebookConfig {
    databaseId: string
    filters: FilterCondition[]
    summarize: {
        metrics: Metric[]
        groupBy: string[]
    }
    sort: SortRule[]
    limit?: number
}

export function defaultNotebookConfig(): NotebookConfig {
    return {
        databaseId: '',
        filters: [],
        summarize: {
            metrics: [{ aggregation: 'count' }],
            groupBy: [],
        },
        sort: [],
        limit: undefined,
    }
}

// ── Operator helpers ───────────────────────────────────────

const TEXT_OPS: { value: FilterOperator; label: string }[] = [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
]

const NUMBER_OPS: { value: FilterOperator; label: string }[] = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'between', label: 'between' },
]

const DATE_OPS: { value: FilterOperator; label: string }[] = [
    { value: 'is', label: 'is' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
]

const CHECKBOX_OPS: { value: FilterOperator; label: string }[] = [
    { value: 'is_true', label: 'is true' },
    { value: 'is_false', label: 'is false' },
]

function opsForType(type: string): { value: FilterOperator; label: string }[] {
    switch (type) {
        case 'number': case 'rating': case 'progress': return NUMBER_OPS
        case 'date': case 'datetime': return DATE_OPS
        case 'checkbox': return CHECKBOX_OPS
        default: return TEXT_OPS
    }
}

// ── Notebook Editor ────────────────────────────────────────

interface NotebookEditorProps {
    config: NotebookConfig
    columns: ColumnDef[]
    databases: { id: string; name: string }[]
    onChange: (config: NotebookConfig) => void
}

export function NotebookEditor({ config, columns, databases, onChange }: NotebookEditorProps) {
    const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set(['data', 'summarize']))

    const toggleStep = (step: string) => {
        const next = new Set(expandedSteps)
        next.has(step) ? next.delete(step) : next.add(step)
        setExpandedSteps(next)
    }

    const numericCols = columns.filter(c =>
        c.type === 'number' || c.type === 'progress' || c.type === 'rating'
    )

    const hasFilters = config.filters.length > 0
    const hasSort = config.sort.length > 0
    const hasLimit = config.limit !== undefined && config.limit > 0

    return (
        <div className="nb-editor">
            {/* ── Data Step ── */}
            <StepCard
                icon="📊"
                title="Data"
                expanded={expandedSteps.has('data')}
                onToggle={() => toggleStep('data')}
                removable={false}
            >
                <select
                    className="nb-select nb-select-full"
                    value={config.databaseId}
                    onChange={e => onChange({ ...config, databaseId: e.target.value, filters: [], summarize: { ...config.summarize, groupBy: [] }, sort: [] })}
                >
                    <option value="">Pick a database…</option>
                    {databases.map(db => (
                        <option key={db.id} value={db.id}>{db.name}</option>
                    ))}
                </select>
            </StepCard>

            {config.databaseId && (
                <>
                    {/* ── Filter Step ── */}
                    {hasFilters ? (
                        <StepCard
                            icon="🔍"
                            title="Filter"
                            expanded={expandedSteps.has('filter')}
                            onToggle={() => toggleStep('filter')}
                            onRemove={() => onChange({ ...config, filters: [] })}
                        >
                            {config.filters.map((f, i) => {
                                const col = columns.find(c => c.id === f.column)
                                const ops = col ? opsForType(col.type) : TEXT_OPS
                                const needsValue = f.operator !== 'is_true' && f.operator !== 'is_false'

                                return (
                                    <div key={i} className="nb-filter-row">
                                        <select
                                            className="nb-select"
                                            value={f.column}
                                            onChange={e => {
                                                const next = [...config.filters]
                                                const newCol = columns.find(c => c.id === e.target.value)
                                                const newOps = newCol ? opsForType(newCol.type) : TEXT_OPS
                                                next[i] = { ...f, column: e.target.value, operator: newOps[0].value, value: '' }
                                                onChange({ ...config, filters: next })
                                            }}
                                        >
                                            <option value="">column…</option>
                                            {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>

                                        <select
                                            className="nb-select nb-select-op"
                                            value={f.operator}
                                            onChange={e => {
                                                const next = [...config.filters]
                                                next[i] = { ...f, operator: e.target.value as FilterOperator }
                                                onChange({ ...config, filters: next })
                                            }}
                                        >
                                            {ops.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                                        </select>

                                        {needsValue && (
                                            <input
                                                className="nb-input"
                                                placeholder="value"
                                                value={f.value}
                                                type={col?.type === 'number' || col?.type === 'rating' || col?.type === 'progress' ? 'number' : col?.type === 'date' || col?.type === 'datetime' ? 'date' : 'text'}
                                                onChange={e => {
                                                    const next = [...config.filters]
                                                    next[i] = { ...f, value: e.target.value }
                                                    onChange({ ...config, filters: next })
                                                }}
                                            />
                                        )}

                                        {f.operator === 'between' && (
                                            <>
                                                <span className="nb-connector">and</span>
                                                <input
                                                    className="nb-input"
                                                    placeholder="value"
                                                    value={f.value2 || ''}
                                                    type={col?.type === 'number' ? 'number' : 'text'}
                                                    onChange={e => {
                                                        const next = [...config.filters]
                                                        next[i] = { ...f, value2: e.target.value }
                                                        onChange({ ...config, filters: next })
                                                    }}
                                                />
                                            </>
                                        )}

                                        <button
                                            className="nb-remove-btn"
                                            onClick={() => onChange({ ...config, filters: config.filters.filter((_, j) => j !== i) })}
                                        >✕</button>
                                    </div>
                                )
                            })}
                            <button
                                className="nb-add-inline"
                                onClick={() => onChange({ ...config, filters: [...config.filters, { column: '', operator: 'is', value: '' }] })}
                            >+ Add condition</button>
                        </StepCard>
                    ) : (
                        <button className="nb-add-step" onClick={() => {
                            onChange({ ...config, filters: [{ column: '', operator: 'is', value: '' }] })
                            setExpandedSteps(s => new Set([...s, 'filter']))
                        }}>
                            <span className="nb-add-step-icon">🔍</span> Filter
                        </button>
                    )}

                    {/* ── Summarize Step ── */}
                    <StepCard
                        icon="Σ"
                        title="Summarize"
                        expanded={expandedSteps.has('summarize')}
                        onToggle={() => toggleStep('summarize')}
                        removable={false}
                    >
                        <div className="nb-summarize">
                            <div className="nb-section-label">Metrics</div>
                            {config.summarize.metrics.map((m, i) => (
                                <div key={i} className="nb-metric-row">
                                    <select
                                        className="nb-select nb-select-agg"
                                        value={m.aggregation}
                                        onChange={e => {
                                            const next = [...config.summarize.metrics]
                                            next[i] = { ...m, aggregation: e.target.value as Metric['aggregation'] }
                                            onChange({ ...config, summarize: { ...config.summarize, metrics: next } })
                                        }}
                                    >
                                        <option value="count">Count</option>
                                        <option value="sum">Sum of</option>
                                        <option value="avg">Average of</option>
                                        <option value="min">Min of</option>
                                        <option value="max">Max of</option>
                                    </select>

                                    {m.aggregation !== 'count' && (
                                        <select
                                            className="nb-select"
                                            value={m.column || ''}
                                            onChange={e => {
                                                const next = [...config.summarize.metrics]
                                                next[i] = { ...m, column: e.target.value }
                                                onChange({ ...config, summarize: { ...config.summarize, metrics: next } })
                                            }}
                                        >
                                            <option value="">column…</option>
                                            {numericCols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    )}

                                    {config.summarize.metrics.length > 1 && (
                                        <button
                                            className="nb-remove-btn"
                                            onClick={() => {
                                                const next = config.summarize.metrics.filter((_, j) => j !== i)
                                                onChange({ ...config, summarize: { ...config.summarize, metrics: next } })
                                            }}
                                        >✕</button>
                                    )}
                                </div>
                            ))}
                            <button
                                className="nb-add-inline"
                                onClick={() => onChange({
                                    ...config,
                                    summarize: {
                                        ...config.summarize,
                                        metrics: [...config.summarize.metrics, { aggregation: 'count' }],
                                    },
                                })}
                            >+ Add metric</button>

                            <div className="nb-section-label" style={{ marginTop: 8 }}>Group by</div>
                            <div className="nb-groupby-chips">
                                {columns.map(col => {
                                    const active = config.summarize.groupBy.includes(col.id)
                                    return (
                                        <button
                                            key={col.id}
                                            className={`nb-chip ${active ? 'active' : ''}`}
                                            onClick={() => {
                                                const groupBy = active
                                                    ? config.summarize.groupBy.filter(g => g !== col.id)
                                                    : [...config.summarize.groupBy, col.id]
                                                onChange({ ...config, summarize: { ...config.summarize, groupBy } })
                                            }}
                                        >
                                            {col.name}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </StepCard>

                    {/* ── Sort Step ── */}
                    {hasSort ? (
                        <StepCard
                            icon="↕"
                            title="Sort"
                            expanded={expandedSteps.has('sort')}
                            onToggle={() => toggleStep('sort')}
                            onRemove={() => onChange({ ...config, sort: [] })}
                        >
                            {config.sort.map((s, i) => (
                                <div key={i} className="nb-sort-row">
                                    <select
                                        className="nb-select"
                                        value={s.column}
                                        onChange={e => {
                                            const next = [...config.sort]
                                            next[i] = { ...s, column: e.target.value }
                                            onChange({ ...config, sort: next })
                                        }}
                                    >
                                        <option value="">column…</option>
                                        {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <button
                                        className={`nb-dir-btn ${s.direction === 'asc' ? 'active' : ''}`}
                                        onClick={() => {
                                            const next = [...config.sort]
                                            next[i] = { ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }
                                            onChange({ ...config, sort: next })
                                        }}
                                    >
                                        {s.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
                                    </button>
                                    <button className="nb-remove-btn" onClick={() => onChange({ ...config, sort: config.sort.filter((_, j) => j !== i) })}>✕</button>
                                </div>
                            ))}
                        </StepCard>
                    ) : (
                        <button className="nb-add-step" onClick={() => {
                            onChange({ ...config, sort: [{ column: '', direction: 'asc' }] })
                            setExpandedSteps(s => new Set([...s, 'sort']))
                        }}>
                            <span className="nb-add-step-icon">↕</span> Sort
                        </button>
                    )}

                    {/* ── Limit Step ── */}
                    {hasLimit ? (
                        <StepCard
                            icon="#"
                            title={`Limit: ${config.limit}`}
                            expanded={expandedSteps.has('limit')}
                            onToggle={() => toggleStep('limit')}
                            onRemove={() => onChange({ ...config, limit: undefined })}
                        >
                            <div className="nb-limit-row">
                                <span className="nb-connector">Show first</span>
                                <input
                                    className="nb-input nb-input-num"
                                    type="number"
                                    min={1}
                                    value={config.limit || ''}
                                    onChange={e => onChange({ ...config, limit: parseInt(e.target.value) || undefined })}
                                />
                                <span className="nb-connector">rows</span>
                            </div>
                        </StepCard>
                    ) : (
                        <button className="nb-add-step" onClick={() => {
                            onChange({ ...config, limit: 10 })
                            setExpandedSteps(s => new Set([...s, 'limit']))
                        }}>
                            <span className="nb-add-step-icon">#</span> Limit
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

// ── Step Card ──────────────────────────────────────────────

function StepCard({ icon, title, expanded, onToggle, onRemove, removable = true, children }: {
    icon: string
    title: string
    expanded: boolean
    onToggle: () => void
    onRemove?: () => void
    removable?: boolean
    children: React.ReactNode
}) {
    return (
        <div className="nb-step">
            <div className="nb-step-header" onClick={onToggle}>
                <span className="nb-step-icon">{icon}</span>
                <span className="nb-step-title">{title}</span>
                <span className="nb-step-chevron">{expanded ? '▾' : '▸'}</span>
                {removable && onRemove && (
                    <button className="nb-step-remove" onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
                )}
            </div>
            {expanded && <div className="nb-step-body">{children}</div>}
        </div>
    )
}
