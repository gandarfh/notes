import './etl.css'
import { useState, useCallback, useEffect, useMemo } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import type { LocalDatabase } from './types'
import { ETLEditor } from './ETLEditor'

// ── Block Config ───────────────────────────────────────────

interface ETLBlockConfig {
    jobId: string
    title: string
}

function parseConfig(content: string): ETLBlockConfig {
    try {
        return { title: 'Data Sync', jobId: '', ...JSON.parse(content || '{}') }
    } catch {
        return { title: 'Data Sync', jobId: '' }
    }
}

// ── Types (mirrors Go backend) ─────────────────────────────

export interface SourceSpec {
    type: string
    label: string
    icon: string
    configFields: ConfigField[]
}

export interface ConfigField {
    key: string
    label: string
    type: string
    required: boolean
    options?: string[]
    default?: string
    help?: string
    placeholder?: string
}

export interface SyncJob {
    id: string
    name: string
    sourceType: string
    sourceConfig: Record<string, any>
    transforms: TransformConfig[]
    targetDbId: string
    syncMode: string
    dedupeKey: string
    triggerType: string
    triggerConfig: string
    enabled: boolean
    lastRunAt: string
    lastStatus: string
    lastError: string
    createdAt: string
    updatedAt: string
}

export interface TransformConfig {
    type: string
    config: Record<string, any>
}

export interface SyncResult {
    jobId: string
    status: string
    rowsRead: number
    rowsWritten: number
    duration: number
    error?: string
}

export interface SyncRunLog {
    id: string
    jobId: string
    startedAt: string
    finishedAt: string
    status: string
    rowsRead: number
    rowsWritten: number
    error?: string
}

// ── Block Renderer ─────────────────────────────────────────

function ETLBlockRenderer({ block, ctx }: BlockRendererProps) {
    const rpc = ctx!.rpc
    const config = useMemo(() => parseConfig(block.content), [block.content])

    const [job, setJob] = useState<SyncJob | null>(null)
    const [sources, setSources] = useState<SourceSpec[]>([])
    const [databases, setDatabases] = useState<LocalDatabase[]>([])
    const [logs, setLogs] = useState<SyncRunLog[]>([])
    const [showEditor, setShowEditor] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const [running, setRunning] = useState(false)
    const [lastResult, setLastResult] = useState<SyncResult | null>(null)
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState('')

    const persist = useCallback((next: ETLBlockConfig) => {
        ctx!.storage.setContent(JSON.stringify(next))
    }, [ctx])

    // Load data on mount.
    useEffect(() => {
        rpc.call<SourceSpec[]>('ListETLSources').then(setSources).catch(console.error)
        rpc.call<LocalDatabase[]>('ListLocalDatabases').then(setDatabases).catch(console.error)
        if (config.jobId) {
            rpc.call<SyncJob>('GetETLJob', config.jobId).then(setJob).catch(() => setJob(null))
            rpc.call<SyncRunLog[]>('ListETLRunLogs', config.jobId).then(setLogs).catch(() => setLogs([]))
        }
    }, [config.jobId, rpc])

    const handleSave = useCallback((savedJob: SyncJob) => {
        setJob(savedJob)
        setShowEditor(false)
        persist({ ...config, jobId: savedJob.id })
    }, [persist, config])

    const handleRun = useCallback(async () => {
        if (!job) return
        setRunning(true)
        setLastResult(null)
        try {
            const result = await rpc.call<SyncResult>('RunETLJob', job.id)
            setLastResult(result)
            const updated = await rpc.call<SyncJob>('GetETLJob', job.id)
            setJob(updated)
            // Refresh logs.
            rpc.call<SyncRunLog[]>('ListETLRunLogs', job.id).then(setLogs).catch(() => { })
            // Notify other plugins
            ctx!.events.emit('etl:job-completed', { jobId: job.id, status: result.status })
        } catch (err: any) {
            setLastResult({ jobId: job.id, status: 'error', rowsRead: 0, rowsWritten: 0, duration: 0, error: err.message })
        } finally {
            setRunning(false)
        }
    }, [job, rpc, ctx])

    const handleTitleSubmit = () => {
        setEditingTitle(false)
        if (titleValue.trim() && titleValue !== config.title) {
            persist({ ...config, title: titleValue.trim() })
        }
    }

    const sourceSpec = sources.find(s => s.type === job?.sourceType)
    const targetDB = databases.find(d => d.id === job?.targetDbId)

    return (
        <div className="etl-block" onMouseDown={e => e.stopPropagation()}>
            {/* Header — same pattern as chart-header */}
            <div className="etl-header">
                <div className="etl-header-left">
                    {editingTitle ? (
                        <input
                            className="etl-title-input"
                            value={titleValue}
                            onChange={e => setTitleValue(e.target.value)}
                            onBlur={handleTitleSubmit}
                            onKeyDown={e => { if (e.key === 'Enter') handleTitleSubmit(); if (e.key === 'Escape') { setEditingTitle(false); setTitleValue(config.title) } }}
                            autoFocus
                        />
                    ) : (
                        <span className="etl-title" onDoubleClick={() => { setEditingTitle(true); setTitleValue(config.title) }}>
                            {config.title}
                        </span>
                    )}
                    {job && (
                        <span className={`etl-status-dot ${job.lastStatus || 'idle'}`} title={job.lastStatus || 'not run'} />
                    )}
                    {sourceSpec && (
                        <span className="etl-type-badge">{sourceSpec.label}</span>
                    )}
                </div>
                <div className="etl-header-right">
                    <button
                        className={`chart-toolbar-btn ${running ? 'active' : ''}`}
                        onClick={handleRun}
                        disabled={running || !job}
                        title="Run sync now"
                    >{running ? '⟳' : '▶ Run'}</button>
                    <button
                        className={`chart-toolbar-btn ${showHistory ? 'active' : ''}`}
                        onClick={() => { setShowHistory(!showHistory); setShowEditor(false) }}
                    >History</button>
                    <button
                        className={`chart-toolbar-btn ${showEditor ? 'active' : ''}`}
                        onClick={() => { setShowEditor(!showEditor); setShowHistory(false) }}
                    >{job ? 'Edit' : 'Setup'}</button>
                </div>
            </div>

            {/* Editor panel — reuses chart-block's pl-* classes */}
            {showEditor && (
                <ETLEditor
                    existingJob={job}
                    sources={sources}
                    databases={databases}
                    pageId={block.pageId}
                    onSave={handleSave}
                    onCancel={() => { if (job) setShowEditor(false) }}
                />
            )}

            {/* History panel */}
            {showHistory && (
                <div className="etl-history">
                    {logs.length === 0 ? (
                        <div className="etl-history-empty">No runs yet</div>
                    ) : logs.slice(0, 10).map(log => (
                        <div key={log.id} className="etl-history-row">
                            <span className={`etl-history-status ${log.status}`}>
                                {log.status === 'success' ? '✓' : '✗'}
                            </span>
                            <span className="etl-history-stats">
                                {log.rowsWritten} rows
                            </span>
                            <span className="etl-history-time">
                                {new Date(log.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {log.error && <span className="etl-history-error" title={log.error}>error</span>}
                        </div>
                    ))}
                </div>
            )}

            {/* Main content area — compact pipeline visualization */}
            <div className="etl-area">
                {lastResult && (
                    <div className={`etl-toast ${lastResult.status}`}>
                        {lastResult.status === 'success'
                            ? `✓ Synced ${lastResult.rowsWritten} rows (${(lastResult.duration / 1e6).toFixed(0)}ms)`
                            : `✗ ${lastResult.error}`
                        }
                    </div>
                )}

                {!job ? (
                    <div className="etl-empty-state">
                        <div className="etl-empty-icon">
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                                <rect x="4" y="4" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
                                <rect x="18" y="18" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
                                <path d="M14 9h4l-2 4 2 4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
                            </svg>
                        </div>
                        <span className="etl-empty-label">Click <strong>Setup</strong> to configure your data pipeline</span>
                    </div>
                ) : (
                    <>
                        {/* Horizontal flow: Source → Transforms → Target */}
                        <div className="etl-flow">
                            {/* Source pill */}
                            <div className="etl-flow-node etl-flow-source">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="etl-flow-icon">
                                    <ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.2" />
                                    <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth="1.2" />
                                    <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.2" />
                                </svg>
                                <span className="etl-flow-text">{sourceSpec?.label || job.sourceType}</span>
                            </div>

                            <span className="etl-flow-arrow">→</span>

                            {/* Transform pills */}
                            {job.transforms && job.transforms.length > 0 ? (
                                <>
                                    <div className="etl-flow-transforms">
                                        {job.transforms.map((t: any, i: number) => (
                                            <span key={i} className="etl-flow-transform">{t.type}</span>
                                        ))}
                                    </div>
                                    <span className="etl-flow-arrow">→</span>
                                </>
                            ) : null}

                            {/* Target pill */}
                            <div className="etl-flow-node etl-flow-target">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="etl-flow-icon">
                                    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
                                    <line x1="2" y1="5.5" x2="14" y2="5.5" stroke="currentColor" strokeWidth="0.8" />
                                    <line x1="2" y1="9" x2="14" y2="9" stroke="currentColor" strokeWidth="0.8" />
                                    <line x1="7" y1="2" x2="7" y2="14" stroke="currentColor" strokeWidth="0.8" />
                                </svg>
                                <span className="etl-flow-text">{targetDB?.name || 'Unknown'}</span>
                            </div>
                        </div>

                        {/* Stats footer */}
                        {job.lastStatus && (
                            <div className="etl-stats">
                                <span className={`etl-stats-status etl-stat-${job.lastStatus}`}>
                                    {job.lastStatus === 'success' ? '●' : job.lastStatus === 'running' ? '◌' : '●'}
                                    {' '}{job.lastStatus === 'success' ? 'Synced' : job.lastStatus === 'running' ? 'Running' : 'Error'}
                                </span>
                                <span className="etl-stats-detail">
                                    {job.syncMode}
                                    {job.transforms && job.transforms.length > 0 && ` · ${job.transforms.length} transform${job.transforms.length > 1 ? 's' : ''}`}
                                </span>
                                {job.lastRunAt && job.lastRunAt !== '0001-01-01T00:00:00Z' && (
                                    <span className="etl-stats-time">
                                        {new Date(job.lastRunAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

// ── Icon ───────────────────────────────────────────────────

function ETLIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
            <rect x="10" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
            <path d="M6 4.5h3M9 4.5L7.5 7 9 9.5H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

// ── Plugin ─────────────────────────────────────────────────

export const etlPlugin: BlockPlugin = {
    type: 'etl',
    label: 'ETL Sync',
    Icon: ETLIcon,
    defaultSize: { width: 460, height: 180 },
    Renderer: ETLBlockRenderer,
    headerLabel: 'ETL',
}
