import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../store'
import './RecordingIndicator.css'

function formatElapsed(startedAt: string): string {
    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    const h = Math.floor(elapsed / 3600)
    const m = Math.floor((elapsed % 3600) / 60)
    const s = elapsed % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const MicIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="1" width="6" height="9" rx="3" />
        <path d="M3 7a5 5 0 0 0 10 0" />
        <line x1="8" y1="12" x2="8" y2="15" />
        <line x1="5.5" y1="15" x2="10.5" y2="15" />
    </svg>
)

const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7.5l3 3 5-6" />
    </svg>
)

export function RecordingIndicator() {
    const active = useAppStore(s => s.recordingActive)
    const title = useAppStore(s => s.recordingTitle)
    const startedAt = useAppStore(s => s.recordingStartedAt)
    const error = useAppStore(s => s.recordingError)
    const fileSizeMb = useAppStore(s => s.recordingFileSizeMb)
    const audioLevel = useAppStore(s => s.recordingAudioLevel)
    const completedTitle = useAppStore(s => s.recordingCompletedTitle)
    const showStartForm = useAppStore(s => s.showRecordingForm)
    const openForm = useAppStore(s => s.openRecordingForm)
    const closeForm = useAppStore(s => s.closeRecordingForm)
    const startRecording = useAppStore(s => s.startRecording)
    const stopRecording = useAppStore(s => s.stopRecording)
    const pollRecordingStatus = useAppStore(s => s.pollRecordingStatus)
    const dismissCompleted = useAppStore(s => s.dismissCompleted)
    const processingStatus = useAppStore(s => s.processingStatus)
    const processingTitle = useAppStore(s => s.processingTitle)

    const [elapsed, setElapsed] = useState('')
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [formTitle, setFormTitle] = useState('')
    const [formParticipants, setFormParticipants] = useState('')
    const titleInputRef = useRef<HTMLInputElement>(null)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const completedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Timer: update elapsed every second
    useEffect(() => {
        if (active && startedAt) {
            setElapsed(formatElapsed(startedAt))
            timerRef.current = setInterval(() => {
                setElapsed(formatElapsed(startedAt))
            }, 1000)
        } else {
            setElapsed('')
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [active, startedAt])

    // Poll recording status every 2s for audio levels and file size
    useEffect(() => {
        if (active) {
            pollRef.current = setInterval(() => {
                pollRecordingStatus()
            }, 2000)
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [active, pollRecordingStatus])

    // Auto-dismiss completed state after 10s
    useEffect(() => {
        if (completedTitle) {
            completedTimerRef.current = setTimeout(() => {
                dismissCompleted()
            }, 10000)
        }
        return () => {
            if (completedTimerRef.current) clearTimeout(completedTimerRef.current)
        }
    }, [completedTitle, dismissCompleted])

    // Focus title input when start form opens
    useEffect(() => {
        if (showStartForm) {
            setTimeout(() => titleInputRef.current?.focus(), 50)
        }
    }, [showStartForm])

    const handleStart = useCallback(async () => {
        const t = formTitle.trim()
        if (!t) return
        const participants = formParticipants
            .split(',')
            .map(p => p.trim())
            .filter(Boolean)
        closeForm()
        setFormTitle('')
        setFormParticipants('')
        await startRecording(t, participants)
    }, [formTitle, formParticipants, startRecording, closeForm])

    const handleStop = useCallback(async () => {
        setDropdownOpen(false)
        await stopRecording()
    }, [stopRecording])

    const closeAll = useCallback(() => {
        setDropdownOpen(false)
        closeForm()
    }, [closeForm])

    // ── Start form (not recording) ──────────────────────────

    if (showStartForm && !active) {
        return (
            <>
                <div className="rec-backdrop" onClick={closeAll} />
                <div className="rec-start-wrapper">
                    <button className="rec-start-btn rec-start-btn--active" title="Gravação de reunião">
                        <MicIcon />
                    </button>
                    <div className="rec-dropdown">
                        <div className="rec-dropdown__title">Nova Gravação</div>
                        <input
                            ref={titleInputRef}
                            className="rec-input"
                            placeholder="Título da reunião"
                            value={formTitle}
                            onChange={e => setFormTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') closeAll() }}
                        />
                        <input
                            className="rec-input"
                            placeholder="Participantes (separados por vírgula)"
                            value={formParticipants}
                            onChange={e => setFormParticipants(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') closeAll() }}
                        />
                        <button
                            className="rec-action-btn"
                            onClick={handleStart}
                            disabled={!formTitle.trim()}
                        >
                            <MicIcon />
                            Iniciar Gravação
                        </button>
                    </div>
                </div>
            </>
        )
    }

    // ── Processing state (transcribing/analyzing) ─────────

    if (processingStatus && !active) {
        const labels: Record<string, string> = {
            transcribing: `Transcrevendo "${processingTitle}"...`,
            analyzing: `Analisando "${processingTitle}"...`,
            generating: `Gerando página "${processingTitle}"...`,
        }
        const label = labels[processingStatus] || `Processando "${processingTitle}"...`
        return (
            <div className="rec-indicator rec-indicator--processing" title={label}>
                <div className="rec-dot rec-dot--processing" />
                <span>{label}</span>
            </div>
        )
    }

    // ── Completed state (auto-dismiss after 10s) ────────────

    if (completedTitle && !active) {
        return (
            <div
                className="rec-indicator rec-indicator--completed"
                onClick={dismissCompleted}
                title="Gravação finalizada (clique para dispensar)"
            >
                <CheckIcon />
                <span>{completedTitle} salva</span>
            </div>
        )
    }

    // ── Error state (not recording) ─────────────────────────

    if (error && !active) {
        return (
            <div className="rec-indicator rec-indicator--error" title={error} onClick={() => useAppStore.setState({ recordingError: null })}>
                <div className="rec-dot rec-dot--error" />
                <span>Erro</span>
            </div>
        )
    }

    // ── Inactive — show mic button ──────────────────────────

    if (!active) {
        return (
            <button
                className="rec-start-btn"
                title="Iniciar gravação de reunião"
                onClick={openForm}
            >
                <MicIcon />
            </button>
        )
    }

    // ── Recording active ────────────────────────────────────

    return (
        <>
            <div
                className="rec-indicator rec-indicator--recording"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                title={`Gravando: ${title}`}
            >
                <div className="rec-dot rec-dot--recording" />
                <span>REC</span>
                <span className="rec-timer">{elapsed}</span>
            </div>

            {dropdownOpen && (
                <>
                    <div className="rec-backdrop" onClick={closeAll} />
                    <div className="rec-dropdown">
                        <div className="rec-dropdown__title">{title}</div>
                        <div className="rec-dropdown__subtitle">Gravando há {elapsed}</div>

                        <div className="rec-level">
                            <span>Mic</span>
                            <div className="rec-level__bar">
                                <div
                                    className="rec-level__fill"
                                    style={{ width: `${Math.round(audioLevel * 100)}%` }}
                                />
                            </div>
                        </div>

                        <div className="rec-dropdown__info">
                            Tamanho: {fileSizeMb.toFixed(1)} MB
                        </div>

                        <button className="rec-stop-btn" onClick={handleStop}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                <rect x="2" y="2" width="8" height="8" rx="1" />
                            </svg>
                            Parar Gravação
                        </button>
                    </div>
                </>
            )}
        </>
    )
}
