import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import { api } from '../../bridge/wails'
import { useAppStore } from '../../store'
import { RequestEditor } from './RequestEditor'
import { ResponseViewer } from './ResponseViewer'

// ── Config stored in block.content ─────────────────────────

export interface KeyValuePair {
    key: string
    value: string
    enabled: boolean
    description?: string
}

export interface HTTPBlockConfig {
    method: string
    url: string
    params: KeyValuePair[]
    headers: KeyValuePair[]
    auth: { type: 'none' | 'bearer' | 'basic'; token?: string; username?: string; password?: string }
    body: { mode: 'none' | 'json' | 'raw'; content: string }
}

export interface HTTPResponseData {
    statusCode: number
    statusText: string
    headers: Record<string, string>
    body: string
    durationMs: number
    contentType: string
    sizeBytes: number
}

// Full block content = config + persisted last response
interface HTTPBlockContent extends HTTPBlockConfig {
    lastResponse?: HTTPResponseData | null
}

const defaultConfig: HTTPBlockConfig = {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { mode: 'none', content: '' },
}

function migrateKV(raw: any): KeyValuePair[] {
    if (Array.isArray(raw)) return raw
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({
            key, value: String(value), enabled: true,
        }))
    }
    return []
}

function parseContent(content: string): { config: HTTPBlockConfig; lastResponse: HTTPResponseData | null } {
    try {
        const parsed = JSON.parse(content || '{}')
        let body = parsed.body
        if (typeof body === 'string') {
            body = { mode: body ? 'json' : 'none', content: body }
        }
        const config: HTTPBlockConfig = {
            ...defaultConfig,
            method: parsed.method || defaultConfig.method,
            url: parsed.url || '',
            params: migrateKV(parsed.params),
            headers: migrateKV(parsed.headers),
            auth: parsed.auth || { type: 'none' },
            body: body || { mode: 'none', content: '' },
        }
        return { config, lastResponse: parsed.lastResponse || null }
    } catch {
        return { config: { ...defaultConfig }, lastResponse: null }
    }
}

function buildURL(base: string, params: KeyValuePair[]): string {
    const enabled = params.filter(p => p.enabled && p.key)
    if (enabled.length === 0) return base
    const sep = base.includes('?') ? '&' : '?'
    const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
    return base + sep + qs
}

function serializeContent(config: HTTPBlockConfig, response: HTTPResponseData | null): string {
    return JSON.stringify({ ...config, lastResponse: response })
}

// ── Main Renderer ──────────────────────────────────────────

function HTTPRenderer({ block, isSelected }: BlockRendererProps) {
    const initial = useMemo(() => parseContent(block.content), [])
    const [localConfig, setLocalConfig] = useState<HTTPBlockConfig>(initial.config)
    const [response, setResponse] = useState<HTTPResponseData | null>(initial.lastResponse)
    const configRef = useRef(localConfig)
    configRef.current = localConfig
    const responseRef = useRef(response)
    responseRef.current = response

    // Sync from external content changes
    const lastContentRef = useRef(block.content)
    if (block.content !== lastContentRef.current) {
        lastContentRef.current = block.content
        const { config: parsed, lastResponse } = parseContent(block.content)
        setLocalConfig(parsed)
        configRef.current = parsed
        if (lastResponse) {
            setResponse(lastResponse)
            responseRef.current = lastResponse
        }
    }

    const updateBlock = useAppStore(s => s.updateBlock)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const blockRef = useRef<HTMLDivElement>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    // Debounced persist (500ms) — includes lastResponse
    const handleConfigChange = useCallback((newConfig: HTTPBlockConfig) => {
        setLocalConfig(newConfig)
        configRef.current = newConfig
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            const json = serializeContent(newConfig, responseRef.current)
            api.saveBlockHTTPConfig(block.id, json)
            updateBlock(block.id, { content: json })
        }, 500)
    }, [block.id, updateBlock])

    useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

    // Execute request
    const handleSend = useCallback(async (cfg?: HTTPBlockConfig) => {
        const c = cfg || configRef.current
        if (!c.url) return

        // Flush any pending save
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

        setLoading(true)
        setError('')
        try {
            const headersObj: Record<string, string> = {}
            for (const h of c.headers) {
                if (h.enabled && h.key) headersObj[h.key] = h.value
            }
            if (c.auth.type === 'bearer' && c.auth.token) {
                headersObj['Authorization'] = `Bearer ${c.auth.token}`
            } else if (c.auth.type === 'basic' && c.auth.username) {
                headersObj['Authorization'] = `Basic ${btoa(`${c.auth.username}:${c.auth.password || ''}`)}`
            }

            const finalURL = buildURL(c.url, c.params)

            const result = await api.executeHTTPRequest(block.id, JSON.stringify({
                method: c.method,
                url: finalURL,
                headers: headersObj,
                body: c.body.mode !== 'none' ? c.body.content : '',
            }))
            setResponse(result)
            responseRef.current = result

            // Persist config + response together
            const json = serializeContent(c, result)
            await api.saveBlockHTTPConfig(block.id, json)
            updateBlock(block.id, { content: json })
            lastContentRef.current = json
        } catch (e: any) {
            setError(String(e))
        } finally {
            setLoading(false)
        }
    }, [block.id, updateBlock])

    // Scroll handling
    useEffect(() => {
        const el = blockRef.current
        if (!el || !isSelected) return
        const handler = (e: WheelEvent) => { e.stopPropagation() }
        el.addEventListener('wheel', handler, { passive: true })
        return () => el.removeEventListener('wheel', handler)
    }, [isSelected])

    return (
        <div className="http-block" ref={blockRef} onMouseDown={e => e.stopPropagation()}>
            <div className="http-pane http-pane-request">
                <RequestEditor
                    config={localConfig}
                    loading={loading}
                    onChange={handleConfigChange}
                    onSend={handleSend}
                />
            </div>
            {(error || response) && (
                <div className="http-pane http-pane-response">
                    {error && <div className="http-error">{error}</div>}
                    {response && <ResponseViewer response={response} />}
                </div>
            )}
        </div>
    )
}

// ── Icon ───────────────────────────────────────────────────

function HTTPIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 8h12M8 1.5C6 4 6 12 8 14.5M8 1.5C10 4 10 12 8 14.5" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        </svg>
    )
}

// ── Plugin ─────────────────────────────────────────────────

export const httpPlugin: BlockPlugin = {
    type: 'http',
    label: 'HTTP Request',
    Icon: HTTPIcon,
    defaultSize: { width: 580, height: 500 },
    Renderer: HTTPRenderer,
    headerLabel: 'HTTP',
}
