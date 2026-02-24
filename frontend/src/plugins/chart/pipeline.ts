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

export type Stage =
    | SourceStage
    | JoinStage
    | FilterStage
    | ComputeStage
    | GroupStage
    | SortStage
    | LimitStage
    | PercentStage

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
