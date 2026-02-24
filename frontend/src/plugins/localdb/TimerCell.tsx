import { useState, useEffect, useRef, useCallback } from 'react'

// ── Timer Cell ─────────────────────────────────────────────
// Persistent stopwatch that accumulates elapsed seconds.
// Timer value is stored as JSON: { "elapsed": 3600, "running": false, "startedAt": null }

export interface TimerValue {
    elapsed: number        // total accumulated seconds
    running: boolean
    startedAt: string | null  // ISO timestamp when last started
}

export const EMPTY_TIMER: TimerValue = { elapsed: 0, running: false, startedAt: null }

export function parseTimerValue(raw: unknown): TimerValue {
    if (!raw || typeof raw !== 'object') return { ...EMPTY_TIMER }
    const v = raw as Record<string, unknown>
    return {
        elapsed: typeof v.elapsed === 'number' ? v.elapsed : 0,
        running: typeof v.running === 'boolean' ? v.running : false,
        startedAt: typeof v.startedAt === 'string' ? v.startedAt : null,
    }
}

function formatDuration(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = Math.floor(totalSeconds % 60)
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
    return `${s}s`
}

export function TimerCell({ value, onChange }: {
    value: TimerValue
    onChange: (v: TimerValue) => void
}) {
    const [display, setDisplay] = useState('')
    const intervalRef = useRef<number | null>(null)

    const getElapsed = useCallback(() => {
        let total = value.elapsed
        if (value.running && value.startedAt) {
            total += (Date.now() - new Date(value.startedAt).getTime()) / 1000
        }
        return total
    }, [value])

    useEffect(() => {
        setDisplay(formatDuration(getElapsed()))

        if (value.running) {
            intervalRef.current = window.setInterval(() => {
                setDisplay(formatDuration(getElapsed()))
            }, 1000)
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [value, getElapsed])

    const toggle = () => {
        if (value.running) {
            // Stop: accumulate elapsed
            const now = Date.now()
            const extra = value.startedAt ? (now - new Date(value.startedAt).getTime()) / 1000 : 0
            onChange({
                elapsed: value.elapsed + extra,
                running: false,
                startedAt: null,
            })
        } else {
            // Start
            onChange({
                ...value,
                running: true,
                startedAt: new Date().toISOString(),
            })
        }
    }

    const reset = (e: React.MouseEvent) => {
        e.stopPropagation()
        onChange({ ...EMPTY_TIMER })
    }

    return (
        <div className="ldb-timer-cell">
            <button
                className={`ldb-timer-btn ${value.running ? 'running' : ''}`}
                onClick={toggle}
                title={value.running ? 'Stop' : 'Start'}
            >
                {value.running ? (
                    <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" /></svg>
                ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="2,1 9,5 2,9" fill="currentColor" /></svg>
                )}
            </button>
            <span className="ldb-timer-display">{display}</span>
            {value.elapsed > 0 && !value.running && (
                <button className="ldb-timer-reset" onClick={reset} title="Reset">
                    <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" /></svg>
                </button>
            )}
        </div>
    )
}
