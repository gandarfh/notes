import { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import { registerModal } from '../../input'
import type { Notebook, Page } from '../../bridge/wails'
import { IconSparkles, IconFile } from '@tabler/icons-react'

// ── Sidebar Toggle Button (always visible) ─────────────────

export function SidebarToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
    return (
        <button
            onClick={onToggle}
            className="fixed top-[46px] left-3 z-[60] w-8 h-8 flex items-center justify-center rounded-md bg-surface border border-border-default text-text-secondary cursor-pointer transition-all duration-150 hover:bg-hover hover:text-text-primary hover:border-border-strong shadow-md"
            title={isOpen ? 'Close sidebar' : 'Open sidebar'}
        >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                {isOpen ? (
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                ) : (
                    <>
                        <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </>
                )}
            </svg>
        </button>
    )
}

// ── Sidebar Panel (floating overlay) ───────────────────────

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const notebooks = useAppStore(s => s.notebooks)
    const activeNotebookId = useAppStore(s => s.activeNotebookId)
    const activePageId = useAppStore(s => s.activePageId)
    const expandedNotebooks = useAppStore(s => s.expandedNotebooks)
    const loadNotebooks = useAppStore(s => s.loadNotebooks)
    const createNotebook = useAppStore(s => s.createNotebook)
    const renameNotebook = useAppStore(s => s.renameNotebook)
    const deleteNotebook = useAppStore(s => s.deleteNotebook)
    const selectNotebook = useAppStore(s => s.selectNotebook)
    const toggleNotebook = useAppStore(s => s.toggleNotebook)
    const createPage = useAppStore(s => s.createPage)
    const renamePage = useAppStore(s => s.renamePage)
    const deletePage = useAppStore(s => s.deletePage)
    const selectPage = useAppStore(s => s.selectPage)

    const [showNewNotebook, setShowNewNotebook] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)

    useEffect(() => { loadNotebooks() }, [])

    // Close on Escape via InputManager Modal layer
    useEffect(() => {
        return registerModal({ isOpen: () => isOpen, close: onClose })
    }, [isOpen, onClose])

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-[49] bg-black/20"
                    onClick={onClose}
                />
            )}

            {/* Panel */}
            <aside
                ref={panelRef}
                className={`fixed top-[38px] left-0 bottom-0 w-[280px] bg-sidebar border-r border-border-subtle flex flex-col z-[50] transition-transform duration-200 ease-out shadow-xl ${isOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                    <h1 className="text-[1.154rem] font-semibold tracking-tight text-text-primary flex items-center gap-1.5"><IconSparkles size={18} /> Notes</h1>
                    <button
                        onClick={() => setShowNewNotebook(true)}
                        className="w-7 h-7 flex items-center justify-center border-none bg-transparent text-text-secondary rounded-sm cursor-pointer transition-all duration-100 hover:bg-hover hover:text-text-primary"
                        title="New Notebook"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {showNewNotebook && (
                        <InlineInput
                            placeholder="Notebook name..."
                            onSubmit={(name) => { createNotebook(name); setShowNewNotebook(false) }}
                            onCancel={() => setShowNewNotebook(false)}
                        />
                    )}
                    {notebooks.map(nb => (
                        <NotebookItem
                            key={nb.id}
                            notebook={nb}
                            isActive={nb.id === activeNotebookId}
                            isExpanded={expandedNotebooks.has(nb.id)}
                            activePageId={activePageId}
                            onToggle={() => {
                                toggleNotebook(nb.id)
                                if (!expandedNotebooks.has(nb.id)) selectNotebook(nb.id)
                            }}
                            onSelectPage={(id) => { selectPage(id); onClose() }}
                            onCreatePage={(name) => createPage(nb.id, name)}
                            onRenamePage={renamePage}
                            onDeletePage={deletePage}
                            onRenameNotebook={(name) => renameNotebook(nb.id, name)}
                            onDeleteNotebook={() => deleteNotebook(nb.id)}
                        />
                    ))}
                </div>
            </aside>
        </>
    )
}

// ── Context Menu ───────────────────────────────────────────

interface ContextMenuProps {
    x: number
    y: number
    items: { label: string; danger?: boolean; onClick: () => void }[]
    onClose: () => void
}

function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [onClose])

    // Escape via InputManager Modal layer
    useEffect(() => {
        return registerModal({ isOpen: () => true, close: onClose })
    }, [onClose])

    return (
        <div
            ref={ref}
            className="fixed z-[999] bg-surface border border-border-default rounded-md shadow-lg py-1 min-w-[140px]"
            style={{ left: x, top: y }}
        >
            {items.map((item, i) => (
                <button
                    key={i}
                    onClick={() => { item.onClick(); onClose() }}
                    className={`w-full text-left px-3 py-1.5 text-[0.923rem] border-none bg-transparent cursor-pointer transition-colors duration-75 ${item.danger
                        ? 'text-error hover:bg-error/10'
                        : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                        }`}
                >
                    {item.label}
                </button>
            ))}
        </div>
    )
}

// ── Notebook Item ──────────────────────────────────────────

interface NotebookItemProps {
    notebook: Notebook
    isActive: boolean
    isExpanded: boolean
    activePageId: string | null
    onToggle: () => void
    onSelectPage: (id: string) => void
    onCreatePage: (name: string) => void
    onRenamePage: (id: string, name: string) => void
    onDeletePage: (id: string) => void
    onRenameNotebook: (name: string) => void
    onDeleteNotebook: () => void
}

function NotebookItem({
    notebook, isActive, isExpanded, activePageId,
    onToggle, onSelectPage, onCreatePage,
    onRenamePage, onDeletePage, onRenameNotebook, onDeleteNotebook,
}: NotebookItemProps) {
    const [showInlineInput, setShowInlineInput] = useState(false)
    const [pages, setPages] = useState<Page[]>([])
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'notebook' | 'page'; pageId?: string } | null>(null)
    const [renaming, setRenaming] = useState<{ type: 'notebook' | 'page'; pageId?: string } | null>(null)

    // Single unified effect: load pages when expanded or activePageId changes
    useEffect(() => {
        if (isExpanded) {
            api.listPages(notebook.id).then(p => setPages(p || []))
        }
    }, [isExpanded, activePageId, notebook.id])

    const handleNotebookContext = (e: React.MouseEvent) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'notebook' })
    }

    const handlePageContext = (e: React.MouseEvent, pageId: string) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'page', pageId })
    }

    return (
        <div className="mb-0.5">
            <div
                onClick={onToggle}
                onContextMenu={handleNotebookContext}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-sm cursor-pointer text-[1rem] font-medium transition-all duration-100 ${isActive ? 'bg-accent-muted text-text-accent' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                    }`}
            >
                <span className={`text-[0.769rem] transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                {renaming?.type === 'notebook' ? (
                    <InlineInput
                        placeholder="Notebook name..."
                        defaultValue={notebook.name}
                        onSubmit={(name) => { onRenameNotebook(name); setRenaming(null) }}
                        onCancel={() => setRenaming(null)}
                    />
                ) : (
                    <span className="flex-1 truncate">{notebook.name}</span>
                )}
            </div>

            {isExpanded && (
                <div className="pl-7">
                    {pages.map(page => (
                        <div
                            key={page.id}
                            onClick={() => onSelectPage(page.id)}
                            onContextMenu={(e) => handlePageContext(e, page.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm cursor-pointer text-[12.5px] transition-all duration-100 ${page.id === activePageId
                                ? 'text-text-primary bg-active'
                                : 'text-text-muted hover:bg-hover hover:text-text-secondary'
                                }`}
                        >
                            <span className="text-[0.769rem] opacity-50"><IconFile size={12} /></span>
                            {renaming?.type === 'page' && renaming.pageId === page.id ? (
                                <InlineInput
                                    placeholder="Page name..."
                                    defaultValue={page.name}
                                    onSubmit={(name) => {
                                        onRenamePage(page.id, name)
                                        setPages(prev => prev.map(p => p.id === page.id ? { ...p, name } : p))
                                        setRenaming(null)
                                    }}
                                    onCancel={() => setRenaming(null)}
                                />
                            ) : (
                                <span className="truncate">{page.name}</span>
                            )}
                        </div>
                    ))}

                    {showInlineInput ? (
                        <InlineInput
                            placeholder="Page name..."
                            onSubmit={async (name) => {
                                onCreatePage(name)
                                setShowInlineInput(false)
                                // Wait for backend, then refresh pages list
                                await new Promise(r => setTimeout(r, 100))
                                api.listPages(notebook.id).then(p => setPages(p || []))
                            }}
                            onCancel={() => setShowInlineInput(false)}
                        />
                    ) : (
                        <button
                            onClick={() => setShowInlineInput(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1 mt-0.5 rounded-sm cursor-pointer text-text-muted text-xs border-none bg-transparent w-full transition-all duration-100 hover:bg-hover hover:text-text-secondary"
                        >
                            <span>+</span> Add Page
                        </button>
                    )}
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    items={contextMenu.type === 'notebook' ? [
                        { label: 'Rename', onClick: () => setRenaming({ type: 'notebook' }) },
                        { label: 'Delete', danger: true, onClick: onDeleteNotebook },
                    ] : [
                        { label: 'Rename', onClick: () => setRenaming({ type: 'page', pageId: contextMenu.pageId }) },
                        { label: 'Delete', danger: true, onClick: () => { if (contextMenu.pageId) { onDeletePage(contextMenu.pageId); setPages(prev => prev.filter(p => p.id !== contextMenu.pageId)) } } },
                    ]}
                />
            )}
        </div>
    )
}

// ── Inline Input ───────────────────────────────────────────

function InlineInput({ placeholder, defaultValue, onSubmit, onCancel }: {
    placeholder: string
    defaultValue?: string
    onSubmit: (value: string) => void
    onCancel: () => void
}) {
    const ref = useRef<HTMLInputElement>(null)

    useEffect(() => {
        ref.current?.focus()
        if (defaultValue) ref.current?.select()
    }, [])

    const handleSubmit = useCallback(() => {
        const value = ref.current?.value.trim()
        if (value) onSubmit(value)
        else onCancel()
    }, [onSubmit, onCancel])

    return (
        <div className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
            <input
                ref={ref}
                type="text"
                defaultValue={defaultValue}
                placeholder={placeholder}
                className="w-full outline-none bg-elevated border border-accent rounded text-text-primary font-sans text-[1rem] px-2 py-1"
                onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') handleSubmit()
                    if (e.key === 'Escape') onCancel()
                }}
                onBlur={handleSubmit}
            />
        </div>
    )
}
