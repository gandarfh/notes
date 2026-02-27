import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.min.css'
import DOMPurify from 'dompurify'
import { useState, useEffect, useMemo, memo } from 'react'
import type { BlockPlugin, PluginRendererProps, PluginContext } from '../sdk'
import { sdkGetFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE } from '../sdk/runtime/contextFactory'

// ── Language mapping ───────────────────────────────────────

const LANG_MAP: Record<string, string> = {
    go: 'go', rs: 'rust', py: 'python', rb: 'ruby',
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', html: 'xml', xml: 'xml', css: 'css',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    lua: 'lua', zig: 'zig', nim: 'nim',
    dockerfile: 'dockerfile', makefile: 'makefile',
    proto: 'protobuf', graphql: 'graphql',
    tf: 'hcl', hcl: 'hcl', txt: 'plaintext',
    md: 'markdown',
}

export const LANGUAGES = [
    { ext: 'txt', label: 'Plain Text' },
    { ext: 'go', label: 'Go' },
    { ext: 'rs', label: 'Rust' },
    { ext: 'py', label: 'Python' },
    { ext: 'js', label: 'JavaScript' },
    { ext: 'ts', label: 'TypeScript' },
    { ext: 'tsx', label: 'TSX' },
    { ext: 'jsx', label: 'JSX' },
    { ext: 'json', label: 'JSON' },
    { ext: 'yaml', label: 'YAML' },
    { ext: 'toml', label: 'TOML' },
    { ext: 'sql', label: 'SQL' },
    { ext: 'sh', label: 'Shell' },
    { ext: 'html', label: 'HTML' },
    { ext: 'css', label: 'CSS' },
    { ext: 'java', label: 'Java' },
    { ext: 'kt', label: 'Kotlin' },
    { ext: 'swift', label: 'Swift' },
    { ext: 'c', label: 'C' },
    { ext: 'cpp', label: 'C++' },
    { ext: 'lua', label: 'Lua' },
    { ext: 'zig', label: 'Zig' },
    { ext: 'rb', label: 'Ruby' },
    { ext: 'proto', label: 'Protobuf' },
    { ext: 'graphql', label: 'GraphQL' },
    { ext: 'dockerfile', label: 'Dockerfile' },
    { ext: 'hcl', label: 'HCL/Terraform' },
    { ext: 'md', label: 'Markdown' },
]

function getExt(filePath?: string): string {
    return filePath?.split('.').pop()?.toLowerCase() || 'txt'
}

// ── Renderer Component ─────────────────────────────────────

const CodeRenderer = memo(function CodeRenderer({ block, ctx }: PluginRendererProps) {
    const [fontSize, setFontSize] = useState(() => ctx.ui.getFontSize())

    // Listen for font size changes via plugin bus
    useEffect(() => {
        return ctx.events.on('block:fontsize-changed', (payload: any) => {
            if (payload?.blockId === block.id) setFontSize(payload.size)
        })
    }, [block.id, ctx])

    const ext = getExt(block.filePath)
    const lang = LANG_MAP[ext] || ''

    const codeHtml = useMemo(() => {
        if (!block.content) return null

        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(block.content, { language: lang }).value
        }
        return hljs.highlightAuto(block.content).value
    }, [block.content, lang])

    const lines = block.content?.split('\n') || []

    if (!block.content) {
        return (
            <div className="code-file-container" style={{ fontSize: `${fontSize}px` }}>
                <div className="code-file-empty">
                    <p>Empty — double-click to edit</p>
                </div>
            </div>
        )
    }

    return (
        <div className="code-file-container" style={{ fontSize: `${fontSize}px` }}>
            <div className="code-file-scroll">
                <table className="code-file-table">
                    <tbody>
                        {lines.map((_, i) => (
                            <tr key={i}>
                                <td className="code-gutter">{i + 1}</td>
                                <td
                                    className="code-line"
                                    dangerouslySetInnerHTML={{
                                        __html: DOMPurify.sanitize(codeHtml!.split('\n')[i] || '')
                                    }}
                                />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
})

// ── Language Picker Header Extension ───────────────────────

function CodeHeaderExtension({ blockId, ctx }: { blockId: string; ctx: PluginContext }) {
    // Read current file extension from block state via storage
    const [currentExt, setCurrentExt] = useState('txt')

    // Get file path from ctx.block
    const ext = ctx.block.filePath?.split('.').pop()?.toLowerCase() || 'txt'

    const handleChange = async (newExt: string) => {
        if (!ctx.block.filePath) return
        // Update the file path extension via RPC
        const parts = ctx.block.filePath.split('.')
        parts[parts.length - 1] = newExt
        const newPath = parts.join('.')
        try {
            await ctx.rpc.call('UpdateBlockFilePath', blockId, newPath)
        } catch {
            // If no RPC method exists, silently ignore
        }
    }

    return (
        <select
            className="code-lang-select"
            value={ext}
            onChange={e => { e.stopPropagation(); handleChange(e.target.value) }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            {LANGUAGES.map(l => (
                <option key={l.ext} value={l.ext}>{l.label}</option>
            ))}
        </select>
    )
}

// ── Icon Component ─────────────────────────────────────────

function CodeIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
            <path d="M6 5L3 9l3 4M12 5l3 4-3 4M10 3l-2 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const codePlugin: BlockPlugin = {
    type: 'code',
    label: 'Code Block',
    Icon: CodeIcon,
    defaultSize: { width: 500, height: 350 },
    Renderer: CodeRenderer,
    headerLabel: 'CODE',
    capabilities: {
        editable: true,
    },
    HeaderExtension: CodeHeaderExtension,
}
