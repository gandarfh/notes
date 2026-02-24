import { useState, useEffect, useCallback, useRef } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { ColumnDef, LocalDatabase, LocalDBRow, LocalDatabaseConfig } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { TableView } from './TableView'

// ── Main Renderer ──────────────────────────────────────────

function LocalDBRenderer({ block }: BlockRendererProps) {
    const [db, setDb] = useState<LocalDatabase | null>(null)
    const [rows, setRows] = useState<LocalDBRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [editingName, setEditingName] = useState(false)
    const [nameValue, setNameValue] = useState('')
    const configRef = useRef<LocalDatabaseConfig | null>(null)
    const blockRef = useRef<HTMLDivElement>(null)
    const nameInputRef = useRef<HTMLInputElement>(null)

    // Parse config
    const getConfig = useCallback((): LocalDatabaseConfig => {
        if (!db) return { columns: [], activeView: 'table' }
        try {
            const parsed = JSON.parse(db.configJson || '{}') as LocalDatabaseConfig
            configRef.current = parsed
            return parsed
        } catch {
            return { columns: [], activeView: 'table' }
        }
    }, [db])

    // Load database and rows
    useEffect(() => {
        let cancelled = false
        setLoading(true)
        api.getLocalDatabase(block.id)
            .then(async (database) => {
                if (cancelled) return
                setDb(database)
                setNameValue(database.name || 'Untitled')
                const dbRows = await api.listLocalDBRows(database.id)
                if (!cancelled) setRows(dbRows || [])
            })
            .catch(err => {
                if (!cancelled) setError(String(err))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => { cancelled = true }
    }, [block.id])

    // Native wheel listener — stops propagation to prevent Canvas from
    // calling preventDefault() which blocks horizontal scroll inside the table.
    useEffect(() => {
        const el = blockRef.current
        if (!el) return
        const handler = (e: WheelEvent) => {
            e.stopPropagation()
        }
        el.addEventListener('wheel', handler, { passive: true })
        return () => el.removeEventListener('wheel', handler)
    }, [loading])

    // ── Name rename ──
    const handleNameBlur = useCallback(async () => {
        setEditingName(false)
        if (!db) return
        const trimmed = nameValue.trim() || 'Untitled'
        setNameValue(trimmed)
        if (trimmed !== db.name) {
            setDb(prev => prev ? { ...prev, name: trimmed } : prev)
            await api.renameLocalDatabase(db.id, trimmed).catch(console.error)
        }
    }, [db, nameValue])

    const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') { setNameValue(db?.name || 'Untitled'); setEditingName(false) }
    }, [db])

    const startEditingName = useCallback(() => {
        setEditingName(true)
        setTimeout(() => nameInputRef.current?.select(), 0)
    }, [])

    // Cell change handler
    const handleCellChange = useCallback(async (rowId: string, colId: string, value: unknown) => {
        // Optimistic update
        setRows(prev => prev.map(r => {
            if (r.id !== rowId) return r
            const data = JSON.parse(r.dataJson || '{}')
            data[colId] = value
            return { ...r, dataJson: JSON.stringify(data) }
        }))
        // Persist
        const row = rows.find(r => r.id === rowId)
        if (!row) return
        const data = JSON.parse(row.dataJson || '{}')
        data[colId] = value
        await api.updateLocalDBRow(rowId, JSON.stringify(data)).catch(console.error)
    }, [rows])

    // Add row
    const handleAddRow = useCallback(async () => {
        if (!db) return
        const newRow = await api.createLocalDBRow(db.id, '{}')
        if (newRow) setRows(prev => [...prev, newRow])
    }, [db])

    // Delete row
    const handleDeleteRow = useCallback(async (rowId: string) => {
        setRows(prev => prev.filter(r => r.id !== rowId))
        await api.deleteLocalDBRow(rowId).catch(console.error)
    }, [])

    // Duplicate row
    const handleDuplicateRow = useCallback(async (rowId: string) => {
        const dup = await api.duplicateLocalDBRow(rowId)
        if (dup) {
            setRows(prev => {
                const idx = prev.findIndex(r => r.id === rowId)
                const next = [...prev]
                next.splice(idx + 1, 0, dup)
                return next
            })
        }
    }, [])

    // Column changes
    const handleColumnsChange = useCallback(async (newColumns: ColumnDef[]) => {
        if (!db) return
        const config = configRef.current || { columns: [], activeView: 'table' }
        const updated = { ...config, columns: newColumns }
        const json = JSON.stringify(updated)

        // Optimistic update
        setDb(prev => prev ? { ...prev, configJson: json } : prev)

        await api.updateLocalDatabaseConfig(db.id, json).catch(console.error)
    }, [db])

    if (loading) {
        return (
            <div className="ldb-block ldb-loading">
                <div className="ldb-spinner" />
                <span>Loading database...</span>
            </div>
        )
    }

    if (error) {
        return (
            <div className="ldb-block ldb-error">
                <span>⚠ {error}</span>
            </div>
        )
    }

    const config = getConfig()

    return (
        <div
            className="ldb-block"
            ref={blockRef}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Editable database title */}
            <div className="ldb-title-bar">
                {editingName ? (
                    <input
                        ref={nameInputRef}
                        className="ldb-title-input"
                        value={nameValue}
                        onChange={e => setNameValue(e.target.value)}
                        onBlur={handleNameBlur}
                        onKeyDown={handleNameKeyDown}
                    />
                ) : (
                    <span className="ldb-title-text" onDoubleClick={startEditingName}>
                        {nameValue}
                    </span>
                )}
                <span className="ldb-title-count">{rows.length} rows</span>
            </div>

            <TableView
                columns={config.columns}
                rows={rows}
                onCellChange={handleCellChange}
                onAddRow={handleAddRow}
                onDeleteRow={handleDeleteRow}
                onDuplicateRow={handleDuplicateRow}
                onColumnsChange={handleColumnsChange}
            />
        </div>
    )
}

// ── Icon ───────────────────────────────────────────────────

function LocalDBIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
            <rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <line x1="2" y1="6.5" x2="16" y2="6.5" stroke="currentColor" strokeWidth="1" />
            <line x1="2" y1="10.5" x2="16" y2="10.5" stroke="currentColor" strokeWidth="1" />
            <line x1="7" y1="2" x2="7" y2="16" stroke="currentColor" strokeWidth="1" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const localdbPlugin: BlockPlugin = {
    type: 'localdb',
    label: 'Local DB',
    Icon: LocalDBIcon,
    defaultSize: { width: 700, height: 450 },
    Renderer: LocalDBRenderer,
    headerLabel: 'DB',
}
