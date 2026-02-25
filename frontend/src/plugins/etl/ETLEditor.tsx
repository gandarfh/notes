import { useState, useCallback, useEffect } from 'react'
import type { LocalDatabase } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { Select } from '../chart/Select'
import { ETLTransformStep } from './ETLTransformStep'
import { CronBuilder } from './CronBuilder'
import type { TransformStage } from './ETLPipeline'
import type { SourceSpec, SyncJob, TransformConfig } from './index'

// ── Props ──────────────────────────────────────────────────

interface DatabaseBlockOption {
    blockId: string
    connectionId: string
    query: string
    label: string
}

interface HTTPBlockOption {
    blockId: string
    method: string
    url: string
    label: string
}

interface ETLEditorProps {
    existingJob: SyncJob | null
    sources: SourceSpec[]
    databases: LocalDatabase[]
    pageId: string
    onSave: (job: SyncJob) => void
    onCancel: () => void
}

// ── Steps ──────────────────────────────────────────────────

const STEPS = [
    { key: 1, label: 'Source' },
    { key: 2, label: 'Transform' },
    { key: 3, label: 'Target' },
] as const

// ── Component ──────────────────────────────────────────────

export function ETLEditor({ existingJob, sources, databases, pageId, onSave, onCancel }: ETLEditorProps) {
    const [step, setStep] = useState(1)

    const [name, setName] = useState(existingJob?.name || '')
    const [sourceType, setSourceType] = useState(existingJob?.sourceType || '')
    const [sourceConfig, setSourceConfig] = useState<Record<string, any>>(existingJob?.sourceConfig || {})
    const [targetDbId, setTargetDbId] = useState(existingJob?.targetDbId || '')
    const [syncMode, setSyncMode] = useState(existingJob?.syncMode || 'replace')
    const [dedupeKey, setDedupeKey] = useState(existingJob?.dedupeKey || '')
    const [triggerType, setTriggerType] = useState(existingJob?.triggerType || 'manual')
    const [triggerConfig, setTriggerConfig] = useState(existingJob?.triggerConfig || '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [transforms, setTransforms] = useState<TransformStage[]>(
        (existingJob?.transforms || []).map((t: any) => ({ type: t.type, config: t.config || {} }))
    )

    // Database blocks on this page
    const [dbBlocks, setDbBlocks] = useState<DatabaseBlockOption[]>([])
    const [httpBlocks, setHttpBlocks] = useState<HTTPBlockOption[]>([])

    const selectedSource = sources.find(s => s.type === sourceType)

    useEffect(() => {
        if (sourceType === 'database' && pageId) {
            api.listPageDatabaseBlocks(pageId).then(blocks => {
                const b = (blocks || []).map((bk: any) => ({
                    blockId: bk.blockId,
                    connectionId: bk.connectionId,
                    query: bk.query,
                    label: bk.label || bk.blockId,
                }))
                setDbBlocks(b)
            }).catch(() => setDbBlocks([]))
        }
        if (sourceType === 'http' && pageId) {
            api.listPageHTTPBlocks(pageId).then(blocks => {
                const b = (blocks || []).map((bk: any) => ({
                    blockId: bk.blockId,
                    method: bk.method,
                    url: bk.url,
                    label: bk.label || bk.blockId,
                }))
                setHttpBlocks(b)
            }).catch(() => setHttpBlocks([]))
        }
    }, [sourceType, pageId])

    const handleSourceConfigChange = useCallback((key: string, value: string) => {
        setSourceConfig(prev => ({ ...prev, [key]: value }))
    }, [])

    const handleBrowseFile = useCallback(async (fieldKey: string) => {
        try {
            const path = await api.pickETLFile()
            if (path) {
                setSourceConfig(prev => ({ ...prev, [fieldKey]: path }))
            }
        } catch (err) {
            console.error('File picker error:', err)
        }
    }, [])

    const handleSave = useCallback(async () => {
        if (!sourceType || !targetDbId) {
            setError('Source type and target database are required')
            return
        }

        setSaving(true)
        setError('')
        try {
            const input = {
                name: name || `${selectedSource?.label || sourceType} → ${databases.find(d => d.id === targetDbId)?.name || 'DB'}`,
                sourceType,
                sourceConfig,
                transforms: transforms as TransformConfig[],
                targetDbId,
                syncMode,
                dedupeKey,
                triggerType,
                triggerConfig: triggerType === 'file_watch' ? (sourceConfig.filePath || '') : triggerConfig,
            }

            let savedJob: SyncJob
            if (existingJob) {
                await api.updateETLJob(existingJob.id, input)
                savedJob = await api.getETLJob(existingJob.id)
            } else {
                savedJob = await api.createETLJob(input) as SyncJob
            }
            onSave(savedJob)
        } catch (err: any) {
            setError(err?.message || 'Failed to save')
        } finally {
            setSaving(false)
        }
    }, [name, sourceType, sourceConfig, transforms, targetDbId, syncMode, dedupeKey, triggerType, triggerConfig, existingJob, selectedSource, databases, onSave])

    // Options
    const dbOptions = databases.map(d => ({ value: d.id, label: d.name || d.id }))
    const dbBlockOptions = dbBlocks.map(b => ({
        value: b.blockId,
        label: b.label,
    }))
    const syncModeOptions = [
        { value: 'replace', label: 'Replace (full refresh)' },
        { value: 'append', label: 'Append (add new)' },
    ]
    const isFileSource = sourceType === 'csv_file' || sourceType === 'json_file'
    const triggerOptionsBase = [
        { value: 'manual', label: 'Manual' },
        { value: 'schedule', label: 'Schedule (cron)' },
    ]
    const triggerOptionsFile = [
        ...triggerOptionsBase,
        { value: 'file_watch', label: 'File watch' },
    ]

    // Step navigation
    const canAdvanceFromSource = !!sourceType
    const goNext = () => { setError(''); setStep(s => Math.min(s + 1, 3)) }
    const goBack = () => { setError(''); setStep(s => Math.max(s - 1, 1)) }

    // Render a config field based on its type
    const renderConfigField = (field: SourceSpec['configFields'][0]) => {
        if (field.type === 'file') {
            return (
                <div className="pl-inline">
                    <input
                        className="pl-input"
                        style={{ flex: 1 }}
                        value={sourceConfig[field.key] || ''}
                        onChange={e => handleSourceConfigChange(field.key, e.target.value)}
                        placeholder={field.placeholder || ''}
                        readOnly
                    />
                    <button className="chart-toolbar-btn" onClick={() => handleBrowseFile(field.key)}>Browse…</button>
                </div>
            )
        }

        if (field.type === 'select' || field.type === 'db_block' || field.type === 'http_block') {
            let optionsToUse: { value: string; label: string }[]
            if (field.type === 'db_block') {
                optionsToUse = dbBlockOptions
            } else if (field.type === 'http_block') {
                optionsToUse = httpBlocks.map(b => ({ value: b.blockId, label: b.label }))
            } else {
                optionsToUse = (field.options || []).map(o => ({ value: o, label: o }))
            }
            return (
                <Select
                    value={sourceConfig[field.key] || ''}
                    options={optionsToUse}
                    placeholder={field.placeholder || `Select ${field.label}…`}
                    onChange={v => handleSourceConfigChange(field.key, v)}
                />
            )
        }

        if (field.type === 'textarea') {
            return (
                <textarea
                    className="pl-input pl-input-full"
                    value={sourceConfig[field.key] || ''}
                    onChange={e => handleSourceConfigChange(field.key, e.target.value)}
                    placeholder={field.placeholder || ''}
                    rows={3}
                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
                />
            )
        }

        return (
            <input
                className={`pl-input pl-input-full`}
                type={field.type === 'password' ? 'password' : 'text'}
                value={sourceConfig[field.key] || ''}
                onChange={e => handleSourceConfigChange(field.key, e.target.value)}
                placeholder={field.placeholder || ''}
            />
        )
    }

    return (
        <div className="pl-editor">
            {/* Step indicator */}
            <div className="etl-step-bar">
                {STEPS.map((s, i) => (
                    <div key={s.key} className={`etl-step-item ${step === s.key ? 'active' : ''} ${step > s.key ? 'done' : ''}`}>
                        <div className="etl-step-dot">{step > s.key ? '✓' : s.key}</div>
                        <span className="etl-step-label">{s.label}</span>
                        {i < STEPS.length - 1 && <div className="etl-step-line" />}
                    </div>
                ))}
            </div>

            {/* ── Step 1: Source ── */}
            {step === 1 && (
                <>
                    <div className="pl-stage">
                        <div className="pl-stage-header">
                            <span className="pl-stage-label">Name</span>
                        </div>
                        <div className="pl-stage-body">
                            <input
                                className="pl-input pl-input-full"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="My data sync…"
                            />
                        </div>
                    </div>

                    <div className="pl-stage">
                        <div className="pl-stage-header">
                            <span className="pl-stage-label">Source</span>
                        </div>
                        <div className="pl-stage-body">
                            <div className="pl-chips">
                                {sources.map(s => (
                                    <button
                                        key={s.type}
                                        className={`pl-chip ${sourceType === s.type ? 'active' : ''}`}
                                        onClick={() => { setSourceType(s.type); setSourceConfig({}); if (triggerType === 'file_watch') setTriggerType('manual') }}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {selectedSource && selectedSource.configFields.length > 0 && (
                        <div className="pl-stage">
                            <div className="pl-stage-header">
                                <span className="pl-stage-label">Configure</span>
                            </div>
                            <div className="pl-stage-body">
                                {selectedSource.configFields
                                    .filter(field => {
                                        // Hide manual URL/method/headers/body when an HTTP block is selected
                                        if (sourceType === 'http' && sourceConfig.blockId) {
                                            return field.key === 'blockId' || field.key === 'dataPath'
                                        }
                                        return true
                                    })
                                    .map(field => (
                                        <div key={field.key} className="pl-field">
                                            <label className="pl-label">
                                                {field.label}
                                                {field.required && <span style={{ color: 'var(--color-danger, #ef4444)', marginLeft: 2 }}>*</span>}
                                            </label>
                                            {renderConfigField(field)}
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}

                    <div className="etl-step-nav">
                        {existingJob && (
                            <button className="chart-toolbar-btn" onClick={onCancel}>Cancel</button>
                        )}
                        <div style={{ flex: 1 }} />
                        <button
                            className="chart-toolbar-btn active"
                            disabled={!canAdvanceFromSource}
                            onClick={goNext}
                        >
                            Next →
                        </button>
                    </div>
                </>
            )}

            {/* ── Step 2: Transform ── */}
            {step === 2 && (
                <>
                    <ETLTransformStep
                        sourceType={sourceType}
                        sourceConfig={sourceConfig}
                        transforms={transforms}
                        onChange={setTransforms}
                    />

                    <div className="etl-step-nav">
                        <button className="chart-toolbar-btn" onClick={goBack}>← Back</button>
                        <div style={{ flex: 1 }} />
                        <button className="chart-toolbar-btn active" onClick={goNext}>
                            Next →
                        </button>
                    </div>
                </>
            )}

            {/* ── Step 3: Target + Settings ── */}
            {step === 3 && (
                <>
                    <div className="pl-stage">
                        <div className="pl-stage-header">
                            <span className="pl-stage-label">Target</span>
                        </div>
                        <div className="pl-stage-body">
                            <Select
                                value={targetDbId}
                                options={dbOptions}
                                placeholder="Select target database…"
                                onChange={v => setTargetDbId(v)}
                                className="pl-sel--full"
                            />
                        </div>
                    </div>

                    <div className="pl-stage">
                        <div className="pl-stage-header">
                            <span className="pl-stage-label">Settings</span>
                        </div>
                        <div className="pl-stage-body">
                            <div className="pl-field">
                                <label className="pl-label">Sync Mode</label>
                                <Select
                                    value={syncMode}
                                    options={syncModeOptions}
                                    onChange={v => setSyncMode(v)}
                                />
                            </div>
                            {syncMode === 'append' && (
                                <div className="pl-field">
                                    <label className="pl-label">Dedupe Key</label>
                                    <input
                                        className="pl-input pl-input-full"
                                        value={dedupeKey}
                                        onChange={e => setDedupeKey(e.target.value)}
                                        placeholder="Column to deduplicate…"
                                    />
                                </div>
                            )}
                            <div className="pl-field">
                                <label className="pl-label">Trigger</label>
                                <div className="pl-inline">
                                    <Select
                                        value={triggerType}
                                        options={isFileSource ? triggerOptionsFile : triggerOptionsBase}
                                        onChange={v => {
                                            setTriggerType(v)
                                            if (v === 'file_watch') {
                                                setTriggerConfig(sourceConfig.filePath || '')
                                            }
                                        }}
                                    />
                                    {triggerType === 'file_watch' && (
                                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                                            watching: {(sourceConfig.filePath || '').split('/').pop() || 'source file'}
                                        </span>
                                    )}
                                </div>
                                {triggerType === 'schedule' && (
                                    <CronBuilder value={triggerConfig} onChange={setTriggerConfig} />
                                )}
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="pl-stage" style={{ borderColor: 'var(--color-danger, #ef4444)' }}>
                            <div className="pl-stage-body" style={{ color: 'var(--color-danger, #ef4444)', fontSize: 11 }}>
                                {error}
                            </div>
                        </div>
                    )}

                    <div className="etl-step-nav">
                        <button className="chart-toolbar-btn" onClick={goBack}>← Back</button>
                        <div style={{ flex: 1 }} />
                        <button
                            className="chart-toolbar-btn active"
                            onClick={handleSave}
                            disabled={saving}
                            style={{ opacity: saving ? 0.5 : 1 }}
                        >
                            {saving ? 'Saving…' : existingJob ? 'Update' : 'Create'}
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}
