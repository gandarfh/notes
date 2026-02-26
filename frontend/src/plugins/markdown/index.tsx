import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.min.css'
import 'katex/dist/katex.min.css'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import type { BlockPlugin, BlockRendererProps } from '../types'
import { getBlockFontSize } from '../../components/Block/BlockContainer'
import { useAppStore } from '../../store'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'

// ── Footnote pre-processor ─────────────────────────────────
// Extracts [^id]: definitions and converts [^id] refs into
// superscript links + appends a footnotes section at the end.

function processFootnotes(src: string): string {
    const defRegex = /^\[\^([^\]]+)\]:\s*(.+)$/gm
    const defs = new Map<string, string>()
    let match: RegExpExecArray | null
    while ((match = defRegex.exec(src)) !== null) {
        defs.set(match[1], match[2])
    }
    if (defs.size === 0) return src

    // Remove definition lines from source
    let cleaned = src.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, '')

    // Replace inline references [^id] with superscript links
    let idx = 0
    const order: string[] = []
    cleaned = cleaned.replace(/\[\^([^\]]+)\]/g, (_, id: string) => {
        if (!defs.has(id)) return `[^${id}]`
        if (!order.includes(id)) order.push(id)
        const num = order.indexOf(id) + 1
        return `<sup class="fn-ref"><a href="#fn-${id}" id="fnref-${id}">${num}</a></sup>`
    })

    // Append footnotes section
    if (order.length > 0) {
        cleaned += '\n\n---\n\n<section class="footnotes">\n<ol>\n'
        for (const id of order) {
            cleaned += `<li id="fn-${id}">${defs.get(id)} <a href="#fnref-${id}" class="fn-back">↩</a></li>\n`
        }
        cleaned += '</ol>\n</section>\n'
    }
    return cleaned
}

// ── Configure mermaid ──────────────────────────────────────

/** Re-initializes mermaid with the correct theme based on data-theme attribute */
function syncMermaidTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    mermaid.initialize({
        startOnLoad: false,
        theme: isLight ? 'default' : 'dark',
        fontFamily: 'sans-serif',
        flowchart: { useMaxWidth: false, wrappingWidth: 400 },
        sequence: { useMaxWidth: false },
        gantt: { useMaxWidth: false },
        journey: { useMaxWidth: false },
        class: { useMaxWidth: false },
        state: { useMaxWidth: false },
        er: { useMaxWidth: false },
        pie: { useMaxWidth: false },
    })
}

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

// Enable KaTeX math rendering ($...$ inline, $$...$$ block)
marked.use(markedKatex({
    throwOnError: false,
    output: 'html',
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

            // Mermaid diagrams: emit a placeholder that will be rendered post-mount
            if (lang === 'mermaid') {
                const encoded = btoa(unescape(encodeURIComponent(token.text)))
                return `<div class="mermaid-block" data-mermaid="${encoded}" data-source-line="${line}"></div>\n`
            }

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
    const processed = processFootnotes(src)
    const tokens = marked.lexer(processed)

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

// Regex to find mermaid placeholder divs in the generated HTML
const MERMAID_PLACEHOLDER_RE = /<div class="mermaid-block" data-mermaid="([^"]*)"[^>]*><\/div>/g

const MarkdownRenderer = memo(function MarkdownRenderer({ block, isEditing }: BlockRendererProps) {
    const previewRef = useRef<HTMLDivElement>(null)
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

    const rawHtml = useMemo(() =>
        block.content ? renderMarkdownWithLines(block.content) : '<p style="color: var(--color-text-muted); font-style: italic;">Empty — ⌘+click to edit</p>'
        , [block.content])

    // State holds the final HTML with mermaid SVGs embedded (React-safe)
    const [finalHtml, setFinalHtml] = useState(rawHtml)

    // When rawHtml changes, render any mermaid diagrams into the HTML string
    useEffect(() => {
        const matches = Array.from(rawHtml.matchAll(MERMAID_PLACEHOLDER_RE))
        if (matches.length === 0) {
            setFinalHtml(rawHtml)
            return
        }

        // Sync mermaid theme with current app theme before rendering
        syncMermaidTheme()

        let cancelled = false
            ; (async () => {
                let result = rawHtml
                for (const match of matches) {
                    if (cancelled) return
                    const encoded = match[1]
                    const source = decodeURIComponent(escape(atob(encoded)))
                    try {
                        const id = `mermaid-${block.id}-${Math.random().toString(36).slice(2, 8)}`
                        const { svg } = await mermaid.render(id, source)
                        result = result.replace(match[0], `<div class="mermaid-block mermaid-rendered">${svg}</div>`)
                    } catch {
                        const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        result = result.replace(match[0], `<div class="mermaid-block mermaid-error"><pre>${escaped}</pre></div>`)
                    }
                }
                if (!cancelled) {
                    setFinalHtml(result)
                }
            })()

        return () => { cancelled = true }
    }, [rawHtml, block.id])

    // ── Scroll to line after exiting editor ──
    // The host sets `scrollToLine` in the store when the editor closes.
    // This plugin reads it, scrolls to the closest data-source-line, and clears it.
    const scrollToLine = useAppStore(s => s.scrollToLine)
    useEffect(() => {
        if (isEditing || !scrollToLine || !previewRef.current) return
        const timer = setTimeout(() => {
            // Only scroll the block that was just edited (it gets selected on close)
            const { selectedBlockId } = useAppStore.getState()
            if (selectedBlockId !== block.id) return

            const container = previewRef.current?.closest('.block-content') as HTMLElement
            if (!container) return
            const lineEls = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'))
            const target = lineEls.reduce<{ el: HTMLElement | null; dist: number }>((acc, el) => {
                const line = parseInt(el.dataset.sourceLine || '0', 10)
                const dist = Math.abs(line - scrollToLine)
                return dist < acc.dist ? { el, dist } : acc
            }, { el: null, dist: Infinity })

            if (target.el) {
                const containerRect = container.getBoundingClientRect()
                const targetRect = target.el.getBoundingClientRect()
                const offset = targetRect.top - containerRect.top + container.scrollTop
                container.scrollTo({
                    top: Math.max(0, offset - container.clientHeight * 0.3),
                    behavior: 'smooth',
                })
            }
            useAppStore.setState({ scrollToLine: null })
        }, 300)
        return () => clearTimeout(timer)
    }, [isEditing, scrollToLine, block.id])

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
            ref={previewRef}
            className={`markdown-preview ${isEditing ? '' : 'cursor-text select-text'}`}
            style={{ fontSize: `${fontSize}px` }}
            onClick={handleClick}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(finalHtml, { ADD_TAGS: ['section', 'input'], ADD_ATTR: ['checked', 'disabled', 'data-source-line', 'data-mermaid', 'data-zoom'] }) }}
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
