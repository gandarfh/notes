import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.min.css'
import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import { getBlockFontSize } from '../../components/Block/BlockContainer'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'

// ── Configure marked ───────────────────────────────────────

marked.use(markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value
        }
        return hljs.highlightAuto(code).value
    },
}))

// Enable GFM (tables, strikethrough, task lists) + line breaks
marked.use({
    gfm: true,
    breaks: true,
})

// ── Custom renderer ────────────────────────────────────────
// Uses regular functions (not arrows) so `this` binds to the
// Renderer instance and `this.parser` is available.
//
// The marked v17 pipeline:
//   heading, paragraph → token.tokens has inline tokens → use this.parser.parseInline()
//   listitem           → token.tokens has BLOCK tokens  → use this.parser.parse()
//   list               → iterate items, call this.listitem() for each
//   blockquote         → token.tokens has block tokens   → use this.parser.parse()
//   table              → cell.tokens has inline tokens   → use this.parser.parseInline()

marked.use({
    renderer: {
        heading(this: any, token: any) {
            const line = token.sourceLine ?? ''
            const content = this.parser.parseInline(token.tokens)
            return `<h${token.depth} data-source-line="${line}">${content}</h${token.depth}>\n`
        },

        paragraph(this: any, token: any) {
            const line = token.sourceLine ?? ''
            const content = this.parser.parseInline(token.tokens)
            return `<p data-source-line="${line}">${content}</p>\n`
        },

        code(this: any, token: any) {
            const line = token.sourceLine ?? ''
            const lang = token.lang || ''
            const highlighted = lang && hljs.getLanguage(lang)
                ? hljs.highlight(token.text, { language: lang }).value
                : hljs.highlightAuto(token.text).value
            const langClass = lang ? ` class="hljs language-${lang}"` : ''
            const langBadge = lang ? `<span class="code-lang-badge">${lang}</span>` : ''
            return `<div class="code-block-wrapper" data-source-line="${line}">${langBadge}<pre><code${langClass}>${highlighted}</code></pre></div>\n`
        },

        list(this: any, token: any) {
            const line = token.sourceLine ?? ''
            const tag = token.ordered ? 'ol' : 'ul'
            const startAttr = (token.ordered && token.start !== 1)
                ? ` start="${token.start}"`
                : ''
            // Call this.listitem() for each item, just like the default renderer
            let body = ''
            for (let i = 0; i < token.items.length; i++) {
                body += this.listitem(token.items[i])
            }
            return `<${tag}${startAttr} data-source-line="${line}">\n${body}</${tag}>\n`
        },

        listitem(this: any, token: any) {
            const line = token.sourceLine ?? ''
            // Use this.parser.parse() for block-level content (same as default)
            const content = this.parser.parse(token.tokens)

            if (token.task) {
                return `<li class="task-list-item" data-source-line="${line}">${content}</li>\n`
            }
            return `<li data-source-line="${line}">${content}</li>\n`
        },

        checkbox(this: any, token: any) {
            return `<input type="checkbox" ${token.checked ? 'checked=""' : ''} disabled="" /> `
        },

        hr(this: any, token: any) {
            const line = token.sourceLine ?? ''
            return `<hr class="md-hr" data-source-line="${line}" />\n`
        },

        table(this: any, token: any) {
            const line = token.sourceLine ?? ''
            const header = token.header?.map((cell: any) =>
                `<th>${this.parser.parseInline(cell.tokens)}</th>`
            ).join('') || ''
            const body = token.rows?.map((row: any[]) =>
                `<tr>${row.map((cell: any) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`
            ).join('') || ''
            return `<table data-source-line="${line}"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>\n`
        },

        blockquote(this: any, token: any) {
            const line = token.sourceLine ?? ''
            const content = this.parser.parse(token.tokens)
            return `<blockquote data-source-line="${line}">${content}</blockquote>\n`
        },
    }
})

// ── Line annotation + rendering ────────────────────────────

function renderMarkdownWithLines(src: string): string {
    const tokens = marked.lexer(src)

    // Recursively assign sourceLine to tokens and their children
    function annotate(tokenList: any[], startLine: number): number {
        let line = startLine
        for (const token of tokenList) {
            token.sourceLine = line
            // Recurse into children
            if (token.items) annotate(token.items, line)
            if (token.tokens) annotate(token.tokens, line)
            // Advance line counter based on this token's raw content
            if (token.raw) {
                const newlines = (token.raw.match(/\n/g) || []).length
                line += newlines
            }
        }
        return line
    }

    annotate(tokens as any[], 1)
    return marked.parser(tokens) as string
}

// ── Renderer Component ─────────────────────────────────────

const MarkdownRenderer = memo(function MarkdownRenderer({ block, isEditing }: BlockRendererProps) {
    const [fontSize, setFontSize] = useState(() => getBlockFontSize(block.id))

    // Listen for font size changes from the header popup
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail.blockId === block.id) {
                setFontSize(detail.size)
            }
        }
        window.addEventListener('md-fontsize-change', handler)
        return () => window.removeEventListener('md-fontsize-change', handler)
    }, [block.id])

    const html = useMemo(() =>
        block.content ? renderMarkdownWithLines(block.content) : '<p style="color: var(--color-text-muted); font-style: italic;">Empty — double-click to edit</p>'
        , [block.content])

    const handleClick = useCallback((e: React.MouseEvent) => {
        const anchor = (e.target as HTMLElement).closest('a')
        if (anchor && anchor.href) {
            e.preventDefault()
            e.stopPropagation()
            BrowserOpenURL(anchor.href)
        }
    }, [])

    return (
        <div
            className={`markdown-preview ${isEditing ? '' : 'cursor-text select-text'}`}
            style={{ fontSize: `${fontSize}px` }}
            onClick={handleClick}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    )
})

// ── Icon Component ─────────────────────────────────────────

function MarkdownIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
            <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 12V6l2.5 3L10 6v6M13 9l-1.5 1.5M13 9l-1.5-1.5M13 9h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const markdownPlugin: BlockPlugin = {
    type: 'markdown',
    label: 'Note Block',
    Icon: MarkdownIcon,
    defaultSize: { width: 320, height: 220 },
    Renderer: MarkdownRenderer,
    headerLabel: 'MD',
}
