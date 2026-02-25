import { useState, useCallback, useEffect } from 'react'
import type { LocalDatabase } from '../../bridge/wails'
import { api } from '../../bridge/wails'
import { Select } from '../chart/Select'
import { ETLPipeline, type TransformStage } from './ETLPipeline'
import type { SourceSpec, SyncJob, TransformConfig } from './index'

// ── Props ──────────────────────────────────────────────────

interface DatabaseBlockOption {
    blockId: string
    connectionId: string
    query: string
}

interface ETLEditorProps {
    existingJob: SyncJob | null
    sources: SourceSpec[]
    databases: LocalDatabase[]
    pageId: string
    onSave: (job: SyncJob) => void
    onCancel: () => void
}

// ── Component ──────────────────────────────────────────────

export function ETLEditor({ existingJob, sources, databases, pageId, onSave, onCancel }: ETLEditorProps) {
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

    // Database blocks on this page (loaded when database source is selected)
    const [dbBlocks, setDbBlocks] = useState<DatabaseBlockOption[]>([])

    const selectedSource = sources.find(s => s.type === sourceType)

    // Load database blocks when "database" source is selected
    useEffect(() => {
        if (sourceType === 'database' && pageId) {
            api.listPageDatabaseBlocks(pageId).then(blocks => {
                setDbBlocks((blocks || []).map((b: any) => ({
                    blockId: b.blockId,
                    connectionId: b.connectionId,
                    query: b.query,
                })))
            }).catch(() => setDbBlocks([]))
        }
    }, [sourceType, pageId])

    const handleSourceConfigChange = useCallback((key: string, value: string) => {
        setSourceConfig(prev => ({ ...prev, [key]: value }))
    }, [])

    // Native file picker for "file" type fields
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
                savedJob = await api.createETLJob(input)
            }
            onSave(savedJob)
        } catch (err: any) {
            setError(err.message || 'Failed to save')
        } finally {
            setSaving(false)
        }
    }, [name, sourceType, sourceConfig, targetDbId, syncMode, dedupeKey, triggerType, triggerConfig, transforms, existingJob, onSave, selectedSource, databases])

    // Build options for Select component (same pattern as NotebookEditor)
    const dbOptions = databases.map(d => ({ value: d.id, label: d.name }))
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

    // Render a config field based on its type
    const renderConfigField = (field: SourceSpec['configFields'][0]) => {
        if (field.type === 'file') {
            // File picker: input + Browse button
            const filePath = (sourceConfig[field.key] as string) || ''
            const fileName = filePath ? filePath.split('/').pop() : ''
            return (
                <div className="pl-inline" style={{ gap: 4 }}>
                    <input
                        className="pl-input"
                        style={{ flex: 1, opacity: fileName ? 1 : 0.5 }}
                        value={fileName || ''}
                        placeholder="No file selected"
                        readOnly
                        title={filePath}
                    />
                    <button
                        className="chart-toolbar-btn"
                        onClick={() => handleBrowseFile(field.key)}
                        type="button"
                    >Browse…</button>
                </div>
            )
        }

        if (field.type === 'db_block') {
            // Database block selector
            const blockOptions = dbBlocks.map(b => ({
                value: b.blockId,
                label: b.query ? `${b.query.substring(0, 40)}${b.query.length > 40 ? '…' : ''}` : `Block ${b.blockId.substring(0, 8)}`,
            }))

            if (blockOptions.length === 0) {
                return (
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        No database blocks on this page. Add a Database block first.
                    </span>
                )
            }

            return (
                <Select
                    value={(sourceConfig[field.key] as string) || ''}
                    options={blockOptions}
                    placeholder="Select a database block…"
                    onChange={v => handleSourceConfigChange(field.key, v)}
                    className="pl-sel--full"
                />
            )
        }

        if (field.type === 'select') {
            return (
                <Select
                    value={(sourceConfig[field.key] as string) || field.default || ''}
                    options={(field.options || []).map(o => ({ value: o, label: o }))}
                    placeholder={field.help || 'Select…'}
                    onChange={v => handleSourceConfigChange(field.key, v)}
                />
            )
        }

        if (field.type === 'textarea') {
            return (
                <textarea
                    className="pl-input pl-input-full"
                    value={(sourceConfig[field.key] as string) || ''}
                    onChange={e => handleSourceConfigChange(field.key, e.target.value)}
                    placeholder={field.help}
                    rows={3}
                    style={{ resize: 'vertical', minHeight: 50 }}
                />
            )
        }

        return (
            <input
                className="pl-input pl-input-full"
                type={field.type === 'password' ? 'password' : 'text'}
                value={(sourceConfig[field.key] as string) || ''}
                onChange={e => handleSourceConfigChange(field.key, e.target.value)}
                placeholder={field.help}
            />
        )
    }

    return (
        <div className="pl-editor">
            {/* Name */}
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

            {/* Source type */}
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

            {/* Source config fields */}
            {selectedSource && selectedSource.configFields.length > 0 && (
                <div className="pl-stage">
                    <div className="pl-stage-header">
                        <span className="pl-stage-label">Configure</span>
                    </div>
                    <div className="pl-stage-body">
                        {selectedSource.configFields.map(field => (
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

            {/* Transform Pipeline */}
            {sourceType && (
                <ETLPipeline
                    stages={transforms}
                    sourceType={sourceType}
                    sourceConfig={sourceConfig}
                    onChange={setTransforms}
                />
            )}

            {/* Target */}
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

            {/* Sync mode + trigger */}
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
                                    // Auto-set file_watch config from source filePath
                                    if (v === 'file_watch') {
                                        setTriggerConfig(sourceConfig.filePath || '')
                                    }
                                }}
                            />
                            {triggerType === 'schedule' && (
                                <input
                                    className="pl-input"
                                    value={triggerConfig}
                                    onChange={e => setTriggerConfig(e.target.value)}
                                    placeholder="0 */6 * * *"
                                />
                            )}
                            {triggerType === 'file_watch' && (
                                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                                    watching: {(sourceConfig.filePath || '').split('/').pop() || 'source file'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="pl-stage" style={{ borderColor: 'var(--color-danger, #ef4444)' }}>
                    <div className="pl-stage-body" style={{ color: 'var(--color-danger, #ef4444)', fontSize: 11 }}>
                        {error}
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="pl-add-wrap" style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                {existingJob && (
                    <button className="chart-toolbar-btn" onClick={onCancel}>Cancel</button>
                )}
                <button
                    className="chart-toolbar-btn active"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ opacity: saving ? 0.5 : 1 }}
                >
                    {saving ? 'Saving…' : existingJob ? 'Update' : 'Create'}
                </button>
            </div>
        </div>
    )
}
