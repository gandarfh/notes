import { useState, useEffect, useCallback, useRef } from 'react'
import './database.css'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { DBConnView, QueryResultView, SchemaInfo, Mutation } from './types'
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

function DatabaseRenderer({ block, isEditing, isSelected, ctx }: BlockRendererProps) {
    const config = parseConfig(block.content)
    const configRef = useRef(config)
    configRef.current = config

    const rpc = ctx!.rpc

    const [connectionId, setConnectionId] = useState(config.connectionId || '')
    const [connections, setConnections] = useState<DBConnView[]>([])
    const [schema, setSchema] = useState<SchemaInfo | null>(null)
    const [cachedResult, setCachedResult] = useState<QueryResultView | null>(null)
    const [loading, setLoading] = useState(false)
    const [isCached, setIsCached] = useState(false)
    const [schemaLoading, setSchemaLoading] = useState(false)

    // Load connections list
    useEffect(() => {
        rpc.call<DBConnView[]>('ListDatabaseConnections').then(setConnections).catch(console.error)
    }, [rpc])

    // Load cached result on mount
    useEffect(() => {
        rpc.call<QueryResultView>('GetCachedResult', block.id).then(r => {
            // hasMore=false: cursor doesn't persist between navigations
            if (r) {
                setCachedResult({ ...r, hasMore: false })
                setIsCached(true)
            }
        }).catch(console.error)
    }, [block.id, rpc])

    // Load schema when connection changes
    useEffect(() => {
        if (!connectionId) return
        setSchemaLoading(true)
        rpc.call<SchemaInfo>('IntrospectDatabase', connectionId)
            .then(setSchema)
            .catch(console.error)
            .finally(() => setSchemaLoading(false))
    }, [connectionId, rpc])

    // Helper to persist config
    const persistConfig = useCallback(async (newConfig: BlockDBConfig) => {
        const json = JSON.stringify(newConfig)
        await rpc.call('SaveBlockDatabaseConfig', block.id, json)
        ctx!.storage.setContent(json)
    }, [block.id, rpc, ctx])

    const handleConnect = useCallback(async (connId: string) => {
        setConnectionId(connId)
        await persistConfig({ ...configRef.current, connectionId: connId })
        // Refresh connections list
        rpc.call<DBConnView[]>('ListDatabaseConnections').then(setConnections).catch(console.error)
    }, [persistConfig, rpc])

    const handleExecute = useCallback(async (query: string, page?: number) => {
        if (!connectionId) return
        setLoading(true)
        try {
            const fetchSize = configRef.current.fetchSize || 50
            let result: QueryResultView

            if (page !== undefined && page > 0) {
                result = await rpc.call<QueryResultView>('FetchMoreRows', connectionId, fetchSize)
            } else {
                result = await rpc.call<QueryResultView>('ExecuteQuery', block.id, connectionId, query, fetchSize)
            }
            setCachedResult(result)
            setIsCached(false)

            // Persist query in config
            await persistConfig({ ...configRef.current, connectionId, query })

            // Emit event for ETL
            ctx!.events.emit('database:query-executed', { blockId: block.id })
        } catch (e: any) {
            setCachedResult({ columns: [], rows: [], totalRows: 0, hasMore: false, durationMs: 0, error: e.message || String(e), isWrite: false, affectedRows: 0, query })
        } finally {
            setLoading(false)
        }
    }, [connectionId, block.id, persistConfig, rpc, ctx])

    const handleFetchMore = useCallback(async () => {
        if (!connectionId) return
        setLoading(true)
        try {
            const result = await rpc.call<QueryResultView>('FetchMoreRows', connectionId, config.fetchSize || 50)
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
    }, [connectionId, cachedResult, config.fetchSize, rpc])

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

        const result = await rpc.call<{ errors?: string[] }>('ApplyMutations', connectionId, table, mutations)
        if (result.errors?.length) {
            console.error('[DB] Mutation errors:', result.errors)
        }
        // Re-execute the query to refresh data
        if (configRef.current.query) {
            await handleExecute(configRef.current.query)
        }
    }, [connectionId, handleExecute, rpc])

    const currentConn = connections.find(c => c.id === connectionId)

    const refreshConnections = useCallback(() => {
        rpc.call<DBConnView[]>('ListDatabaseConnections').then(setConnections)
    }, [rpc])

    // Stage 1: Setup (no connection configured)
    if (!connectionId) {
        return (
            <div className="db-block">
                <SetupStage
                    connections={connections}
                    onConnect={handleConnect}
                    onRefreshConnections={refreshConnections}
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
    publicAPI: (ctx) => ({
        listConnections: () => ctx.rpc.call('ListDatabaseConnections'),
        listBlocksOnPage: (pageId: string) => ctx.rpc.call('ListPageDatabaseBlocks', pageId),
    }),
}
