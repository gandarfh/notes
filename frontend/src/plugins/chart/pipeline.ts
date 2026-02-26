import { api } from '../../bridge/wails'
import type { ColumnDef } from '../../bridge/wails'

// ── Types ──────────────────────────────────────────────────

export type Row = Record<string, unknown>

export type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max'

export type FilterOp =
    | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
    | 'contains' | 'not_contains'
    | 'is_empty' | 'is_not_empty'

export interface FilterCondition {
    column: string
    op: FilterOp
    value: string
}

export interface MetricDef {
    column: string   // ignored for count
    agg: Aggregation
    as?: string      // output column name
}

// ── Stages ─────────────────────────────────────────────────

export interface SourceStage {
    type: 'source'
    databaseId: string
}

export interface JoinStage {
    type: 'join'
    databaseId: string     // right-side source
    leftKey: string
    rightKey: string
    joinType: 'inner' | 'left'
}

export interface FilterStage {
    type: 'filter'
    conditions: FilterCondition[]
    logic: 'and' | 'or'
}

export interface ComputeStage {
    type: 'compute'
    columns: { name: string; expression: string }[]
}

export interface GroupStage {
    type: 'group'
    groupBy: string[]
    metrics: MetricDef[]
}

export interface SortStage {
    type: 'sort'
    column: string
    direction: 'asc' | 'desc'
}

export interface LimitStage {
    type: 'limit'
    count: number
}

export interface PercentStage {
    type: 'percent'
    column: string       // source numeric column
    as?: string          // output column name (default: "{column}_%")
}

export interface DatePartStage {
    type: 'date_part'
    field: string
    part: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'weekday' | 'week'
    targetField: string
}

export interface StringStage {
    type: 'string'
    field: string
    op: 'upper' | 'lower' | 'trim' | 'replace' | 'concat' | 'split' | 'substring'
    search?: string
    replaceWith?: string
    parts?: string[]
    targetField?: string
    separator?: string
    index?: number
    start?: number
    end?: number
}

export interface MathStage {
    type: 'math'
    field: string
    op: 'round' | 'ceil' | 'floor' | 'abs'
}

export interface DefaultValueStage {
    type: 'default_value'
    field: string
    defaultValue: string
}

export interface TypeCastStage {
    type: 'type_cast'
    field: string
    castType: 'number' | 'string' | 'bool' | 'date' | 'datetime'
}

export interface PivotStage {
    type: 'pivot'
    rowKeys: string[]     // columns that stay as rows (e.g. ['year', 'month'])
    pivotColumn: string   // column whose values become new columns (e.g. 'LANGUAGE')
    valueColumns: string[] // columns whose values fill the cells (e.g. ['count', 'avg'])
    showTotal?: boolean   // add a Grand Total row at the bottom
}

export type Stage =
    | SourceStage
    | JoinStage
    | FilterStage
    | ComputeStage
    | GroupStage
    | SortStage
    | LimitStage
    | PercentStage
    | DatePartStage
    | StringStage
    | MathStage
    | DefaultValueStage
    | TypeCastStage
    | PivotStage

// ── Viz Config ─────────────────────────────────────────────

export interface VizConfig {
    xAxis: string
    series: string[]     // column names to plot as Y values
}

export interface PipelineConfig {
    stages: Stage[]
    viz: VizConfig
}

export function defaultPipelineConfig(): PipelineConfig {
    return {
        stages: [{ type: 'source', databaseId: '' }],
        viz: { xAxis: '', series: [] },
    }
}

// ── Pipeline Executor ──────────────────────────────────────

export async function executePipeline(config: PipelineConfig): Promise<Row[]> {
    let rows: Row[] = []

    for (const stage of config.stages) {
        switch (stage.type) {
            case 'source':
                rows = await fetchSource(stage.databaseId)
                break
            case 'join':
                rows = await executeJoin(rows, stage)
                break
            case 'filter':
                rows = executeFilter(rows, stage)
                break
            case 'compute':
                rows = executeCompute(rows, stage)
                break
            case 'group':
                rows = executeGroup(rows, stage)
                break
            case 'sort':
                rows = executeSort(rows, stage)
                break
            case 'limit':
                rows = rows.slice(0, stage.count)
                break
            case 'percent':
                rows = executePercent(rows, stage)
                break
            case 'date_part':
                rows = executeDatePart(rows, stage)
                break
            case 'string':
                rows = executeString(rows, stage)
                break
            case 'math':
                rows = executeMath(rows, stage)
                break
            case 'default_value':
                rows = executeDefaultValue(rows, stage)
                break
            case 'type_cast':
                rows = executeTypeCast(rows, stage)
                break
            case 'pivot':
                rows = executePivot(rows, stage)
                break
        }
    }

    return rows
}

// ── Stage Implementations ──────────────────────────────────

async function fetchSource(databaseId: string): Promise<Row[]> {
    if (!databaseId) return []
    const rawRows = await api.listLocalDBRows(databaseId)
    return rawRows.map(r => {
        try { return JSON.parse(r.dataJson || '{}') as Row }
        catch { return {} as Row }
    })
}

async function executeJoin(left: Row[], stage: JoinStage): Promise<Row[]> {
    const right = await fetchSource(stage.databaseId)
    if (right.length === 0) return left

    // Build lookup from right side
    const rightIndex = new Map<string, Row[]>()
    for (const r of right) {
        const key = String(r[stage.rightKey] ?? '')
        if (!rightIndex.has(key)) rightIndex.set(key, [])
        rightIndex.get(key)!.push(r)
    }

    const result: Row[] = []
    for (const l of left) {
        const key = String(l[stage.leftKey] ?? '')
        const matches = rightIndex.get(key)

        if (matches && matches.length > 0) {
            for (const r of matches) {
                // Merge: left fields take priority, right fields prefixed if conflict
                const merged: Row = { ...l }
                for (const [k, v] of Object.entries(r)) {
                    if (k in merged) {
                        merged[`${k}_right`] = v
                    } else {
                        merged[k] = v
                    }
                }
                result.push(merged)
            }
        } else if (stage.joinType === 'left') {
            result.push({ ...l })
        }
    }

    return result
}

function executeFilter(rows: Row[], stage: FilterStage): Row[] {
    if (stage.conditions.length === 0) return rows

    return rows.filter(row => {
        const results = stage.conditions.map(c => matchCondition(row, c))
        return stage.logic === 'or'
            ? results.some(Boolean)
            : results.every(Boolean)
    })
}

function matchCondition(row: Row, c: FilterCondition): boolean {
    const raw = row[c.column]
    const s = String(raw ?? '')
    const v = c.value

    switch (c.op) {
        case 'eq': return s === v
        case 'neq': return s !== v
        case 'gt': return Number(s) > Number(v)
        case 'lt': return Number(s) < Number(v)
        case 'gte': return Number(s) >= Number(v)
        case 'lte': return Number(s) <= Number(v)
        case 'contains': return s.toLowerCase().includes(v.toLowerCase())
        case 'not_contains': return !s.toLowerCase().includes(v.toLowerCase())
        case 'is_empty': return s === '' || raw === null || raw === undefined
        case 'is_not_empty': return s !== '' && raw !== null && raw !== undefined
        default: return true
    }
}

function executeCompute(rows: Row[], stage: ComputeStage): Row[] {
    return rows.map(row => {
        const next = { ...row }
        for (const col of stage.columns) {
            try {
                next[col.name] = evaluateExpression(row, col.expression)
            } catch {
                next[col.name] = null
            }
        }
        return next
    })
}

function evaluateExpression(row: Row, expr: string): unknown {
    // Simple expression evaluator:
    // - Column references: {column_name}
    // - Basic math: +, -, *, /
    // - String concat: {a} + " " + {b}

    // Replace {column} with values
    const resolved = expr.replace(/\{([^}]+)\}/g, (_match, colName: string) => {
        const val = row[colName]
        if (val === null || val === undefined) return '0'
        if (typeof val === 'number') return String(val)
        return JSON.stringify(String(val))
    })

    try {
        // Safe eval using Function constructor (no access to globals)
        const fn = new Function('return ' + resolved)
        return fn()
    } catch {
        return resolved
    }
}

function executeGroup(rows: Row[], stage: GroupStage): Row[] {
    if (stage.groupBy.length === 0 && stage.metrics.length === 0) return rows

    const groups = new Map<string, Row[]>()

    for (const row of rows) {
        const key = stage.groupBy.map(k => String(row[k] ?? 'Other')).join(' × ')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
    }

    const result: Row[] = []
    groups.forEach((groupRows, key) => {
        const out: Row = {}

        // Add group-by values from first row
        for (const k of stage.groupBy) {
            out[k] = groupRows[0][k]
        }

        // Compute metrics
        for (const m of stage.metrics) {
            const outputName = m.as || `${m.agg}(${m.column || '*'})`

            if (m.agg === 'count') {
                out[outputName] = groupRows.length
            } else {
                const vals = groupRows.map(r => Number(r[m.column]) || 0)
                out[outputName] = aggregate(vals, m.agg)
            }
        }

        result.push(out)
    })

    return result
}

function aggregate(values: number[], agg: Aggregation): number {
    if (values.length === 0) return 0
    switch (agg) {
        case 'count': return values.length
        case 'sum': return values.reduce((a, b) => a + b, 0)
        case 'avg': return values.reduce((a, b) => a + b, 0) / values.length
        case 'min': return Math.min(...values)
        case 'max': return Math.max(...values)
        default: return 0
    }
}

function executeSort(rows: Row[], stage: SortStage): Row[] {
    const sorted = [...rows]
    const dir = stage.direction === 'asc' ? 1 : -1

    sorted.sort((a, b) => {
        const va = a[stage.column]
        const vb = b[stage.column]
        if (va === vb) return 0
        if (va === null || va === undefined) return 1
        if (vb === null || vb === undefined) return -1
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
        return String(va).localeCompare(String(vb)) * dir
    })

    return sorted
}

function executePercent(rows: Row[], stage: PercentStage): Row[] {
    if (rows.length === 0 || !stage.column) return rows

    // Pass 1: compute total
    let total = 0
    for (const row of rows) {
        total += Number(row[stage.column]) || 0
    }

    if (total === 0) return rows

    // Pass 2: add percentage column
    const outputName = stage.as || `${stage.column}_%`
    return rows.map(row => {
        const val = Number(row[stage.column]) || 0
        return { ...row, [outputName]: Math.round((val / total) * 1000) / 10 }
    })
}

function executeDatePart(rows: Row[], stage: DatePartStage): Row[] {
    if (!stage.field || !stage.part) return rows
    const out = stage.targetField || `${stage.field}_${stage.part}`
    return rows.map(row => {
        const next = { ...row }
        const raw = row[stage.field]
        const num = Number(raw)
        let dt: Date | null = null
        if (!isNaN(num) && num > 1e9) {
            dt = new Date(num > 1e12 ? num : num * 1000)
        } else {
            const ts = Date.parse(String(raw ?? ''))
            if (!isNaN(ts)) dt = new Date(ts)
        }
        if (dt) {
            switch (stage.part) {
                case 'year': next[out] = dt.getUTCFullYear(); break
                case 'month': next[out] = dt.getUTCMonth() + 1; break
                case 'day': next[out] = dt.getUTCDate(); break
                case 'hour': next[out] = dt.getUTCHours(); break
                case 'minute': next[out] = dt.getUTCMinutes(); break
                case 'weekday': next[out] = dt.getUTCDay(); break
                case 'week': {
                    const oneJan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
                    next[out] = Math.ceil(((dt.getTime() - oneJan.getTime()) / 86400000 + oneJan.getUTCDay() + 1) / 7)
                    break
                }
            }
        }
        return next
    })
}

function executeString(rows: Row[], stage: StringStage): Row[] {
    const { field, op } = stage
    if (!field && op !== 'concat') return rows
    return rows.map(row => {
        const next = { ...row }
        switch (op) {
            case 'upper': if (field in next) next[field] = String(next[field] ?? '').toUpperCase(); break
            case 'lower': if (field in next) next[field] = String(next[field] ?? '').toLowerCase(); break
            case 'trim': if (field in next) next[field] = String(next[field] ?? '').trim(); break
            case 'replace': {
                if (field in next && stage.search) {
                    next[field] = String(next[field] ?? '').replaceAll(stage.search, stage.replaceWith || '')
                }
                break
            }
            case 'concat': {
                const parts = stage.parts || []
                const target = stage.targetField || field
                next[target] = parts.map(p => {
                    if (p.startsWith('{') && p.endsWith('}')) return String(next[p.slice(1, -1)] ?? '')
                    return p
                }).join('')
                break
            }
            case 'split': {
                const sep = stage.separator || ','
                const idx = stage.index || 0
                const target = stage.targetField || field
                if (field in next) {
                    const parts = String(next[field] ?? '').split(sep)
                    next[target] = idx >= 0 && idx < parts.length ? parts[idx] : ''
                }
                break
            }
            case 'substring': {
                const start = stage.start || 0
                const end = stage.end || 0
                if (field in next) {
                    const s = String(next[field] ?? '')
                    next[field] = end > 0 ? s.slice(start, end) : s.slice(start)
                }
                break
            }
        }
        return next
    })
}

function executeMath(rows: Row[], stage: MathStage): Row[] {
    if (!stage.field || !stage.op) return rows
    return rows.map(row => {
        const next = { ...row }
        if (stage.field in next) {
            const n = Number(next[stage.field])
            if (!isNaN(n)) {
                switch (stage.op) {
                    case 'round': next[stage.field] = Math.round(n); break
                    case 'ceil': next[stage.field] = Math.ceil(n); break
                    case 'floor': next[stage.field] = Math.floor(n); break
                    case 'abs': next[stage.field] = Math.abs(n); break
                }
            }
        }
        return next
    })
}

function executeDefaultValue(rows: Row[], stage: DefaultValueStage): Row[] {
    if (!stage.field) return rows
    return rows.map(row => {
        const next = { ...row }
        if (!(stage.field in next) || next[stage.field] == null || String(next[stage.field]) === '') {
            next[stage.field] = stage.defaultValue ?? ''
        }
        return next
    })
}

function executeTypeCast(rows: Row[], stage: TypeCastStage): Row[] {
    if (!stage.field || !stage.castType) return rows
    return rows.map(row => {
        const next = { ...row }
        if (stage.field in next) {
            switch (stage.castType) {
                case 'number': next[stage.field] = Number(next[stage.field]) || 0; break
                case 'string': next[stage.field] = String(next[stage.field] ?? ''); break
                case 'bool': next[stage.field] = Boolean(next[stage.field]); break
                case 'date': {
                    const raw = next[stage.field]
                    const num = Number(raw)
                    let dt: Date | null = null
                    if (!isNaN(num) && num > 1e9) dt = new Date(num > 1e12 ? num : num * 1000)
                    else { const ts = Date.parse(String(raw ?? '')); if (!isNaN(ts)) dt = new Date(ts) }
                    if (dt) next[stage.field] = dt.toISOString().slice(0, 10)
                    break
                }
                case 'datetime': {
                    const raw = next[stage.field]
                    const num = Number(raw)
                    let dt: Date | null = null
                    if (!isNaN(num) && num > 1e9) dt = new Date(num > 1e12 ? num : num * 1000)
                    else { const ts = Date.parse(String(raw ?? '')); if (!isNaN(ts)) dt = new Date(ts) }
                    if (dt) next[stage.field] = dt.toISOString()
                    break
                }
            }
        }
        return next
    })
}

function executePivot(rows: Row[], stage: PivotStage): Row[] {
    // Backwards compat: migrate old formats
    const rowKeys = stage.rowKeys || ((stage as any).rowKey ? [(stage as any).rowKey] : [])
    const valCols = stage.valueColumns || ((stage as any).valueColumn ? [(stage as any).valueColumn] : [])
    if (rowKeys.length === 0 || !stage.pivotColumn || valCols.length === 0) return rows

    const multi = valCols.length > 1

    // 1. Discover all unique pivot values
    const pivotValues: string[] = []
    const seen = new Set<string>()
    for (const row of rows) {
        const pv = String(row[stage.pivotColumn] ?? '')
        if (!seen.has(pv)) { seen.add(pv); pivotValues.push(pv) }
    }

    // 2. Build output column names: multi values → "go_count", single → "go"
    const outCols: string[] = []
    for (const pv of pivotValues) {
        for (const vc of valCols) {
            outCols.push(multi ? `${pv}_${vc}` : pv)
        }
    }

    // 3. Group rows by composite row key
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
        const key = rowKeys.map(k => String(row[k] ?? '')).join('\x00')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
    }

    // 4. Build pivoted rows
    const result: Row[] = []
    groups.forEach((groupRows) => {
        const out: Row = {}
        for (const k of rowKeys) out[k] = groupRows[0][k]
        for (const c of outCols) out[c] = 0

        for (const row of groupRows) {
            const pv = String(row[stage.pivotColumn] ?? '')
            for (const vc of valCols) {
                const colName = multi ? `${pv}_${vc}` : pv
                const val = row[vc]
                out[colName] = typeof val === 'number' ? val : Number(val) || 0
            }
        }
        result.push(out)
    })

    // 5. Grand Total row
    if (stage.showTotal && result.length > 0) {
        const totalRow: Row = {}
        for (const k of rowKeys) totalRow[k] = k === rowKeys[0] ? 'Total' : ''
        for (const c of outCols) {
            let sum = 0
            for (const row of result) sum += Number(row[c]) || 0
            totalRow[c] = sum
        }
        result.push(totalRow)
    }

    return result
}

// ── Helpers ────────────────────────────────────────────────

/** Get available columns after executing stages up to a given index */
export function getColumnsAtStage(
    stages: Stage[],
    stageIndex: number,
    dbColumns: Record<string, ColumnDef[]>,
): string[] {
    const cols = new Set<string>()

    for (let i = 0; i <= stageIndex && i < stages.length; i++) {
        const s = stages[i]
        switch (s.type) {
            case 'source': {
                const dbCols = dbColumns[s.databaseId] || []
                dbCols.forEach(c => cols.add(c.id))
                break
            }
            case 'join': {
                const dbCols = dbColumns[s.databaseId] || []
                dbCols.forEach(c => cols.add(c.id))
                break
            }
            case 'compute': {
                s.columns.forEach(c => cols.add(c.name))
                break
            }
            case 'group': {
                cols.clear()
                s.groupBy.forEach(g => cols.add(g))
                s.metrics.forEach(m => cols.add(m.as || `${m.agg}(${m.column || '*'})`))
                break
            }
            case 'percent': {
                cols.add(s.as || `${s.column}_%`)
                break
            }
            case 'date_part': {
                cols.add(s.targetField || `${s.field}_${s.part}`)
                break
            }
            case 'string': {
                if ((s.op === 'concat' || s.op === 'split') && s.targetField) {
                    cols.add(s.targetField)
                }
                break
            }
            // pivot: dynamic columns — can't track statically, but rowKey stays
        }
    }

    return Array.from(cols)
}

/** Stage display labels */
export const STAGE_LABELS: Record<Stage['type'], string> = {
    source: 'Source',
    join: 'Join',
    filter: 'Filter',
    compute: 'Compute',
    group: 'Group',
    sort: 'Sort',
    limit: 'Limit',
    percent: 'Percent',
    date_part: 'Date Part',
    string: 'String',
    math: 'Math',
    default_value: 'Default Value',
    type_cast: 'Type Cast',
    pivot: 'Pivot',
}

export const FILTER_OPS: { value: FilterOp; label: string }[] = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'not contains' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
]

export const AGG_OPTIONS: { value: Aggregation; label: string }[] = [
    { value: 'count', label: 'Count' },
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Average' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
]
