import { useState, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { EditorState } from '@codemirror/state'
import { useTheme } from '../../hooks/useTheme'
import type { HTTPResponseData } from './index'

type ViewMode = 'pretty' | 'raw' | 'headers'

interface Props {
    response: HTTPResponseData
}

export function ResponseViewer({ response }: Props) {
    const [viewMode, setViewMode] = useState<ViewMode>('pretty')
    const { theme } = useTheme()

    const isJSON = response.contentType?.includes('json')
    const headerCount = Object.keys(response.headers || {}).length

    const formattedBody = useMemo(() => {
        if (!isJSON) return response.body
        try {
            return JSON.stringify(JSON.parse(response.body), null, 2)
        } catch {
            return response.body
        }
    }, [response.body, isJSON])

    const statusClass = response.statusCode >= 200 && response.statusCode < 300
        ? 'http-status-ok'
        : response.statusCode >= 400
            ? 'http-status-error'
            : response.statusCode === 0
                ? 'http-status-error'
                : 'http-status-other'

    const sizeLabel = response.sizeBytes > 1024
        ? `${(response.sizeBytes / 1024).toFixed(1)} KB`
        : `${response.sizeBytes} B`

    const readOnlyExt = useMemo(() => [
        json(),
        EditorState.readOnly.of(true),
    ], [])

    return (
        <div className="http-response">
            {/* ── Status + Tabs bar ── */}
            <div className="http-response-bar">
                <span className={`http-status-badge ${statusClass}`}>
                    {response.statusCode || 'ERR'}
                </span>
                <span className="http-response-meta">{response.durationMs} ms</span>
                <span className="http-response-meta">{sizeLabel}</span>

                <div className="http-response-tabs">
                    <button className={`http-rtab ${viewMode === 'pretty' ? 'active' : ''}`} onClick={() => setViewMode('pretty')}>Pretty</button>
                    <button className={`http-rtab ${viewMode === 'raw' ? 'active' : ''}`} onClick={() => setViewMode('raw')}>Raw</button>
                    <button className={`http-rtab ${viewMode === 'headers' ? 'active' : ''}`} onClick={() => setViewMode('headers')}>
                        Headers ({headerCount})
                    </button>
                </div>

                <button
                    className="http-response-copy"
                    onClick={() => navigator.clipboard.writeText(response.body)}
                    title="Copy response"
                >⧉</button>
            </div>

            {/* ── Content ── */}
            <div className="http-response-content">
                {viewMode === 'pretty' && isJSON ? (
                    <CodeMirror
                        value={formattedBody}
                        extensions={readOnlyExt}
                        theme={theme}
                        basicSetup={{
                            lineNumbers: true,
                            foldGutter: true,
                            highlightActiveLine: false,
                        }}
                        height="100%"
                        style={{ height: '100%', fontSize: '11px' }}
                        editable={false}
                    />
                ) : viewMode === 'headers' ? (
                    <div className="http-response-headers">
                        {Object.entries(response.headers || {}).map(([k, v]) => (
                            <div key={k} className="http-response-header">
                                <span className="http-rh-key">{k}</span>
                                <span className="http-rh-value">{v}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <pre className="http-response-body">{viewMode === 'pretty' ? formattedBody : response.body}</pre>
                )}
            </div>
        </div>
    )
}
