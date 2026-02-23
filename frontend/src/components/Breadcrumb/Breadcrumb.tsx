import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store'
import { registerModal } from '../../input'
import { IconNotebook, IconFile, IconPencil, IconTrash } from '@tabler/icons-react'

// ── Inline rename input ──
function RenameInput({ value, onRename, onCancel }: { value: string; onRename: (name: string) => void; onCancel: () => void }) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [name, setName] = useState(value)

    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])

    const commit = useCallback(() => {
        const trimmed = name.trim()
        if (trimmed && trimmed !== value) {
            onRename(trimmed)
        } else {
            onCancel()
        }
    }, [name, value, onRename, onCancel])

    return (
        <input
            ref={inputRef}
            className="breadcrumb-rename-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') onCancel()
                e.stopPropagation()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        />
    )
}

export function Breadcrumb({ onOpenPalette }: { onOpenPalette: () => void }) {
    const notebooks = useAppStore(s => s.notebooks)
    const activeNotebookId = useAppStore(s => s.activeNotebookId)
    const activePageId = useAppStore(s => s.activePageId)
    const pages = useAppStore(s => s.pages)
    const selectNotebook = useAppStore(s => s.selectNotebook)
    const selectPage = useAppStore(s => s.selectPage)
    const renameNotebook = useAppStore(s => s.renameNotebook)
    const renamePage = useAppStore(s => s.renamePage)
    const deleteNotebook = useAppStore(s => s.deleteNotebook)
    const deletePage = useAppStore(s => s.deletePage)
    const [openDropdown, setOpenDropdown] = useState<'notebook' | 'page' | null>(null)
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)

    const activeNotebook = notebooks.find(n => n.id === activeNotebookId)
    const activePage = pages.find(p => p.id === activePageId)

    // Close dropdown on outside click
    useEffect(() => {
        if (!openDropdown) return
        const onClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpenDropdown(null)
                setRenamingId(null)
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [openDropdown])

    // Close dropdown on Escape via InputManager Modal layer
    useEffect(() => {
        return registerModal({
            isOpen: () => openDropdown !== null,
            close: () => { setOpenDropdown(null); setRenamingId(null) },
        })
    }, [openDropdown])

    useEffect(() => {
        if (!openDropdown) setRenamingId(null)
    }, [openDropdown])

    return (
        <div className="breadcrumb-bar" ref={dropdownRef}>
            {/* Notebook selector */}
            <button
                className="breadcrumb-segment"
                onClick={() => setOpenDropdown(openDropdown === 'notebook' ? null : 'notebook')}
            >
                <span className="breadcrumb-icon"><IconNotebook size={14} /></span>
                <span className="breadcrumb-label">{activeNotebook?.name || 'Select Notebook'}</span>
                <span className="breadcrumb-chevron">▾</span>
            </button>

            {openDropdown === 'notebook' && (
                <div className="breadcrumb-dropdown">
                    {notebooks.map(nb => (
                        <div key={nb.id} className={`breadcrumb-dropdown-item ${nb.id === activeNotebookId ? 'active' : ''}`}>
                            {renamingId === nb.id ? (
                                <>
                                    <span className="breadcrumb-dropdown-icon"><IconNotebook size={14} /></span>
                                    <RenameInput
                                        value={nb.name}
                                        onRename={(name) => { renameNotebook(nb.id, name); setRenamingId(null) }}
                                        onCancel={() => setRenamingId(null)}
                                    />
                                </>
                            ) : (
                                <>
                                    <span
                                        className="breadcrumb-dropdown-label"
                                        onClick={() => { selectNotebook(nb.id); setOpenDropdown(null) }}
                                    >
                                        <span className="breadcrumb-dropdown-icon"><IconNotebook size={14} /></span>
                                        {nb.name}
                                    </span>
                                    <span className="breadcrumb-dropdown-actions">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setRenamingId(nb.id) }}
                                            title="Rename"
                                        ><IconPencil size={12} /></button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteNotebook(nb.id); setOpenDropdown(null) }}
                                            title="Delete"
                                        ><IconTrash size={12} /></button>
                                    </span>
                                </>
                            )}
                        </div>
                    ))}
                    {notebooks.length === 0 && (
                        <div className="breadcrumb-dropdown-empty">No notebooks</div>
                    )}
                </div>
            )}

            {/* Separator */}
            {activeNotebook && (
                <>
                    <span className="breadcrumb-sep">/</span>

                    {/* Page selector */}
                    <button
                        className="breadcrumb-segment"
                        onClick={() => setOpenDropdown(openDropdown === 'page' ? null : 'page')}
                    >
                        <span className="breadcrumb-icon"><IconFile size={14} /></span>
                        <span className="breadcrumb-label">{activePage?.name || 'Select Page'}</span>
                        <span className="breadcrumb-chevron">▾</span>
                    </button>

                    {openDropdown === 'page' && (
                        <div className="breadcrumb-dropdown breadcrumb-dropdown-page">
                            {pages.map(p => (
                                <div key={p.id} className={`breadcrumb-dropdown-item ${p.id === activePageId ? 'active' : ''}`}>
                                    {renamingId === p.id ? (
                                        <>
                                            <span className="breadcrumb-dropdown-icon"><IconFile size={14} /></span>
                                            <RenameInput
                                                value={p.name}
                                                onRename={(name) => { renamePage(p.id, name); setRenamingId(null) }}
                                                onCancel={() => setRenamingId(null)}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <span
                                                className="breadcrumb-dropdown-label"
                                                onClick={() => { selectPage(p.id); setOpenDropdown(null) }}
                                            >
                                                <span className="breadcrumb-dropdown-icon"><IconFile size={14} /></span>
                                                {p.name}
                                            </span>
                                            <span className="breadcrumb-dropdown-actions">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setRenamingId(p.id) }}
                                                    title="Rename"
                                                ><IconPencil size={12} /></button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deletePage(p.id); setOpenDropdown(null) }}
                                                    title="Delete"
                                                ><IconTrash size={12} /></button>
                                            </span>
                                        </>
                                    )}
                                </div>
                            ))}
                            {pages.length === 0 && (
                                <div className="breadcrumb-dropdown-empty">No pages</div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* Search shortcut hint */}
            <button
                className="breadcrumb-search-hint"
                onClick={onOpenPalette}
                title="Search & Navigate (⌘K)"
            >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span>
                    <kbd className="px-1.5 py-0.5 rounded text-text-secondary text-[14px] font-mono border border-border-subtle">⌘</kbd> <kbd className="px-1.5 py-0.5 rounded text-text-secondary text-[14px] font-mono border border-border-subtle">k</kbd>
                </span>
            </button>
        </div>
    )
}
