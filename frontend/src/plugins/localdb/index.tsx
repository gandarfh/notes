import './localdb.css'
import 'react-data-grid/lib/styles.css'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { BlockPlugin, PluginRendererProps } from '../sdk'
import type { ColumnDef, LocalDatabase, LocalDBRow, LocalDatabaseConfig, ViewConfig, SavedView } from './types'
import { useWheelCapture } from '../shared'
import { ViewSwitcher, type ViewType } from './ViewSwitcher'
import { TableView } from './TableView'
import { KanbanView } from './KanbanView'
import { CalendarView } from './CalendarView'
import { ViewConfigBar } from './ViewConfigBar'
import { useLocalDBTable } from './useLocalDBTable'

// Generate a short unique ID for saved views
let viewIdCounter = 0
function genViewId() {
    return `v-${Date.now().toString(36)}-${(viewIdCounter++).toString(36)}`
}

// ── Config Migration ─────────────────────────────────────────
// If no saved views exist, create a default one from legacy config.

function migrateConfig(raw: Partial<LocalDatabaseConfig>): LocalDatabaseConfig {
    const columns = Array.isArray(raw.columns) ? raw.columns : []

    if (raw.views && raw.views.length > 0) {
        // Already migrated
        return {
            columns,
            views: raw.views,
            activeViewId: raw.activeViewId || raw.views[0].id,
        }
    }

    // Migrate from legacy
    const layout = (raw.activeView || 'table') as ViewType
    const defaultView: SavedView = {
        id: genViewId(),
        name: layout.charAt(0).toUpperCase() + layout.slice(1),
        layout,
        config: raw.viewConfig || {},
    }

    return {
        columns,
        views: [defaultView],
        activeViewId: defaultView.id,
    }
}

// ── Main Renderer ──────────────────────────────────────────

function LocalDBRenderer({ block, isSelected, ctx }: PluginRendererProps) {
    const rpc = ctx!.rpc

    const [db, setDb] = useState<LocalDatabase | null>(null)
    const [rows, setRows] = useState<LocalDBRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [editingName, setEditingName] = useState(false)
    const [nameValue, setNameValue] = useState('')
    const configRef = useRef<LocalDatabaseConfig | null>(null)
    const blockRef = useRef<HTMLDivElement>(null)
    const nameInputRef = useRef<HTMLInputElement>(null)

    // Parse config with migration
    const getConfig = useCallback((): LocalDatabaseConfig => {
        if (!db) return { columns: [], views: [{ id: 'default', name: 'Table', layout: 'table', config: {} }], activeViewId: 'default' }
        try {
            const parsed = JSON.parse(db.configJson || '{}') as Partial<LocalDatabaseConfig>
            const normalized = migrateConfig(parsed)
            configRef.current = normalized
            return normalized
        } catch {
            return { columns: [], views: [{ id: 'default', name: 'Table', layout: 'table', config: {} }], activeViewId: 'default' }
        }
    }, [db])

    // Persist config helper
    const persistConfig = useCallback(async (updated: LocalDatabaseConfig) => {
        if (!db) return
        const json = JSON.stringify(updated)
        setDb(prev => prev ? { ...prev, configJson: json } : prev)
        configRef.current = updated
        await rpc.call('UpdateLocalDatabaseConfig', db.id, json).catch(console.error)
    }, [db, rpc])

    // Reusable data loader
    const loadData = useCallback(async () => {
        try {
            setLoading(true)
            const database = await rpc.call<LocalDatabase>('GetLocalDatabase', block.id)
            setDb(database)
            setNameValue(database.name || 'Untitled')
            const dbRows = await rpc.call<LocalDBRow[]>('ListLocalDBRows', database.id)
            setRows(dbRows || [])
        } catch (err) {
            setError(String(err))
        } finally {
            setLoading(false)
        }
    }, [block.id, rpc])

    useEffect(() => { loadData() }, [loadData])

    useEffect(() => {
        if (!db) return
        return ctx!.events.on('localdb:changed', (payload: any) => {
            if (payload?.databaseId === db.id && !selfChangeRef.current) loadData()
        })
    }, [db, loadData, ctx])

    useEffect(() => {
        if (!db) return
        return ctx!.events.onBackend('db:updated', (payload: any) => {
            if (payload?.databaseId === db.id) loadData()
        })
    }, [db, loadData, ctx])

    useWheelCapture(blockRef, isSelected)

    const selfChangeRef = useRef(false)
    const notifyDbChanged = useCallback(() => {
        if (!db) return
        selfChangeRef.current = true
        ctx!.events.emit('localdb:changed', { databaseId: db.id })
        ctx!.events.emit('localdb:rows-updated', { databaseId: db.id, rowCount: rows.length })
        // Reset after microtask so the event listener can check the flag
        queueMicrotask(() => { selfChangeRef.current = false })
    }, [db, ctx, rows])

    // ── Name rename ──
    const handleNameBlur = useCallback(async () => {
        setEditingName(false)
        if (!db) return
        const trimmed = nameValue.trim() || 'Untitled'
        setNameValue(trimmed)
        if (trimmed !== db.name) {
            setDb(prev => prev ? { ...prev, name: trimmed } : prev)
            await rpc.call('RenameLocalDatabase', db.id, trimmed).catch(console.error)
        }
    }, [db, nameValue, rpc])

    const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') { setNameValue(db?.name || 'Untitled'); setEditingName(false) }
    }, [db])

    const startEditingName = useCallback(() => {
        setEditingName(true)
        setTimeout(() => nameInputRef.current?.select(), 0)
    }, [])

    // ── Row handlers ──
    const handleCellChange = useCallback(async (rowId: string, colId: string, value: unknown) => {
        setRows(prev => prev.map(r => {
            if (r.id !== rowId) return r
            const data = JSON.parse(r.dataJson || '{}')
            data[colId] = value
            return { ...r, dataJson: JSON.stringify(data) }
        }))
        const row = rows.find(r => r.id === rowId)
        if (!row) return
        const data = JSON.parse(row.dataJson || '{}')
        data[colId] = value
        await rpc.call('UpdateLocalDBRow', rowId, JSON.stringify(data)).catch(console.error)
        notifyDbChanged()
    }, [rows, notifyDbChanged, rpc])

    const handleAddRow = useCallback(async (initialData?: Record<string, unknown>) => {
        if (!db) return
        // Guard against React SyntheticEvent being passed when used as onClick handler
        const isPlainObject = initialData && typeof initialData === 'object' && !(initialData instanceof Event) && !('nativeEvent' in initialData)
        const dataJson = isPlainObject ? JSON.stringify(initialData) : '{}'
        const newRow = await rpc.call<LocalDBRow>('CreateLocalDBRow', db.id, dataJson)
        if (newRow) setRows(prev => [...prev, newRow])
        notifyDbChanged()
    }, [db, notifyDbChanged, rpc])

    const handleDeleteRow = useCallback(async (rowId: string) => {
        setRows(prev => prev.filter(r => r.id !== rowId))
        await rpc.call('DeleteLocalDBRow', rowId).catch(console.error)
        notifyDbChanged()
    }, [notifyDbChanged, rpc])

    const handleDuplicateRow = useCallback(async (rowId: string) => {
        const dup = await rpc.call<LocalDBRow>('DuplicateLocalDBRow', rowId)
        if (dup) {
            setRows(prev => {
                const idx = prev.findIndex(r => r.id === rowId)
                const next = [...prev]
                next.splice(idx + 1, 0, dup)
                return next
            })
        }
    }, [rpc])

    const handleColumnsChange = useCallback(async (newColumns: ColumnDef[]) => {
        if (!db) return
        const config = configRef.current || getConfig()
        const updated = { ...config, columns: newColumns }
        await persistConfig(updated)
        notifyDbChanged()
    }, [db, getConfig, persistConfig, notifyDbChanged])

    const handleReorderRows = useCallback(async (rowIds: string[]) => {
        if (!db) return
        setRows(prev => {
            const map = new Map(prev.map(r => [r.id, r]))
            return rowIds.map(id => map.get(id)).filter(Boolean) as LocalDBRow[]
        })
        await rpc.call('ReorderLocalDBRows', db.id, rowIds).catch(console.error)
    }, [db, rpc])

    // ── Saved View handlers ──

    const handleSelectView = useCallback(async (viewId: string) => {
        const config = configRef.current || getConfig()
        await persistConfig({ ...config, activeViewId: viewId })
    }, [getConfig, persistConfig])

    const handleAddView = useCallback(async (layout: ViewType) => {
        const config = configRef.current || getConfig()
        const views = config.views || []
        const newView: SavedView = {
            id: genViewId(),
            name: layout.charAt(0).toUpperCase() + layout.slice(1),
            layout,
            config: {},
        }
        await persistConfig({ ...config, views: [...views, newView], activeViewId: newView.id })
    }, [getConfig, persistConfig])

    const handleRenameView = useCallback(async (viewId: string, name: string) => {
        const config = configRef.current || getConfig()
        const views = (config.views || []).map(v => v.id === viewId ? { ...v, name } : v)
        await persistConfig({ ...config, views })
    }, [getConfig, persistConfig])

    const handleDeleteView = useCallback(async (viewId: string) => {
        const config = configRef.current || getConfig()
        const views = (config.views || []).filter(v => v.id !== viewId)
        if (views.length === 0) return
        const activeViewId = config.activeViewId === viewId ? views[0].id : config.activeViewId
        await persistConfig({ ...config, views, activeViewId })
    }, [getConfig, persistConfig])

    const handleDuplicateView = useCallback(async (viewId: string) => {
        const config = configRef.current || getConfig()
        const original = (config.views || []).find(v => v.id === viewId)
        if (!original) return
        const dup: SavedView = {
            ...original,
            id: genViewId(),
            name: `${original.name} (copy)`,
            config: { ...original.config },
        }
        const views = [...(config.views || []), dup]
        await persistConfig({ ...config, views, activeViewId: dup.id })
    }, [getConfig, persistConfig])

    // View config change (for the active view)
    const handleViewConfigChange = useCallback(async (newViewConfig: ViewConfig) => {
        const config = configRef.current || getConfig()
        const views = (config.views || []).map(v =>
            v.id === config.activeViewId ? { ...v, config: newViewConfig } : v,
        )
        await persistConfig({ ...config, views })
    }, [getConfig, persistConfig])

    // Derive config values BEFORE early returns (hooks must be unconditional)
    // Memoize to keep stable reference — getConfig() calls JSON.parse every time
    const config = useMemo(() => getConfig(), [getConfig])
    const views = config.views || []
    const activeViewId = config.activeViewId || views[0]?.id || 'default'
    const activeView = views.find(v => v.id === activeViewId) || views[0]
    const activeLayout = (activeView?.layout || 'table') as ViewType
    // Memoize viewConfig to avoid infinite re-render loop in useLocalDBTable's useEffect
    const viewConfig = useMemo(() => activeView?.config || {}, [activeView])

    // Shared TanStack Table instance — must be called unconditionally
    const tableInstance = useLocalDBTable({
        columns: config.columns ?? [],
        rows,
        viewConfig,
    })

    // Get filtered+sorted rows from TanStack for all views
    const filteredRows = tableInstance.table.getRowModel().rows.map(r => r.original._raw)

    // Sort change handler — persist to viewConfig (must be before early returns)
    const handleSortChange = useCallback(async (sorting: { id: string; desc: boolean }[]) => {
        const cfg = configRef.current || getConfig()
        const updatedViews = (cfg.views || []).map(v =>
            v.id === cfg.activeViewId ? { ...v, config: { ...v.config, sorting } } : v,
        )
        await persistConfig({ ...cfg, views: updatedViews })
        tableInstance.setSorting(sorting)
    }, [getConfig, persistConfig, tableInstance])

    // Filter columns by visibility for the active view (must be before early returns)
    const visibleColumns = useMemo(() => {
        const all = config.columns ?? []
        const vis = viewConfig.columnVisibility
        if (!vis) return all
        return all.filter(c => vis[c.id] !== false)
    }, [config.columns, viewConfig.columnVisibility])

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
                <span>{'\u26A0'} {error}</span>
            </div>
        )
    }

    const viewProps = {
        columns: visibleColumns,
        rows: filteredRows,
        viewConfig,
        onCellChange: handleCellChange,
        onAddRow: handleAddRow,
        onDeleteRow: handleDeleteRow,
        onDuplicateRow: handleDuplicateRow,
        onColumnsChange: handleColumnsChange,
    }

    const renderView = () => {
        switch (activeLayout) {
            case 'kanban': return <KanbanView {...viewProps} onReorderRows={handleReorderRows} />
            case 'calendar': return <CalendarView {...viewProps} />
            default: return <TableView {...viewProps} onSortChange={handleSortChange} />
        }
    }

    return (
        <div
            className="ldb-block"
            ref={blockRef}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Title bar with view switcher */}
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
                <ViewSwitcher
                    views={views}
                    activeViewId={activeViewId}
                    onSelectView={handleSelectView}
                    onAddView={handleAddView}
                    onRenameView={handleRenameView}
                    onDeleteView={handleDeleteView}
                    onDuplicateView={handleDuplicateView}
                />
                <span className="ldb-title-count">{filteredRows.length}{filteredRows.length !== rows.length ? ` / ${rows.length}` : ''} rows</span>
            </div>

            <ViewConfigBar
                activeView={activeLayout}
                columns={config.columns}
                viewConfig={viewConfig}
                onConfigChange={handleViewConfigChange}
                table={tableInstance.table}
            />

            {renderView()}
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
    publicAPI: (ctx) => ({
        listDatabases: () => ctx.rpc.call('ListLocalDatabases'),
        getRows: (dbId: string) => ctx.rpc.call('ListLocalDBRows', dbId),
        getConfig: (dbId: string) => ctx.rpc.call('GetLocalDatabase', dbId)
            .then((db: any) => JSON.parse(db?.configJson || '{}')),
        getStats: (dbId: string) => ctx.rpc.call('GetLocalDBStats', dbId),
    }),
}
