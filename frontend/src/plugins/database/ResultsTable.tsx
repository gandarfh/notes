import React, { useState, useRef, useEffect } from 'react'
import type { QueryResultView, Mutation } from '../../bridge/wails'
import { IconCheck } from '@tabler/icons-react'

// Pending edit: { rowIdx: { colIdx: newValue } }
type PendingEdits = Map<number, Map<number, string>>

/** Pretty-print cell values — auto-detect JSON and format with indentation */
function formatCellValue(val: unknown): string {
    if (val === null || val === undefined) return 'NULL'
    const s = String(val)
    // Try to detect and pretty-print JSON
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try {
            return JSON.stringify(JSON.parse(s), null, 2)
        } catch { /* not valid JSON, return as-is */ }
    }
    return s
}

interface ResultsTableProps {
    result: QueryResultView
    loading: boolean
    isCached?: boolean
    onFetchMore: () => void
    onApplyMutations?: (mutations: Mutation[]) => Promise<void>
}

export function ResultsTable({ result, loading, isCached, onFetchMore, onApplyMutations }: ResultsTableProps) {
    const [pendingEdits, setPendingEdits] = useState<PendingEdits>(new Map())
    const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set())
    const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
    const [saving, setSaving] = useState(false)
    const [expandedRow, setExpandedRow] = useState<number | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const canEdit = !!result.primaryKeys?.length && !!onApplyMutations && !result.isWrite

    const editCount = pendingEdits.size
    const deleteCount = pendingDeletes.size
    const hasPending = editCount > 0 || deleteCount > 0

    // Focus input when editing starts
    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editingCell])

    // Error state
    if (result.error) {
        return (
            <div className="flex items-start gap-2.5 m-3 p-3.5 rounded-lg bg-error/10 border border-error/20">
                <svg className="w-4 h-4 text-error flex-shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M8 4v5M8 11v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <div>
                    <p className="text-error text-[13px] font-medium mb-0.5">Query Error</p>
                    <p className="text-error/80 text-[12px] leading-relaxed">{result.error}</p>
                </div>
            </div>
        )
    }

    // Write result
    if (result.isWrite) {
        return (
            <div className="flex items-center gap-2.5 m-3 p-3.5 rounded-lg bg-success/10 border border-success/20">
                <svg className="w-5 h-5 text-success flex-shrink-0" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                    <p className="text-success text-[13px] font-medium">
                        {result.affectedRows} row{result.affectedRows !== 1 ? 's' : ''} affected
                    </p>
                    <p className="text-text-muted text-[11px] font-mono mt-0.5">Completed in {result.durationMs}ms</p>
                </div>
            </div>
        )
    }

    // No results
    if (!result.columns?.length) {
        return (
            <div className="py-8 text-center text-text-muted text-[13px]">
                Query returned no results
            </div>
        )
    }

    const rows = result.rows || []

    function getCellValue(rowIdx: number, colIdx: number): string {
        const edited = pendingEdits.get(rowIdx)?.get(colIdx)
        if (edited !== undefined) return edited
        const val = rows[rowIdx]?.[colIdx]
        return val === null ? '' : String(val)
    }

    function isEdited(rowIdx: number, colIdx: number): boolean {
        return pendingEdits.has(rowIdx) && pendingEdits.get(rowIdx)!.has(colIdx)
    }

    function startEdit(rowIdx: number, colIdx: number) {
        if (!canEdit || pendingDeletes.has(rowIdx)) return
        setEditingCell({ row: rowIdx, col: colIdx })
    }

    function commitEdit(value: string) {
        if (!editingCell) return
        const { row, col } = editingCell
        const original = rows[row]?.[col]
        const originalStr = original === null ? '' : String(original)

        if (value !== originalStr) {
            setPendingEdits(prev => {
                const next = new Map(prev)
                if (!next.has(row)) next.set(row, new Map())
                next.get(row)!.set(col, value)
                return next
            })
        } else {
            // Revert if unchanged
            setPendingEdits(prev => {
                const next = new Map(prev)
                if (next.has(row)) {
                    next.get(row)!.delete(col)
                    if (next.get(row)!.size === 0) next.delete(row)
                }
                return next
            })
        }
        setEditingCell(null)
    }

    function toggleDelete(rowIdx: number) {
        setPendingDeletes(prev => {
            const next = new Set(prev)
            if (next.has(rowIdx)) {
                next.delete(rowIdx)
            } else {
                next.add(rowIdx)
                // Also remove any edits for deleted rows
                setPendingEdits(pe => {
                    const ne = new Map(pe)
                    ne.delete(rowIdx)
                    return ne
                })
            }
            return next
        })
    }

    function discardAll() {
        setPendingEdits(new Map())
        setPendingDeletes(new Set())
        setEditingCell(null)
        setExpandedRow(null)
    }

    async function saveAll() {
        if (!onApplyMutations || !result.primaryKeys?.length) return
        setSaving(true)

        const mutations: Mutation[] = []
        const pkCols = result.primaryKeys

        // Build update mutations
        pendingEdits.forEach((colChanges, rowIdx) => {
            if (pendingDeletes.has(rowIdx)) return // skip, will be deleted
            const rowKey: Record<string, any> = {}
            pkCols.forEach(pk => {
                const pkIdx = result.columns.indexOf(pk)
                if (pkIdx !== -1) rowKey[pk] = rows[rowIdx][pkIdx]
            })

            const changes: Record<string, any> = {}
            colChanges.forEach((newVal, colIdx) => {
                changes[result.columns[colIdx]] = newVal
            })

            mutations.push({ type: 'update', rowKey, changes })
        })

        // Build delete mutations
        pendingDeletes.forEach(rowIdx => {
            const rowKey: Record<string, any> = {}
            pkCols.forEach(pk => {
                const pkIdx = result.columns.indexOf(pk)
                if (pkIdx !== -1) rowKey[pk] = rows[rowIdx][pkIdx]
            })
            mutations.push({ type: 'delete', rowKey })
        })

        try {
            await onApplyMutations(mutations)
            discardAll()
        } catch (e) {
            console.error('[DB] ApplyMutations failed:', e)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-[13px] font-mono">
                    <thead className="sticky top-0 z-[2]">
                        <tr>
                            <th className="py-2 px-2.5 text-right text-text-muted/60 font-normal text-[11px] bg-elevated
                                           border-b border-border-default border-r border-r-border-subtle w-11 min-w-[44px]">
                                #
                            </th>
                            {result.columns.map((col, i) => (
                                <th key={i} className="py-2 px-3 text-left font-semibold text-text-primary text-[12px]
                                                        bg-elevated border-b border-border-default whitespace-nowrap">
                                    {col}
                                    {result.primaryKeys?.includes(col) && (
                                        <span className="ml-1 text-[9px] text-accent/60 font-normal normal-case">PK</span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) => {
                            const isDeleted = pendingDeletes.has(ri)
                            return (
                                <React.Fragment key={ri}>
                                    <tr
                                        className={`transition-colors ${isDeleted
                                            ? 'bg-error/8 line-through opacity-60'
                                            : 'hover:bg-hover/60 even:bg-white/[0.01]'
                                            }`}
                                    >
                                        <td className="py-0 px-0 text-right text-text-muted/50 text-[11px] tabular-nums
                                                   border-b border-border-subtle/50 border-r border-r-border-subtle">
                                            <button
                                                onClick={() => setExpandedRow(expandedRow === ri ? null : ri)}
                                                className={`w-full py-1.5 px-2.5 flex items-center justify-center cursor-pointer transition-colors
                                                ${expandedRow === ri ? 'text-accent font-semibold' : 'hover:text-text-secondary'}`}
                                                title="Expand row"
                                            >
                                                {ri + 1}
                                            </button>
                                        </td>
                                        {row.map((cell, ci) => {
                                            const edited = isEdited(ri, ci)
                                            const isEditingThis = editingCell?.row === ri && editingCell?.col === ci
                                            const isPK = result.primaryKeys?.includes(result.columns[ci])

                                            return (
                                                <td
                                                    key={ci}
                                                    className={`py-1.5 px-3 border-b border-border-subtle/50
                                                    whitespace-nowrap max-w-[320px] overflow-hidden text-ellipsis select-text
                                                    ${edited ? 'bg-warning/10 text-warning' : 'text-text-secondary'}
                                                    ${canEdit && !isPK && !isDeleted ? 'cursor-text' : ''}
                                                `}
                                                    onDoubleClick={() => !isPK && startEdit(ri, ci)}
                                                >
                                                    {isEditingThis ? (
                                                        <input
                                                            ref={inputRef}
                                                            className="bg-transparent outline-none border-b border-accent text-text-primary w-full font-mono text-[13px]"
                                                            defaultValue={getCellValue(ri, ci)}
                                                            onBlur={e => commitEdit(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') commitEdit((e.target as HTMLInputElement).value)
                                                                if (e.key === 'Escape') setEditingCell(null)
                                                            }}
                                                        />
                                                    ) : cell === null && !edited ? (
                                                        <span className="text-text-muted/40 italic text-[12px]">NULL</span>
                                                    ) : typeof cell === 'number' && !edited ? (
                                                        <span className="text-accent tabular-nums">{cell}</span>
                                                    ) : edited ? (
                                                        <span title={`Was: ${rows[ri][ci]}`}>{getCellValue(ri, ci)}</span>
                                                    ) : (
                                                        String(cell)
                                                    )}
                                                </td>
                                            )
                                        })}
                                    </tr>
                                    {
                                        expandedRow === ri && (
                                            <tr>
                                                <td colSpan={result.columns.length + 1}
                                                    className="p-0 border-b border-border-default bg-elevated/60">
                                                    <div className="p-3 flex flex-col gap-1.5 select-text">
                                                        {result.columns.map((col, ci) => {
                                                            const val = row[ci]
                                                            return (
                                                                <div key={ci} className="flex gap-3 text-[12px] leading-relaxed">
                                                                    <span className="text-text-muted font-semibold min-w-[120px] flex-shrink-0 pt-0.5">{col}</span>
                                                                    <pre className="text-text-secondary font-mono whitespace-pre-wrap break-all m-0 flex-1 min-w-0 overflow-x-auto">{formatCellValue(val)}</pre>
                                                                </div>
                                                            )
                                                        })}
                                                        {canEdit && (
                                                            <div className="flex justify-start pt-2 mt-1 border-t border-border-subtle/50">
                                                                <button
                                                                    onClick={() => toggleDelete(ri)}
                                                                    className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors
                                                                        ${isDeleted
                                                                            ? 'bg-success/20 text-success border border-success/30 hover:bg-success hover:text-white'
                                                                            : 'bg-error/10 text-error border border-error/20 hover:bg-error hover:text-white'
                                                                        }`}
                                                                >
                                                                    {isDeleted ? 'Undo Delete' : 'Delete Row'}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                </React.Fragment>)
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-3 py-2 border-t border-border-default bg-surface/80 flex-shrink-0">
                <span className="text-text-secondary text-[12px]">
                    <strong className="text-text-primary font-semibold">{rows.length}</strong>
                    {' '}row{rows.length !== 1 ? 's' : ''}
                    {result.totalRows > rows.length && (
                        <span className="text-text-muted"> of {result.totalRows} fetched</span>
                    )}
                </span>

                {result.hasMore && (
                    <button
                        className="px-3 py-1 text-[11px] font-semibold bg-accent-muted text-accent
                                   border border-accent/30 rounded-md hover:bg-accent hover:text-white
                                   transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={onFetchMore}
                        disabled={loading}
                    >
                        {loading ? 'Loading...' : 'Load More →'}
                    </button>
                )}

                <div className="flex-1" />

                {/* Pending changes badge + actions */}
                {hasPending && (
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-warning font-medium">
                            {editCount > 0 && `${editCount} edit${editCount > 1 ? 's' : ''}`}
                            {editCount > 0 && deleteCount > 0 && ' · '}
                            {deleteCount > 0 && (
                                <span className="text-error">{deleteCount} delete{deleteCount > 1 ? 's' : ''}</span>
                            )}
                        </span>
                        <button
                            className="px-2.5 py-1 text-[11px] font-medium text-text-muted
                                       border border-border-subtle rounded-md hover:bg-hover transition-colors"
                            onClick={discardAll}
                            disabled={saving}
                        >
                            Discard
                        </button>
                        <button
                            className="px-3 py-1 text-[11px] font-semibold bg-success/20 text-success
                                       border border-success/30 rounded-md hover:bg-success hover:text-white
                                       transition-all disabled:opacity-40"
                            onClick={saveAll}
                            disabled={saving}
                        >
                            {saving ? 'Saving...' : <><IconCheck size={14} /> Save</>}
                        </button>
                    </div>
                )}

                <span className="text-text-muted text-[11px] font-mono tabular-nums">{result.durationMs}ms</span>
            </div>
        </div >
    )
}
