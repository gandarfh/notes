import { useState } from 'react'
import type { DataPoint, SeriesDef } from './ChartRenderer'

// ── Data Editor ────────────────────────────────────────────
// Inline spreadsheet for editing chart data.

const COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a855f7',
]

interface DataEditorProps {
    data: DataPoint[]
    series: SeriesDef[]
    onDataChange: (data: DataPoint[]) => void
    onSeriesChange: (series: SeriesDef[]) => void
}

export function DataEditor({ data, series, onDataChange, onSeriesChange }: DataEditorProps) {
    const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)

    const updateCell = (rowIdx: number, key: string, raw: string) => {
        const next = [...data]
        const num = Number(raw)
        next[rowIdx] = { ...next[rowIdx], [key]: key === 'name' ? raw : (isNaN(num) ? raw : num) }
        onDataChange(next)
    }

    const addRow = () => {
        const newRow: DataPoint = { name: `Item ${data.length + 1}` }
        series.forEach(s => { newRow[s.key] = 0 })
        onDataChange([...data, newRow])
    }

    const removeRow = (idx: number) => {
        onDataChange(data.filter((_, i) => i !== idx))
    }

    const addSeries = () => {
        const idx = series.length
        const key = `series_${idx + 1}`
        const newSeries: SeriesDef = { key, color: COLORS[idx % COLORS.length], name: `Series ${idx + 1}` }
        onSeriesChange([...series, newSeries])
        // Add default values to existing data
        onDataChange(data.map(d => ({ ...d, [key]: 0 })))
    }

    const removeSeries = (key: string) => {
        onSeriesChange(series.filter(s => s.key !== key))
        onDataChange(data.map(d => {
            const next = { ...d }
            delete next[key]
            return next
        }))
    }

    const updateSeriesName = (key: string, name: string) => {
        onSeriesChange(series.map(s => s.key === key ? { ...s, name } : s))
    }

    return (
        <div className="chart-data-editor">
            <div className="chart-data-table-wrap">
                <table className="chart-data-table">
                    <thead>
                        <tr>
                            <th className="chart-data-th-name">Name</th>
                            {series.map(s => (
                                <th key={s.key}>
                                    <div className="chart-data-th-series">
                                        <span
                                            className="chart-data-series-dot"
                                            style={{ background: s.color }}
                                        />
                                        <input
                                            className="chart-data-series-name"
                                            value={s.name}
                                            onChange={e => updateSeriesName(s.key, e.target.value)}
                                        />
                                        {series.length > 1 && (
                                            <button
                                                className="chart-data-remove-series"
                                                onClick={() => removeSeries(s.key)}
                                                title="Remove series"
                                            >✕</button>
                                        )}
                                    </div>
                                </th>
                            ))}
                            <th className="chart-data-th-add">
                                <button className="chart-data-add-series" onClick={addSeries} title="Add series">+</button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, i) => (
                            <tr key={i}>
                                <td>
                                    <input
                                        className="chart-data-cell"
                                        value={String(row.name)}
                                        onChange={e => updateCell(i, 'name', e.target.value)}
                                        onFocus={() => setEditingCell({ row: i, col: 'name' })}
                                        onBlur={() => setEditingCell(null)}
                                    />
                                </td>
                                {series.map(s => (
                                    <td key={s.key}>
                                        <input
                                            className="chart-data-cell chart-data-cell-num"
                                            type="number"
                                            value={String(row[s.key] ?? 0)}
                                            onChange={e => updateCell(i, s.key, e.target.value)}
                                            onFocus={() => setEditingCell({ row: i, col: s.key })}
                                            onBlur={() => setEditingCell(null)}
                                        />
                                    </td>
                                ))}
                                <td className="chart-data-td-actions">
                                    <button
                                        className="chart-data-remove-row"
                                        onClick={() => removeRow(i)}
                                        title="Remove row"
                                    >✕</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <button className="chart-data-add-row" onClick={addRow}>+ Add Row</button>
        </div>
    )
}
