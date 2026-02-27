import './commandpalette.css'
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import type { Page } from '../../bridge/wails'
import { IconPlus, IconNotebook, IconFile } from '@tabler/icons-react'

interface CommandItem {
    id: string
    label: string
    sublabel?: string
    icon: ReactNode
    type: 'notebook' | 'page' | 'action' | 'separator'
    action: () => void
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const notebooks = useAppStore(s => s.notebooks)
    const activeNotebookId = useAppStore(s => s.activeNotebookId)
    const selectNotebook = useAppStore(s => s.selectNotebook)
    const selectPage = useAppStore(s => s.selectPage)
    const createNotebook = useAppStore(s => s.createNotebook)
    const createPage = useAppStore(s => s.createPage)

    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [allPages, setAllPages] = useState<(Page & { notebookName: string })[]>([])
    const [mode, setMode] = useState<'search' | 'create-notebook' | 'create-page'>('search')
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Fetch all pages from all notebooks when palette opens
    useEffect(() => {
        if (!isOpen) return
        setQuery('')
        setSelectedIndex(0)
        setMode('search')

        const fetchAll = async () => {
            const pages: (Page & { notebookName: string })[] = []
            for (const nb of notebooks) {
                const p = await api.listPages(nb.id)
                if (p) pages.push(...p.map(pg => ({ ...pg, notebookName: nb.name })))
            }
            setAllPages(pages)
        }
        fetchAll()
        setTimeout(() => inputRef.current?.focus(), 50)
    }, [isOpen, notebooks])

    // Build search items
    const items = useMemo((): CommandItem[] => {
        if (mode !== 'search') return []

        const result: CommandItem[] = []

        // Actions first
        result.push({
            id: 'action-create-notebook',
            label: 'New Notebook',
            icon: <IconPlus size={14} />,
            type: 'action',
            action: () => setMode('create-notebook'),
        })

        if (activeNotebookId) {
            result.push({
                id: 'action-create-page',
                label: 'New Page',
                sublabel: 'in current notebook',
                icon: <IconPlus size={14} />,
                type: 'action',
                action: () => setMode('create-page'),
            })
        }

        // Notebooks grouped with their pages
        for (const nb of notebooks) {
            const nbPages = allPages.filter(p => p.notebookId === nb.id)

            result.push({
                id: `nb-${nb.id}`,
                label: nb.name,
                icon: <IconNotebook size={14} />,
                type: 'notebook',
                action: () => { selectNotebook(nb.id); onClose() },
            })

            for (const page of nbPages) {
                result.push({
                    id: `page-${page.id}`,
                    label: page.name,
                    sublabel: nb.name,
                    icon: <IconFile size={14} />,
                    type: 'page',
                    action: () => {
                        if (nb.id !== activeNotebookId) selectNotebook(nb.id)
                        selectPage(page.id)
                        onClose()
                    },
                })
            }
        }

        // Filter by query
        if (!query.trim()) return result
        const q = query.toLowerCase()
        return result.filter(item =>
            item.label.toLowerCase().includes(q) ||
            (item.sublabel && item.sublabel.toLowerCase().includes(q))
        )
    }, [mode, allPages, notebooks, activeNotebookId, query, selectNotebook, selectPage, onClose])

    // Keep selection in bounds
    useEffect(() => {
        if (selectedIndex >= items.length) setSelectedIndex(Math.max(0, items.length - 1))
    }, [items.length, selectedIndex])

    // Scroll selected into view
    useEffect(() => {
        const list = listRef.current
        if (!list) return
        const el = list.children[selectedIndex] as HTMLElement
        if (el) el.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex(i => Math.min(i + 1, items.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex(i => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (mode === 'create-notebook') {
                const name = query.trim()
                if (name) { createNotebook(name); onClose() }
            } else if (mode === 'create-page') {
                const name = query.trim()
                if (name && activeNotebookId) { createPage(activeNotebookId, name); onClose() }
            } else if (items[selectedIndex]) {
                items[selectedIndex].action()
            }
        } else if (e.key === 'Escape') {
            e.preventDefault()
            if (mode !== 'search') { setMode('search'); setQuery('') }
            else onClose()
        }
    }, [items, selectedIndex, mode, query, activeNotebookId, createNotebook, createPage, onClose])

    if (!isOpen) return null

    return (
        <>
            {/* Backdrop */}
            <div className="cmd-backdrop" onClick={onClose} />

            {/* Palette */}
            <div className="cmd-palette">
                <div className="cmd-input-wrapper">
                    {mode !== 'search' && (
                        <span className="cmd-mode-badge">
                            {mode === 'create-notebook' ? 'New Notebook' : 'New Page'}
                        </span>
                    )}
                    <input
                        ref={inputRef}
                        className="cmd-input"
                        placeholder={
                            mode === 'create-notebook' ? 'Notebook name...' :
                                mode === 'create-page' ? 'Page name...' :
                                    'Search notebooks & pages...'
                        }
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
                        onKeyDown={handleKeyDown}
                    />
                </div>

                {mode === 'search' && (
                    <div className="cmd-list" ref={listRef}>
                        {items.length === 0 && (
                            <div className="cmd-empty">No results found</div>
                        )}
                        {items.map((item, i) => (
                            <button
                                key={item.id}
                                className={`cmd-item ${i === selectedIndex ? 'selected' : ''} ${item.type === 'page' ? 'cmd-item-nested' : ''}`}
                                onClick={item.action}
                                onMouseEnter={() => setSelectedIndex(i)}
                            >
                                <span className="cmd-item-icon">{item.icon}</span>
                                <span className="cmd-item-label">{item.label}</span>
                                {item.sublabel && (
                                    <span className="cmd-item-sublabel">{item.sublabel}</span>
                                )}
                                <span className="cmd-item-type">{item.type}</span>
                            </button>
                        ))}
                    </div>
                )}

                <div className="cmd-footer">
                    <span>↑↓ navigate</span>
                    <span>↵ select</span>
                    <span>esc close</span>
                </div>
            </div>
        </>
    )
}
