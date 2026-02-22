import { useState, useEffect, useCallback, useRef } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { DBConnView, QueryResultView, SchemaInfo, Mutation } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { useAppStore } from '../../store'
import { SetupStage } from './SetupStage'
import { QueryStage } from './QueryStage'

// ── Block config stored in block.content as JSON ───────────

interface BlockDBConfig {
    connectionId?: string
    query?: string
    fetchSize?: number
}

function parseConfig(content: string): BlockDBConfig {
    try {
        return JSON.parse(content || '{}')
    } catch {
        return {}
    }
}

// ── Main Renderer ──────────────────────────────────────────

function DatabaseRenderer({ block, isEditing, isSelected }: BlockRendererProps) {
    const config = parseConfig(block.content)
    const configRef = useRef(config)
    configRef.current = config

    const updateBlock = useAppStore(s => s.updateBlock)

    const [connectionId, setConnectionId] = useState(config.connectionId || '')
    const [connections, setConnections] = useState<DBConnView[]>([])
    const [schema, setSchema] = useState<SchemaInfo | null>(null)
    const [cachedResult, setCachedResult] = useState<QueryResultView | null>(null)
    const [loading, setLoading] = useState(false)
    const [isCached, setIsCached] = useState(false)
    const [schemaLoading, setSchemaLoading] = useState(false)

    // Load connections list
    useEffect(() => {
        api.listDatabaseConnections().then(setConnections).catch(console.error)
    }, [])

    // Load cached result on mount
    useEffect(() => {
        api.getCachedResult(block.id).then(r => {
            // hasMore=false: cursor doesn't persist between navigations
            if (r) {
                setCachedResult({ ...r, hasMore: false })
                setIsCached(true)
            }
        }).catch(console.error)
    }, [block.id])

    // Load schema when connection changes
    useEffect(() => {
        if (!connectionId) return
        setSchemaLoading(true)
        api.introspectDatabase(connectionId)
            .then(setSchema)
            .catch(console.error)
            .finally(() => setSchemaLoading(false))
    }, [connectionId])

    // Helper to persist config and sync Zustand store
    const persistConfig = useCallback(async (newConfig: BlockDBConfig) => {
        const json = JSON.stringify(newConfig)
        await api.saveBlockDatabaseConfig(block.id, json)
        // Keep the Zustand store in sync so block.content is up-to-date
        updateBlock(block.id, { content: json })
    }, [block.id, updateBlock])

    const handleConnect = useCallback(async (connId: string) => {
        setConnectionId(connId)
        await persistConfig({ ...configRef.current, connectionId: connId })
        // Refresh connections list
        api.listDatabaseConnections().then(setConnections).catch(console.error)
    }, [persistConfig])

    const handleExecute = useCallback(async (query: string, page?: number) => {
        if (!connectionId) return
        setLoading(true)
        try {
            const fetchSize = configRef.current.fetchSize || 50
            let result: QueryResultView

            if (page !== undefined && page > 0) {
                result = await api.fetchMoreRows(connectionId, fetchSize)
            } else {
                result = await api.executeQuery(block.id, connectionId, query, fetchSize)
            }
            setCachedResult(result)
            setIsCached(false)

            // Persist query in config
            await persistConfig({ ...configRef.current, connectionId, query })
        } catch (e: any) {
            setCachedResult({ columns: [], rows: [], totalRows: 0, hasMore: false, durationMs: 0, error: e.message || String(e), isWrite: false, affectedRows: 0, query })
        } finally {
            setLoading(false)
        }
    }, [connectionId, block.id, persistConfig])

    const handleFetchMore = useCallback(async () => {
        if (!connectionId) return
        setLoading(true)
        try {
            const result = await api.fetchMoreRows(connectionId, config.fetchSize || 50)
            if (result.error) {
                console.error('[DB] FetchMore error:', result.error)
                return
            }
            if (cachedResult) {
                setCachedResult({
                    ...result,
                    rows: [...(cachedResult.rows || []), ...(result.rows || [])],
                    totalRows: result.totalRows,
                })
            } else {
                setCachedResult(result)
            }
        } catch (e: any) {
            console.error('[DB] FetchMore failed:', e)
        } finally {
            setLoading(false)
        }
    }, [connectionId, cachedResult, config.fetchSize])

    const handleApplyMutations = useCallback(async (mutations: Mutation[]) => {
        if (!connectionId) return
        // Extract table name from the stored query
        let table = ''
        try {
            const parsed = JSON.parse(configRef.current.query || '{}')
            table = parsed.collection || '' // MongoDB
        } catch { /* ignore */ }
        if (!table) {
            // SQL: extract from query string
            const match = (configRef.current.query || '').match(/FROM\s+[`"']?(\w+)/i)
            if (match) table = match[1]
        }
        if (!table) throw new Error('Could not determine table name')

        const result = await api.applyMutations(connectionId, table, mutations)
        if (result.errors?.length) {
            console.error('[DB] Mutation errors:', result.errors)
        }
        // Re-execute the query to refresh data
        if (configRef.current.query) {
            await handleExecute(configRef.current.query)
        }
    }, [connectionId, handleExecute])

    const currentConn = connections.find(c => c.id === connectionId)

    // Stage 1: Setup (no connection configured)
    if (!connectionId) {
        return (
            <div className="db-block">
                <SetupStage
                    connections={connections}
                    onConnect={handleConnect}
                    onRefreshConnections={() => api.listDatabaseConnections().then(setConnections)}
                />
            </div>
        )
    }

    // Stage 2: Query + Results
    return (
        <div className="db-block">
            <QueryStage
                blockId={block.id}
                connection={currentConn || null}
                connections={connections}
                schema={schema}
                result={cachedResult}
                query={config.query || ''}
                loading={loading}
                isCached={isCached}
                onExecute={handleExecute}
                onFetchMore={handleFetchMore}
                onChangeConnection={handleConnect}
                onApplyMutations={handleApplyMutations}
                schemaLoading={schemaLoading}
            />
        </div>
    )
}

// ── Icon Component ─────────────────────────────────────────

function DatabaseIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
            <ellipse cx="9" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3 5v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3 9c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const databasePlugin: BlockPlugin = {
    type: 'database',
    label: 'Database',
    Icon: DatabaseIcon,
    defaultSize: { width: 600, height: 450 },
    Renderer: DatabaseRenderer,
    headerLabel: 'DB',
}
