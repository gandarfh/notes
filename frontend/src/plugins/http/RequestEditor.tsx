import { useState, useCallback, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { keymap } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import { useTheme } from '../../hooks/useTheme'
import type { HTTPBlockConfig, KeyValuePair } from './index'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type Tab = 'params' | 'headers' | 'auth' | 'body'

interface Props {
    config: HTTPBlockConfig
    loading: boolean
    onChange: (config: HTTPBlockConfig) => void
    onSend: (config: HTTPBlockConfig) => void
}

// ── Key-Value Table ────────────────────────────────────────

function KVTable({ items, onChange }: {
    items: KeyValuePair[]
    onChange: (items: KeyValuePair[]) => void
}) {
    const update = (idx: number, field: keyof KeyValuePair, val: any) => {
        const next = items.map((it, i) => i === idx ? { ...it, [field]: val } : it)
        onChange(next)
    }

    const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx))

    const add = () => onChange([...items, { key: '', value: '', enabled: true, description: '' }])

    return (
        <div className="http-kv-table">
            {items.length > 0 && (
                <div className="http-kv-header">
                    <span className="http-kv-check" />
                    <span className="http-kv-col">Key</span>
                    <span className="http-kv-col">Value</span>
                    <span className="http-kv-col http-kv-desc">Description</span>
                    <span className="http-kv-actions" />
                </div>
            )}
            {items.map((item, i) => (
                <div key={i} className={`http-kv-row ${!item.enabled ? 'disabled' : ''}`}>
                    <label className="http-kv-check">
                        <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={e => update(i, 'enabled', e.target.checked)}
                        />
                    </label>
                    <input
                        className="http-kv-input"
                        placeholder="Key"
                        value={item.key}
                        onChange={e => update(i, 'key', e.target.value)}
                    />
                    <input
                        className="http-kv-input"
                        placeholder="Value"
                        value={item.value}
                        onChange={e => update(i, 'value', e.target.value)}
                    />
                    <input
                        className="http-kv-input http-kv-desc"
                        placeholder="Description"
                        value={item.description || ''}
                        onChange={e => update(i, 'description', e.target.value)}
                    />
                    <button className="http-kv-remove" onClick={() => remove(i)}>×</button>
                </div>
            ))}
            <button className="http-kv-add" onClick={add}>+ Add</button>
        </div>
    )
}

// ── Main Editor ────────────────────────────────────────────

export function RequestEditor({ config, loading, onChange, onSend }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('params')
    const { theme } = useTheme()

    // Body content stored in ref — no re-render on keystroke (same pattern as DB block)
    const bodyContentRef = useRef(config.body.content)
    // Keep ref in sync with external config changes
    const prevBodyRef = useRef(config.body.content)
    if (config.body.content !== prevBodyRef.current) {
        prevBodyRef.current = config.body.content
        bodyContentRef.current = config.body.content
    }

    const handleBodyChange = useCallback((val: string) => {
        bodyContentRef.current = val
    }, [])

    // Get current config including body content from ref
    const getCurrentConfig = useCallback((): HTTPBlockConfig => ({
        ...config,
        body: { ...config.body, content: bodyContentRef.current },
    }), [config])

    // Flush body content into config when switching away from body tab
    const handleTabSwitch = useCallback((tab: Tab) => {
        if (activeTab === 'body' && bodyContentRef.current !== config.body.content) {
            onChange({ ...config, body: { ...config.body, content: bodyContentRef.current } })
        }
        setActiveTab(tab)
    }, [activeTab, config, onChange])

    const updateConfig = useCallback((partial: Partial<HTTPBlockConfig>) => {
        onChange({ ...config, ...partial })
    }, [config, onChange])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSend(getCurrentConfig())
        }
    }, [getCurrentConfig, onSend])

    const enabledParamsCount = config.params.filter(p => p.enabled && p.key).length
    const enabledHeadersCount = config.headers.filter(p => p.enabled && p.key).length

    // Use refs so CodeMirror extensions are stable (never recreated)
    const onSendRef = useRef(onSend)
    onSendRef.current = onSend
    const getCurrentConfigRef = useRef(getCurrentConfig)
    getCurrentConfigRef.current = getCurrentConfig

    const cmExtensions = useMemo(() => [
        json(),
        vim(),
        keymap.of([
            { key: 'Ctrl-Enter', run: () => { onSendRef.current(getCurrentConfigRef.current()); return true } },
            { key: 'Cmd-Enter', run: () => { onSendRef.current(getCurrentConfigRef.current()); return true } },
        ]),
    ], [])

    return (
        <div className="http-request" onKeyDown={handleKeyDown}>
            {/* ── URL Bar ── */}
            <div className="http-url-bar">
                <select
                    className={`http-method http-method-${config.method.toLowerCase()}`}
                    value={config.method}
                    onChange={e => updateConfig({ method: e.target.value })}
                >
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <input
                    className="http-url-input"
                    type="text"
                    placeholder="https://api.example.com/data"
                    value={config.url}
                    onChange={e => updateConfig({ url: e.target.value })}
                />
                <button
                    className="http-send-btn"
                    onClick={() => onSend(getCurrentConfig())}
                    disabled={loading || !config.url}
                >
                    {loading ? '⟳' : 'Send'}
                </button>
            </div>

            {/* ── Request Tabs ── */}
            <div className="http-tabs">
                <button className={`http-tab ${activeTab === 'params' ? 'active' : ''}`} onClick={() => handleTabSwitch('params')}>
                    Params{enabledParamsCount > 0 ? ` (${enabledParamsCount})` : ''}
                </button>
                <button className={`http-tab ${activeTab === 'headers' ? 'active' : ''}`} onClick={() => handleTabSwitch('headers')}>
                    Headers{enabledHeadersCount > 0 ? ` (${enabledHeadersCount})` : ''}
                </button>
                <button className={`http-tab ${activeTab === 'auth' ? 'active' : ''}`} onClick={() => handleTabSwitch('auth')}>
                    Auth{config.auth.type !== 'none' ? ' ●' : ''}
                </button>
                <button className={`http-tab ${activeTab === 'body' ? 'active' : ''}`} onClick={() => handleTabSwitch('body')}>
                    Body{config.body.mode !== 'none' ? ' ●' : ''}
                </button>
            </div>

            {/* ── Tab Content ── */}
            <div className="http-tab-content">
                {activeTab === 'params' && (
                    <KVTable items={config.params} onChange={params => updateConfig({ params })} />
                )}

                {activeTab === 'headers' && (
                    <KVTable items={config.headers} onChange={headers => updateConfig({ headers })} />
                )}

                {activeTab === 'auth' && (
                    <div className="http-auth">
                        <div className="http-auth-type">
                            <label className="http-auth-option">
                                <input type="radio" name="auth" value="none"
                                    checked={config.auth.type === 'none'}
                                    onChange={() => updateConfig({ auth: { type: 'none' } })} />
                                No Auth
                            </label>
                            <label className="http-auth-option">
                                <input type="radio" name="auth" value="bearer"
                                    checked={config.auth.type === 'bearer'}
                                    onChange={() => updateConfig({ auth: { type: 'bearer', token: config.auth.token || '' } })} />
                                Bearer Token
                            </label>
                            <label className="http-auth-option">
                                <input type="radio" name="auth" value="basic"
                                    checked={config.auth.type === 'basic'}
                                    onChange={() => updateConfig({ auth: { type: 'basic', username: config.auth.username || '', password: config.auth.password || '' } })} />
                                Basic Auth
                            </label>
                        </div>
                        {config.auth.type === 'bearer' && (
                            <input
                                className="http-auth-input"
                                type="text"
                                placeholder="Token"
                                value={config.auth.token || ''}
                                onChange={e => updateConfig({ auth: { ...config.auth, token: e.target.value } })}
                            />
                        )}
                        {config.auth.type === 'basic' && (
                            <div className="http-auth-basic">
                                <input
                                    className="http-auth-input"
                                    type="text"
                                    placeholder="Username"
                                    value={config.auth.username || ''}
                                    onChange={e => updateConfig({ auth: { ...config.auth, username: e.target.value } })}
                                />
                                <input
                                    className="http-auth-input"
                                    type="password"
                                    placeholder="Password"
                                    value={config.auth.password || ''}
                                    onChange={e => updateConfig({ auth: { ...config.auth, password: e.target.value } })}
                                />
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'body' && (
                    <div className="http-body">
                        <div className="http-body-modes">
                            {(['none', 'json', 'raw'] as const).map(m => (
                                <label key={m} className="http-body-mode">
                                    <input type="radio" name="bodyMode" value={m}
                                        checked={config.body.mode === m}
                                        onChange={() => updateConfig({ body: { ...config.body, mode: m } })} />
                                    {m === 'none' ? 'None' : m === 'json' ? 'JSON' : 'Raw'}
                                </label>
                            ))}
                        </div>
                        {config.body.mode !== 'none' && (
                            <div className="http-body-editor">
                                <CodeMirror
                                    value={config.body.content}
                                    onChange={handleBodyChange}
                                    extensions={cmExtensions}
                                    theme={theme}
                                    basicSetup={{
                                        lineNumbers: true,
                                        foldGutter: false,
                                        highlightActiveLine: true,
                                    }}
                                    height="100%"
                                    style={{ height: '100%', fontSize: '12px' }}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
