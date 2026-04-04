import { useState, useRef, useCallback } from 'react'
import { IconChevronRight, IconPlus } from '@tabler/icons-react'
import { PageItem } from './PageItem'
import type { Notebook, Page } from '../../bridge/wails'

interface Props {
    notebook: Notebook
    pages: Page[]
    isExpanded: boolean
    activePageId: string | null
    onToggle: (id: string) => void
    onSelectPage: (id: string) => void
    onRenamePage: (id: string, name: string) => void
    onRenameNotebook: (id: string, name: string) => void
    onNewPage: (notebookId: string) => void
    onContextMenu: (e: React.MouseEvent, type: 'notebook' | 'page', id: string) => void
}

export function NotebookItem({
    notebook, pages, isExpanded, activePageId,
    onToggle, onSelectPage, onRenamePage, onRenameNotebook, onNewPage, onContextMenu,
}: Props) {
    const [editing, setEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const startRename = useCallback(() => {
        setEditing(true)
        setTimeout(() => inputRef.current?.select(), 0)
    }, [])

    const confirmRename = useCallback(() => {
        const val = inputRef.current?.value.trim()
        if (val && val !== notebook.name) onRenameNotebook(notebook.id, val)
        setEditing(false)
    }, [notebook.id, notebook.name, onRenameNotebook])

    return (
        <div className="sb-notebook">
            <div
                className="sb-notebook-header"
                onClick={() => onToggle(notebook.id)}
                onDoubleClick={startRename}
                onContextMenu={e => onContextMenu(e, 'notebook', notebook.id)}
            >
                <IconChevronRight size={12} className={`sb-notebook-arrow ${isExpanded ? 'sb-expanded' : ''}`} />
                {editing ? (
                    <input
                        ref={inputRef}
                        className="sb-inline-input"
                        defaultValue={notebook.name}
                        onBlur={confirmRename}
                        onKeyDown={e => {
                            if (e.key === 'Enter') confirmRename()
                            if (e.key === 'Escape') setEditing(false)
                        }}
                        onClick={e => e.stopPropagation()}
                        autoFocus
                    />
                ) : (
                    <>
                        <span className="sb-notebook-name">{notebook.name}</span>
                        <button
                            className="sb-notebook-add"
                            onClick={e => { e.stopPropagation(); onNewPage(notebook.id) }}
                            title="New page"
                        >
                            <IconPlus size={12} />
                        </button>
                    </>
                )}
            </div>
            {isExpanded && (
                <div className="sb-notebook-pages">
                    {pages.map(page => (
                        <PageItem
                            key={page.id}
                            page={page}
                            isActive={page.id === activePageId}
                            onSelect={onSelectPage}
                            onRename={onRenamePage}
                            onContextMenu={(e, pageId) => onContextMenu(e, 'page', pageId)}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
