import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.min.css'
import DOMPurify from 'dompurify'
import { useState, useEffect, useMemo, memo } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import { getBlockFontSize } from '../../components/Block/BlockContainer'

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

function getExt(filePath?: string): string {
    return filePath?.split('.').pop()?.toLowerCase() || 'txt'
}

// ── Renderer Component ─────────────────────────────────────

const CodeRenderer = memo(function CodeRenderer({ block }: BlockRendererProps) {
    const [fontSize, setFontSize] = useState(() => getBlockFontSize(block.id))

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail.blockId === block.id) setFontSize(detail.size)
        }
        window.addEventListener('md-fontsize-change', handler)
        return () => window.removeEventListener('md-fontsize-change', handler)
    }, [block.id])

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
}
