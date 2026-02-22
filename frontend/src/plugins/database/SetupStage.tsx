import { useState } from 'react'
import type { DBConnView, CreateDBConnInput } from '../../bridge/wails'
import { api } from '../../bridge/wails'

interface SetupStageProps {
    connections: DBConnView[]
    onConnect: (connId: string) => void
    onRefreshConnections: () => void
}

const DRIVER_OPTIONS = [
    {
        value: 'sqlite', label: 'SQLite', icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 2.69 3 6s-1.34 6-3 6-3-2.69-3-6 1.34-6 3-6zm-7 6c0-.34.02-.67.06-1h3.38c-.03.33-.04.66-.04 1s.01.67.04 1H5.06c-.04-.33-.06-.66-.06-1zm14 0c0 .34-.02.67-.06 1h-3.38c.03-.33.04-.66.04-1s-.01-.67-.04-1h3.38c.04.33.06.66.06 1z" fill="#0F80CC" />
            </svg>
        ), defaultPort: 0
    },
    {
        value: 'mysql', label: 'MySQL', icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4z" fill="#00546B" opacity="0.15" />
                <path d="M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4z" fill="#00546B" />
                <path d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7" stroke="#00546B" strokeWidth="1.5" fill="none" />
                <path d="M4 12c0 2.21 3.58 4 8 4s8-1.79 8-4" stroke="#00546B" strokeWidth="1" opacity="0.5" fill="none" />
            </svg>
        ), defaultPort: 3306
    },
    {
        value: 'postgres', label: 'PostgreSQL', icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M17.128 2.014c-1.614-.05-3.022.458-4.128 1.236-1.106-.778-2.514-1.287-4.128-1.236C5.076 2.14 2 5.573 2 9.5c0 4.774 3.285 9.276 5.98 11.756.576.53 1.29.744 2.02.744.73 0 1.444-.214 2.02-.744C14.715 18.776 18 14.274 18 9.5c0-.464-.038-.917-.108-1.358.732-.41 1.37-.987 1.87-1.692C20.49 5.393 21 4.04 21 2.5l-1.5.5c-.347.116-.71.2-1.08.25.247-.374.448-.78.598-1.25l.11.014z" fill="#336791" />
                <circle cx="9" cy="9" r="1.5" fill="white" />
                <circle cx="15" cy="9" r="1.5" fill="white" />
            </svg>
        ), defaultPort: 5432
    },
    {
        value: 'mongodb', label: 'MongoDB', icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C12 2 8.5 7 8.5 12c0 3.5 1.5 6.5 3.5 8.5V22h.5c0 0 .5-1 .5-1.5V20.5c2-2 3.5-5 3.5-8.5C16.5 7 12 2 12 2z" fill="#00ED64" />
                <path d="M12 2C12 2 8.5 7 8.5 12c0 3.5 1.5 6.5 3.5 8.5V22" stroke="#00684A" strokeWidth="0.5" fill="none" />
            </svg>
        ), defaultPort: 27017
    },
]

export function SetupStage({ connections, onConnect, onRefreshConnections }: SetupStageProps) {
    const [mode, setMode] = useState<'choose' | 'create'>(connections.length > 0 ? 'choose' : 'create')
    const [testing, setTesting] = useState(false)
    const [error, setError] = useState('')

    const [form, setForm] = useState<CreateDBConnInput>({
        name: '', driver: 'sqlite', host: '', port: 0,
        database: '', username: '', password: '', sslMode: 'disable',
    })

    const handlePickFile = async () => {
        try {
            const path = await api.pickDatabaseFile()
            if (path) {
                setForm(f => ({
                    ...f,
                    host: path,
                    name: f.name || path.split('/').pop()?.replace(/\.(db|sqlite3?|s3db)$/, '') || 'SQLite DB',
                }))
            }
        } catch (e) {
            console.error('File picker error:', e)
        }
    }

    const handleCreate = async () => {
        if (!form.name.trim()) { setError('Connection name is required'); return }
        if (form.driver === 'sqlite' && !form.host.trim()) { setError('Select a database file'); return }
        if (form.driver !== 'sqlite' && !form.host.trim()) { setError('Host / connection string is required'); return }
        if (form.driver === 'mongodb' && !form.database.trim()) { setError('Database name is required for MongoDB'); return }

        setError('')
        setTesting(true)
        try {
            const conn = await api.createDatabaseConnection(form)
            await api.testDatabaseConnection(conn.id)
            onRefreshConnections()
            onConnect(conn.id)
        } catch (e: any) {
            setError(e.message || String(e))
        } finally {
            setTesting(false)
        }
    }

    const handleUseExisting = async (connId: string) => {
        setError('')
        setTesting(true)
        try {
            await api.testDatabaseConnection(connId)
            onConnect(connId)
        } catch (e: any) {
            setError(`Connection failed: ${e.message || e}`)
        } finally {
            setTesting(false)
        }
    }

    const driverInfo = DRIVER_OPTIONS.find(d => d.value === form.driver)

    return (
        <div className="flex flex-col h-full p-5 gap-4 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent-muted flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                        <ellipse cx="9" cy="5" rx="6" ry="2.5" stroke="var(--color-accent)" strokeWidth="1.3" />
                        <path d="M3 5v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke="var(--color-accent)" strokeWidth="1.3" />
                        <path d="M3 9c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="var(--color-accent)" strokeWidth="1.3" />
                    </svg>
                </div>
                <div>
                    <h3 className="text-text-primary font-semibold text-sm leading-tight">Database Connection</h3>
                    <p className="text-text-muted text-xs">Connect to a database to run queries</p>
                </div>
            </div>

            {/* Mode Tabs */}
            <div className="flex gap-1 bg-elevated rounded-lg p-1">
                <button
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${mode === 'create'
                        ? 'bg-accent-muted text-accent shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                        }`}
                    onClick={() => setMode('create')}
                >
                    New Connection
                </button>
                <button
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${mode === 'choose'
                        ? 'bg-accent-muted text-accent shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                        }`}
                    onClick={() => setMode('choose')}
                >
                    Saved ({connections.length})
                </button>
            </div>

            {/* ── Existing Connections ── */}
            {mode === 'choose' && (
                <div className="flex flex-col gap-2">
                    {connections.length === 0 ? (
                        <div className="py-8 text-center">
                            <p className="text-text-muted text-sm mb-2">No saved connections</p>
                            <button
                                className="text-accent text-xs font-medium hover:underline"
                                onClick={() => setMode('create')}
                            >
                                Create your first connection →
                            </button>
                        </div>
                    ) : (
                        connections.map(c => {
                            const drv = DRIVER_OPTIONS.find(d => d.value === c.driver)
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => handleUseExisting(c.id)}
                                    disabled={testing}
                                    className="flex items-center gap-3 p-3 rounded-lg bg-elevated border border-border-subtle
                                               hover:border-accent hover:bg-hover transition-all text-left group
                                               disabled:opacity-50 disabled:cursor-wait"
                                >
                                    <span className="flex items-center">{drv?.icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-text-primary text-sm font-medium truncate">{c.name}</p>
                                        <p className="text-text-muted text-xs font-mono truncate">
                                            {c.driver === 'sqlite' ? c.host : `${c.host}:${c.port}/${c.database}`}
                                        </p>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent-muted px-1.5 py-0.5 rounded font-mono">
                                        {c.driver}
                                    </span>
                                    <svg className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 16 16" fill="none">
                                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            )
                        })
                    )}
                </div>
            )}

            {/* ── Create Form ── */}
            {mode === 'create' && (
                <div className="flex flex-col gap-3">
                    {/* Driver selector as cards */}
                    <div>
                        <label className="text-text-secondary text-xs font-medium mb-1.5 block">Driver</label>
                        <div className="grid grid-cols-4 gap-1.5">
                            {DRIVER_OPTIONS.map(d => (
                                <button
                                    key={d.value}
                                    onClick={() => setForm(f => ({
                                        ...f,
                                        driver: d.value,
                                        port: d.defaultPort,
                                        host: d.value === 'sqlite' ? '' : f.host,
                                    }))}
                                    className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border transition-all text-xs font-medium ${form.driver === d.value
                                        ? 'border-accent bg-accent-muted text-accent'
                                        : 'border-border-subtle bg-elevated text-text-secondary hover:border-border-default hover:text-text-primary'
                                        }`}
                                >
                                    <span className="flex items-center justify-center">{d.icon}</span>
                                    <span>{d.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="text-text-secondary text-xs font-medium mb-1 block">Name</label>
                        <input
                            className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                       placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                            placeholder="My Database"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                        />
                    </div>

                    {/* SQLite: File Picker */}
                    {form.driver === 'sqlite' && (
                        <div>
                            <label className="text-text-secondary text-xs font-medium mb-1 block">Database File</label>
                            <div className="flex gap-2">
                                <div
                                    className="flex-1 px-3 py-2 bg-elevated border border-border-default rounded-lg text-sm
                                               truncate cursor-pointer hover:border-accent transition-colors"
                                    onClick={handlePickFile}
                                >
                                    {form.host ? (
                                        <span className="text-text-primary font-mono text-xs">{form.host}</span>
                                    ) : (
                                        <span className="text-text-muted">Click to select file...</span>
                                    )}
                                </div>
                                <button
                                    onClick={handlePickFile}
                                    className="px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-secondary
                                               hover:border-accent hover:text-accent transition-all text-xs font-medium flex-shrink-0"
                                >
                                    Browse
                                </button>
                            </div>
                        </div>
                    )}

                    {/* MongoDB: Connection String */}
                    {form.driver === 'mongodb' && (
                        <>
                            <div>
                                <label className="text-text-secondary text-xs font-medium mb-1 block">Connection String</label>
                                <input
                                    className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                               font-mono placeholder:text-text-muted/60 focus:border-accent focus:outline-none transition-colors"
                                    placeholder="mongodb+srv://user:<password>@cluster.mongodb.net"
                                    value={form.host}
                                    onChange={e => setForm({ ...form, host: e.target.value })}
                                />
                                <p className="text-text-muted text-[10px] mt-1">
                                    Paste your Atlas connection string or use host:port format
                                </p>
                            </div>
                            <div>
                                <label className="text-text-secondary text-xs font-medium mb-1 block">Database</label>
                                <input
                                    className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                               placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                    placeholder="mydb"
                                    value={form.database}
                                    onChange={e => setForm({ ...form, database: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-text-secondary text-xs font-medium mb-1 block">Password</label>
                                <input
                                    type="password"
                                    className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                               placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                    placeholder="••••••••"
                                    value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                />
                                <p className="text-text-muted text-[10px] mt-1">
                                    Replaces {'<password>'} in the connection string
                                </p>
                            </div>
                        </>
                    )}

                    {/* MySQL / PostgreSQL: Host, Port, Database, Username, Password */}
                    {form.driver !== 'sqlite' && form.driver !== 'mongodb' && (
                        <>
                            <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                    <label className="text-text-secondary text-xs font-medium mb-1 block">Host</label>
                                    <input
                                        className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                                   placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                        placeholder="localhost"
                                        value={form.host}
                                        onChange={e => setForm({ ...form, host: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-text-secondary text-xs font-medium mb-1 block">Port</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                                   placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                        value={form.port}
                                        onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-text-secondary text-xs font-medium mb-1 block">Database</label>
                                <input
                                    className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                               placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                    placeholder="mydb"
                                    value={form.database}
                                    onChange={e => setForm({ ...form, database: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-text-secondary text-xs font-medium mb-1 block">Username</label>
                                    <input
                                        className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                                   placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                        placeholder="root"
                                        value={form.username}
                                        onChange={e => setForm({ ...form, username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-text-secondary text-xs font-medium mb-1 block">Password</label>
                                    <input
                                        type="password"
                                        className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary text-sm
                                                   placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors"
                                        placeholder="••••••••"
                                        value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Connect Button */}
                    <button
                        className="w-full py-2.5 mt-1 rounded-lg bg-accent text-white font-semibold text-sm
                                   hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                   flex items-center justify-center gap-2"
                        onClick={handleCreate}
                        disabled={testing}
                    >
                        {testing ? (
                            <>
                                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Testing connection...
                            </>
                        ) : (
                            <>
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                    <path d="M13 3L6 10l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                Test & Connect
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Error Banner */}
            {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/20">
                    <svg className="w-4 h-4 text-error flex-shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M8 4v5M8 11v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <p className="text-error text-xs leading-relaxed">{error}</p>
                </div>
            )}
        </div>
    )
}
