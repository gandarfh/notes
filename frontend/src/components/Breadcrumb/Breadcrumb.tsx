import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../../store'
import { registerModal } from '../../input'
import { IconNotebook, IconFile } from '@tabler/icons-react'

export function Breadcrumb({ onOpenPalette }: { onOpenPalette: () => void }) {
    const notebooks = useAppStore(s => s.notebooks)
    const activeNotebookId = useAppStore(s => s.activeNotebookId)
    const activePageId = useAppStore(s => s.activePageId)
    const pages = useAppStore(s => s.pages)
    const selectNotebook = useAppStore(s => s.selectNotebook)
    const selectPage = useAppStore(s => s.selectPage)
    const [openDropdown, setOpenDropdown] = useState<'notebook' | 'page' | null>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)

    const activeNotebook = notebooks.find(n => n.id === activeNotebookId)
    const activePage = pages.find(p => p.id === activePageId)

    // Close dropdown on outside click
    useEffect(() => {
        if (!openDropdown) return
        const onClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpenDropdown(null)
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [openDropdown])

    // Close dropdown on Escape via InputManager Modal layer
    useEffect(() => {
        return registerModal({
            isOpen: () => openDropdown !== null,
            close: () => setOpenDropdown(null),
        })
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
                        <button
                            key={nb.id}
                            className={`breadcrumb-dropdown-item ${nb.id === activeNotebookId ? 'active' : ''}`}
                            onClick={() => { selectNotebook(nb.id); setOpenDropdown(null) }}
                        >
                            <span className="breadcrumb-dropdown-icon"><IconNotebook size={14} /></span>
                            {nb.name}
                        </button>
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
                                <button
                                    key={p.id}
                                    className={`breadcrumb-dropdown-item ${p.id === activePageId ? 'active' : ''}`}
                                    onClick={() => { selectPage(p.id); setOpenDropdown(null) }}
                                >
                                    <span className="breadcrumb-dropdown-icon"><IconFile size={14} /></span>
                                    {p.name}
                                </button>
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
