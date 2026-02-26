import { useState, useEffect, useMemo } from 'react'
import { api } from '../../bridge/wails'
import { ETLPipeline, type TransformStage, getColumnsAtStage } from './ETLPipeline'

// ── Types ──────────────────────────────────────────────────

interface SampleRecord {
    data: Record<string, any>
}

interface ETLTransformStepProps {
    sourceType: string
    sourceConfig: Record<string, any>
    transforms: TransformStage[]
    onChange: (transforms: TransformStage[]) => void
}

// ── Client-side Transform Preview ──────────────────────────

function applyTransformsPreview(records: SampleRecord[], transforms: TransformStage[]): SampleRecord[] {
    let result = records.map(r => ({ data: { ...r.data } }))

    for (const t of transforms) {
        switch (t.type) {
            case 'filter': {
                const { field, op, value } = t.config
                if (!field || !op) break
                result = result.filter(r => {
                    const v = r.data[field]
                    const sv = String(v ?? '')
                    const tv = String(value ?? '')
                    switch (op) {
                        case 'eq': return sv === tv
                        case 'neq': return sv !== tv
                        case 'gt': return Number(v) > Number(value)
                        case 'lt': return Number(v) < Number(value)
                        case 'contains': return sv.includes(tv)
                        case 'not_contains': return !sv.includes(tv)
                        case 'is_empty': return sv === '' || v == null
                        case 'is_not_empty': return sv !== '' && v != null
                        default: return true
                    }
                })
                break
            }
            case 'select': {
                const fields = (t.config.fields || []) as string[]
                if (fields.length === 0) break
                result = result.map(r => ({
                    data: Object.fromEntries(fields.filter(f => f in r.data).map(f => [f, r.data[f]]))
                }))
                break
            }
            case 'rename': {
                const mapping = (t.config.mapping || {}) as Record<string, string>
                result = result.map(r => {
                    const d = { ...r.data }
                    for (const [old, nw] of Object.entries(mapping)) {
                        if (nw && old in d) { d[nw] = d[old]; delete d[old] }
                    }
                    return { data: d }
                })
                break
            }
            case 'compute': {
                const cols = (t.config.columns || []) as { name: string; expression: string }[]
                result = result.map(r => {
                    const d = { ...r.data }
                    for (const c of cols) {
                        if (!c.name || !c.expression) continue
                        let expr = c.expression
                        for (const [k, v] of Object.entries(d)) {
                            expr = expr.replaceAll(`{${k}}`, String(v ?? ''))
                        }
                        const num = Number(expr)
                        d[c.name] = isNaN(num) ? expr : num
                    }
                    return { data: d }
                })
                break
            }
            case 'dedupe': {
                const key = t.config.key as string
                if (!key) break
                const seen = new Set<string>()
                result = result.filter(r => {
                    const v = String(r.data[key] ?? '')
                    if (seen.has(v)) return false
                    seen.add(v)
                    return true
                })
                break
            }
            case 'sort': {
                const { field, direction } = t.config
                if (!field) break
                const dir = direction === 'desc' ? -1 : 1
                result.sort((a, b) => {
                    const va = a.data[field], vb = b.data[field]
                    if (va == null && vb == null) return 0
                    if (va == null) return dir
                    if (vb == null) return -dir
                    const na = Number(va), nb = Number(vb)
                    if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir
                    return String(va).localeCompare(String(vb)) * dir
                })
                break
            }
            case 'limit': {
                const count = Number(t.config.count) || 100
                result = result.slice(0, count)
                break
            }
            case 'type_cast': {
                const { field, castType } = t.config
                if (!field) break
                result = result.map(r => {
                    const d = { ...r.data }
                    if (field in d) {
                        switch (castType) {
                            case 'number': d[field] = Number(d[field]) || 0; break
                            case 'string': d[field] = String(d[field] ?? ''); break
                            case 'bool': d[field] = Boolean(d[field]); break
                            case 'date': {
                                const raw = d[field]
                                const num = Number(raw)
                                let dt: Date | null = null
                                if (!isNaN(num) && num > 1e9) {
                                    dt = new Date(num > 1e12 ? num : num * 1000) // ms vs s
                                } else {
                                    const ts = Date.parse(String(raw ?? ''))
                                    if (!isNaN(ts)) dt = new Date(ts)
                                }
                                if (dt) d[field] = dt.toISOString().slice(0, 10)
                                break
                            }
                            case 'datetime': {
                                const raw = d[field]
                                const num = Number(raw)
                                let dt: Date | null = null
                                if (!isNaN(num) && num > 1e9) {
                                    dt = new Date(num > 1e12 ? num : num * 1000)
                                } else {
                                    const ts = Date.parse(String(raw ?? ''))
                                    if (!isNaN(ts)) dt = new Date(ts)
                                }
                                if (dt) d[field] = dt.toISOString()
                                break
                            }
                        }
                    }
                    return { data: d }
                })
                break
            }
            case 'flatten': {
                const sourceField = t.config.sourceField as string
                const fields = (t.config.fields || []) as { path: string; alias: string }[]
                if (!sourceField || fields.length === 0) break
                result = result.map(r => {
                    const d = { ...r.data }
                    let m: Record<string, any> | null = null
                    const raw = d[sourceField]
                    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                        m = raw as Record<string, any>
                    } else if (typeof raw === 'string') {
                        try { m = JSON.parse(raw) } catch { }
                    }
                    if (m) {
                        for (const f of fields) {
                            if (!f.path) continue
                            const outName = f.alias || f.path
                            d[outName] = extractJsonPath(m, f.path)
                        }
                    }
                    return { data: d }
                })
                break
            }
            case 'string': {
                const { field, op } = t.config
                if (!field && op !== 'concat') break
                result = result.map(r => {
                    const d = { ...r.data }
                    switch (op) {
                        case 'upper': if (field in d) d[field] = String(d[field] ?? '').toUpperCase(); break
                        case 'lower': if (field in d) d[field] = String(d[field] ?? '').toLowerCase(); break
                        case 'trim': if (field in d) d[field] = String(d[field] ?? '').trim(); break
                        case 'replace': {
                            const search = t.config.search as string || ''
                            const replaceWith = t.config.replaceWith as string || ''
                            if (field in d && search) {
                                d[field] = String(d[field] ?? '').replaceAll(search, replaceWith)
                            }
                            break
                        }
                        case 'concat': {
                            const parts = (t.config.parts || []) as string[]
                            const target = (t.config.targetField as string) || field
                            d[target] = parts.map(p => {
                                if (p.startsWith('{') && p.endsWith('}')) {
                                    const ref = p.slice(1, -1)
                                    return String(d[ref] ?? '')
                                }
                                return p
                            }).join('')
                            break
                        }
                        case 'split': {
                            const sep = (t.config.separator as string) || ','
                            const idx = Number(t.config.index) || 0
                            const target = (t.config.targetField as string) || field
                            if (field in d) {
                                const parts = String(d[field] ?? '').split(sep)
                                d[target] = idx >= 0 && idx < parts.length ? parts[idx] : ''
                            }
                            break
                        }
                        case 'substring': {
                            const start = Number(t.config.start) || 0
                            const end = Number(t.config.end) || 0
                            if (field in d) {
                                const s = String(d[field] ?? '')
                                d[field] = end > 0 ? s.slice(start, end) : s.slice(start)
                            }
                            break
                        }
                    }
                    return { data: d }
                })
                break
            }
            case 'date_part': {
                const { field, part, targetField } = t.config
                if (!field || !part) break
                result = result.map(r => {
                    const d = { ...r.data }
                    const out = (targetField as string) || `${field}_${part}`
                    const raw = d[field]
                    const num = Number(raw)
                    let dt: Date | null = null
                    if (!isNaN(num) && num > 1e9) {
                        dt = new Date(num > 1e12 ? num : num * 1000)
                    } else {
                        const ts = Date.parse(String(raw ?? ''))
                        if (!isNaN(ts)) dt = new Date(ts)
                    }
                    if (dt) {
                        switch (part) {
                            case 'year': d[out] = dt.getUTCFullYear(); break
                            case 'month': d[out] = dt.getUTCMonth() + 1; break
                            case 'day': d[out] = dt.getUTCDate(); break
                            case 'hour': d[out] = dt.getUTCHours(); break
                            case 'minute': d[out] = dt.getUTCMinutes(); break
                            case 'weekday': d[out] = dt.getUTCDay(); break
                            case 'week': {
                                const oneJan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
                                d[out] = Math.ceil(((dt.getTime() - oneJan.getTime()) / 86400000 + oneJan.getUTCDay() + 1) / 7)
                                break
                            }
                        }
                    }
                    return { data: d }
                })
                break
            }
            case 'default_value': {
                const { field, defaultValue } = t.config
                if (!field) break
                result = result.map(r => {
                    const d = { ...r.data }
                    if (!(field in d) || d[field] == null || String(d[field]) === '') {
                        d[field] = defaultValue ?? ''
                    }
                    return { data: d }
                })
                break
            }
            case 'math': {
                const { field, op } = t.config
                if (!field || !op) break
                result = result.map(r => {
                    const d = { ...r.data }
                    if (field in d) {
                        const n = Number(d[field])
                        if (!isNaN(n)) {
                            switch (op) {
                                case 'round': d[field] = Math.round(n); break
                                case 'ceil': d[field] = Math.ceil(n); break
                                case 'floor': d[field] = Math.floor(n); break
                                case 'abs': d[field] = Math.abs(n); break
                            }
                        }
                    }
                    return { data: d }
                })
                break
            }
        }
    }

    return result
}

function extractJsonPath(obj: Record<string, any>, path: string): any {
    const parts = path.split('.')
    let current: any = obj
    for (const p of parts) {
        if (current == null || typeof current !== 'object') return null
        current = current[p]
    }
    return current
}

// ── Component ──────────────────────────────────────────────

export function ETLTransformStep({ sourceType, sourceConfig, transforms, onChange }: ETLTransformStepProps) {
    const [sampleRecords, setSampleRecords] = useState<SampleRecord[]>([])
    const [sourceColumns, setSourceColumns] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState('')

    // Fetch sample data from source
    useEffect(() => {
        if (!sourceType) return
        const cfg = sourceConfig || {}
        // Don't attempt preview if database source has no blockId selected
        if (sourceType === 'database' && !cfg.blockId) return
        const cfgJSON = JSON.stringify(cfg)
        if (cfgJSON === '{}') return

        setLoading(true)
        setLoadError('')
        api.previewETLSource(sourceType, cfgJSON)
            .then((result: any) => {
                if (result?.records) {
                    setSampleRecords(result.records)
                    if (result.schema?.fields) {
                        setSourceColumns(result.schema.fields.map((f: any) => f.name))
                    } else if (result.records.length > 0) {
                        setSourceColumns(Object.keys(result.records[0].data || {}))
                    }
                }
            })
            .catch(err => {
                const msg = typeof err === 'string' ? err : (err?.message || 'Failed to load sample data')
                setLoadError(msg)
            })
            .finally(() => setLoading(false))
    }, [sourceType, JSON.stringify(sourceConfig)])

    // Apply transforms to sample data (client-side preview)
    const outputRecords = useMemo(
        () => applyTransformsPreview(sampleRecords, transforms),
        [sampleRecords, transforms]
    )

    // Output columns
    const outputColumns = useMemo(
        () => transforms.length > 0
            ? getColumnsAtStage(sourceColumns, transforms, transforms.length - 1)
            : sourceColumns,
        [sourceColumns, transforms]
    )

    return (
        <div className="etl-transform-step">
            {/* Input sample */}
            <div className="etl-sample-section">
                <div className="etl-sample-header">
                    <span className="etl-sample-title">Input</span>
                    <span className="etl-sample-badge">{sampleRecords.length} rows sample</span>
                </div>
                {loading ? (
                    <div className="etl-sample-empty">Loading sample data…</div>
                ) : loadError ? (
                    <div className="etl-sample-empty" style={{ color: 'var(--color-danger, #ef4444)' }}>{loadError}</div>
                ) : sampleRecords.length === 0 ? (
                    <div className="etl-sample-empty">No sample data available</div>
                ) : (
                    <SampleTable columns={sourceColumns} records={sampleRecords} />
                )}
            </div>

            {/* Pipeline editor */}
            <ETLPipeline
                stages={transforms}
                sourceType={sourceType}
                sourceConfig={sourceConfig}
                onChange={onChange}
            />

            {/* Output preview */}
            {transforms.length > 0 && (
                <div className="etl-sample-section">
                    <div className="etl-sample-header">
                        <span className="etl-sample-title">Output Preview</span>
                        <span className="etl-sample-badge">
                            {outputRecords.length}/{sampleRecords.length} rows · {outputColumns.length} cols
                        </span>
                    </div>
                    {outputRecords.length === 0 ? (
                        <div className="etl-sample-empty">All rows filtered out</div>
                    ) : (
                        <SampleTable columns={outputColumns} records={outputRecords} highlight />
                    )}
                </div>
            )}
        </div>
    )
}

// ── Sample Table ───────────────────────────────────────────

function SampleTable({ columns, records, highlight }: {
    columns: string[]
    records: SampleRecord[]
    highlight?: boolean
}) {
    if (columns.length === 0 || records.length === 0) return null

    return (
        <div className="etl-sample-scroll">
            <table className={`etl-sample-table ${highlight ? 'etl-sample-table--output' : ''}`}>
                <thead>
                    <tr>
                        {columns.map(col => (
                            <th key={col}>{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {records.map((r, i) => (
                        <tr key={i}>
                            {columns.map(col => (
                                <td key={col}>{formatCell(r.data[col])}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function formatCell(value: any): string {
    if (value == null) return '—'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
    const s = String(value)
    return s.length > 40 ? s.slice(0, 37) + '…' : s
}
