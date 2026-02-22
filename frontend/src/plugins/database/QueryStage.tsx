import { useState, useMemo, useRef, useCallback } from 'react'
import type { DBConnView, QueryResultView, SchemaInfo, Mutation } from '../../bridge/wails'
import { EJSON } from 'bson'
import { QueryEditor } from './QueryEditor'
import { ResultsTable } from './ResultsTable'

/**
 * Lightweight MongoDB shell syntax → JSON converter.
 * Replaces `parseFilter` from mongodb-query-parser which uses `acorn`
 * and breaks in production builds due to esbuild minification.
 */
function safeParseFilter(input: string): Record<string, any> {
    const trimmed = input.trim()
    if (!trimmed || trimmed === '{}') return {}

    // 1) Try straight JSON.parse first (already quoted keys)
    try { return JSON.parse(trimmed) } catch { /* continue */ }

    // 2) Convert BSON helpers to EJSON equivalents
    let converted = trimmed
        // ObjectId("...") / ObjectID("...") → { "$oid": "..." }
        .replace(/ObjectId\s*\(\s*["']([a-f0-9]{24})["']\s*\)/gi, '{"$oid":"$1"}')
        // ISODate("...") → { "$date": "..." }
        .replace(/ISODate\s*\(\s*["']([^"']+)["']\s*\)/gi, '{"$date":"$1"}')
        // new Date("...") → { "$date": "..." }
        .replace(/new\s+Date\s*\(\s*["']([^"']+)["']\s*\)/gi, '{"$date":"$1"}')
        // NumberLong("...") / NumberLong(...) → { "$numberLong": "..." }
        .replace(/NumberLong\s*\(\s*["']?(-?\d+)["']?\s*\)/gi, '{"$numberLong":"$1"}')
        // NumberInt(...) → integer
        .replace(/NumberInt\s*\(\s*(-?\d+)\s*\)/gi, '$1')

    // 3) Quote unquoted keys: { status: "active" } → { "status": "active" }
    //    Match word chars (and $-prefixed operators) before a colon
    converted = converted.replace(/([{,]\s*)(\$?[a-zA-Z_][\w$.]*)\s*:/g, '$1"$2":')

    // 4) Convert single-quoted strings to double-quoted
    converted = converted.replace(/'([^']*)'/g, '"$1"')

    try { return JSON.parse(converted) } catch { /* continue */ }

    // 5) Last resort: try EJSON.parse
    try { return EJSON.deserialize(JSON.parse(converted)) } catch { /* continue */ }

    throw new Error(`Could not parse filter: ${input}`)
}

/**
 * Convert a stored EJSON filter object back to readable MongoDB shell syntax.
 * Replaces `stringify` from mongodb-query-parser which also breaks in production.
 * e.g. { "$oid": "abc123..." } → ObjectId("abc123...")
 */
function filterToShellSyntax(obj: any): string {
    return JSON.stringify(obj, null, 2)
        // Convert EJSON types back to shell syntax for readability
        .replace(/\{\s*"\$oid"\s*:\s*"([a-f0-9]{24})"\s*\}/g, 'ObjectId("$1")')
        .replace(/\{\s*"\$date"\s*:\s*"([^"]+)"\s*\}/g, 'ISODate("$1")')
        .replace(/\{\s*"\$numberLong"\s*:\s*"(-?\d+)"\s*\}/g, 'NumberLong($1)')
        // Remove quotes from keys for shell style
        .replace(/"(\$?[a-zA-Z_][\w$.]*)":/g, '$1:')
        // Compact single-line for simple filters
        .replace(/\n\s*/g, ' ')
        .trim()
}

// Decode stored full JSON query back to shell syntax for the editor
function decodeMongoQuery(raw: string): { filter: string; collection: string } {
    if (!raw || !raw.trim()) return { filter: '', collection: '' }
    try {
        const parsed = JSON.parse(raw)
        if (parsed.collection && parsed.filter !== undefined) {
            const filterStr = Object.keys(parsed.filter).length === 0
                ? '{}'
                : filterToShellSyntax(parsed.filter)
            return { filter: filterStr, collection: parsed.collection as string }
        }
    } catch (e) {
        console.error('[DB] decodeMongoQuery failed for:', raw, e)
    }
    return { filter: raw, collection: '' }
}

interface QueryStageProps {
    blockId: string
    connection: DBConnView | null
    connections: DBConnView[]
    schema: SchemaInfo | null
    result: QueryResultView | null
    query: string
    loading: boolean
    isCached?: boolean
    onExecute: (query: string) => void
    onFetchMore: () => void
    onChangeConnection: (connId: string) => void
    onApplyMutations?: (mutations: Mutation[]) => Promise<void>
    schemaLoading?: boolean
}

const DRIVER_ICONS: Record<string, React.ReactNode> = {
    sqlite: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 2.69 3 6s-1.34 6-3 6-3-2.69-3-6 1.34-6 3-6zm-7 6c0-.34.02-.67.06-1h3.38c-.03.33-.04.66-.04 1s.01.67.04 1H5.06c-.04-.33-.06-.66-.06-1zm14 0c0 .34-.02.67-.06 1h-3.38c.03-.33.04-.66.04-1s-.01-.67-.04-1h3.38c.04.33.06.66.06 1z" fill="#0F80CC" />
        </svg>
    ),
    mysql: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4z" fill="#00546B" opacity="0.15" />
            <path d="M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4z" fill="#00546B" />
            <path d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7" stroke="#00546B" strokeWidth="1.5" fill="none" />
            <path d="M4 12c0 2.21 3.58 4 8 4s8-1.79 8-4" stroke="#00546B" strokeWidth="1" opacity="0.5" fill="none" />
        </svg>
    ),
    postgres: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M17.128 2.014c-1.614-.05-3.022.458-4.128 1.236-1.106-.778-2.514-1.287-4.128-1.236C5.076 2.14 2 5.573 2 9.5c0 4.774 3.285 9.276 5.98 11.756.576.53 1.29.744 2.02.744.73 0 1.444-.214 2.02-.744C14.715 18.776 18 14.274 18 9.5c0-.464-.038-.917-.108-1.358.732-.41 1.37-.987 1.87-1.692C20.49 5.393 21 4.04 21 2.5l-1.5.5c-.347.116-.71.2-1.08.25.247-.374.448-.78.598-1.25l.11.014z" fill="#336791" />
            <circle cx="9" cy="9" r="1.5" fill="white" />
            <circle cx="15" cy="9" r="1.5" fill="white" />
        </svg>
    ),
    mongodb: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C12 2 8.5 7 8.5 12c0 3.5 1.5 6.5 3.5 8.5V22h.5c0 0 .5-1 .5-1.5V20.5c2-2 3.5-5 3.5-8.5C16.5 7 12 2 12 2z" fill="#00ED64" />
            <path d="M12 2C12 2 8.5 7 8.5 12c0 3.5 1.5 6.5 3.5 8.5V22" stroke="#00684A" strokeWidth="0.5" fill="none" />
        </svg>
    ),
}

export function QueryStage({
    blockId,
    connection,
    connections,
    schema,
    result,
    query: initialQuery,
    loading,
    isCached,
    onExecute,
    onFetchMore,
    onChangeConnection,
    onApplyMutations,
    schemaLoading,
}: QueryStageProps) {
    const driver = connection?.driver || 'sqlite'
    const isMongo = driver === 'mongodb'

    // For MongoDB: track selected collection separately
    const collections = useMemo(() => {
        if (!isMongo || !schema?.tables) return []
        return schema.tables.map(t => t.name).sort()
    }, [isMongo, schema])

    // Decode stored query for MongoDB
    const decoded = useMemo(() => {
        if (!isMongo) return { filter: initialQuery, collection: '' }
        return decodeMongoQuery(initialQuery)
    }, [isMongo, initialQuery])

    const [selectedCollection, setSelectedCollection] = useState(decoded.collection || collections[0] || '')
    const queryRef = useRef(decoded.filter)
    const prevDecodedRef = useRef(decoded)

    // Sync queryRef and selectedCollection synchronously when decoded changes (no useEffect delay)
    if (prevDecodedRef.current !== decoded) {
        prevDecodedRef.current = decoded
        queryRef.current = decoded.filter
        if (decoded.collection && decoded.collection !== selectedCollection) {
            setSelectedCollection(decoded.collection)
        }
    }

    const handleQueryChange = useCallback((val: string) => {
        queryRef.current = val
    }, [])

    // When collections load and none selected, pick the first
    if (isMongo && !selectedCollection && collections.length > 0) {
        setSelectedCollection(collections[0])
    }

    const handleExecute = () => {
        if (isMongo) {
            const trimmed = queryRef.current.trim()
            if (!trimmed || trimmed === '{}') {
                // Empty filter — find all
                onExecute(JSON.stringify({ collection: selectedCollection, operation: 'find', filter: {} }))
                return
            }

            try {
                // Parse shell syntax using our lightweight parser (avoids acorn)
                const parsed = safeParseFilter(trimmed)
                // Serialize BSON types to Extended JSON
                const ejsonFilter = JSON.parse(EJSON.stringify(parsed, { relaxed: false }))

                const mongoQuery = {
                    collection: selectedCollection,
                    operation: 'find',
                    filter: ejsonFilter,
                }
                onExecute(JSON.stringify(mongoQuery))
            } catch (e: any) {
                // Try as full query JSON (with collection/operation keys)
                console.error('[DB] safeParseFilter failed:', e)
                try {
                    const full = JSON.parse(trimmed)
                    if (full.collection) {
                        onExecute(trimmed)
                        return
                    }
                } catch { /* not JSON either */ }
                // Let it fail with a clear error
                onExecute(JSON.stringify({
                    collection: selectedCollection,
                    operation: 'find',
                    filter: {},
                }))
            }
        } else {
            onExecute(queryRef.current)
        }
    }

    const placeholder = isMongo
        ? '{ status: "active" }'
        : 'SELECT * FROM ...'

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ── Header bar ── */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface/80 flex-shrink-0">
                {/* Connection badge */}
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-elevated rounded-lg border border-border-subtle">
                    <span className="flex items-center">{DRIVER_ICONS[driver] || <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M3 15h18" stroke="currentColor" strokeWidth="1" opacity="0.3" /></svg>}</span>
                    <select
                        className="bg-transparent text-text-primary text-[13px] font-medium font-mono outline-none cursor-pointer
                                   appearance-none pr-4"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238888a0' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
                        value={connection?.id || ''}
                        onChange={e => onChangeConnection(e.target.value)}
                    >
                        {connections.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                {/* MongoDB: Collection picker */}
                {isMongo && (collections.length > 0 || selectedCollection) && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-elevated rounded-lg border border-border-subtle">
                        <span className="text-text-muted text-[11px]">Collection</span>
                        <select
                            className="bg-transparent text-accent text-[13px] font-medium font-mono outline-none cursor-pointer
                                       appearance-none pr-4"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236366f1' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
                            value={selectedCollection}
                            onChange={e => setSelectedCollection(e.target.value)}
                        >
                            {collections.length > 0
                                ? collections.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))
                                : <option value={selectedCollection}>{selectedCollection}</option>
                            }
                        </select>
                    </div>
                )}

                {/* Schema loading indicator */}
                {schemaLoading && (
                    <span className="w-3.5 h-3.5 border-2 border-text-muted/20 border-t-accent rounded-full animate-spin" />
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {isCached && (
                    <span className="px-2 py-0.2 text-md font-medium text-warning/80 bg-warning/10 border border-warning/20 rounded">
                        cached
                    </span>
                )}

                {/* Run button */}
                <button
                    className="flex items-center gap-2 px-4 py-0.5 rounded-lg font-semibold text-md font-sans
                               transition-all shadow-sm
                               bg-success text-[#0a0a0f] hover:brightness-110
                               disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                    onClick={handleExecute}
                    disabled={loading}
                    title="Run query (⌘ Enter)"
                >
                    {loading ? (
                        <span className="w-3.5 h-3.5 border-2 border-[#0a0a0f]/30 border-t-[#0a0a0f] rounded-full animate-spin" />
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                            <path d="M3 1.5l9 5.5-9 5.5V1.5z" fill="currentColor" />
                        </svg>
                    )}
                    <span>Run</span>
                </button>
            </div>

            {/* ── Query editor ── */}
            <div className="flex-[0_0_40%] min-h-[90px] border-b border-border-default overflow-hidden relative">
                <QueryEditor
                    value={decoded.filter}
                    onChange={handleQueryChange}
                    onExecute={handleExecute}
                    driver={driver}
                    schema={schema}
                    placeholder={placeholder}
                    selectedCollection={isMongo ? selectedCollection : undefined}
                />
            </div>

            {/* ── Results ── */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                {result ? (
                    <ResultsTable
                        result={result}
                        loading={loading}
                        isCached={isCached}
                        onFetchMore={onFetchMore}
                        onApplyMutations={onApplyMutations}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
                        <div className="text-center">
                            <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none">
                                <path d="M3 3h18v18H3V3z" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M3 9h18M9 9v12" stroke="currentColor" strokeWidth="1.2" />
                            </svg>
                            {isMongo ? (
                                <p>Write a filter like <code className="px-1.5 py-0.5 bg-elevated rounded text-xs border border-border-subtle font-mono">{'{ status: "active" }'}</code> and press <kbd className="px-1.5 py-0.5 bg-elevated rounded text-xs border border-border-subtle font-mono">⌘ Enter</kbd></p>
                            ) : (
                                <p>Write a query and press <kbd className="px-1.5 py-0.5 bg-elevated rounded text-xs border border-border-subtle font-mono">⌘ Enter</kbd> to run</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
