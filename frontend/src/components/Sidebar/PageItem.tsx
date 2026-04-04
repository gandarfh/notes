// frontend/src/components/Sidebar/PageItem.tsx
import { useState, useRef, useCallback } from 'react'
import type { Page } from '../../bridge/wails'

interface Props {
    page: Page
    isActive: boolean
    onSelect: (id: string) => void
    onRename: (id: string, name: string) => void
    onContextMenu: (e: React.MouseEvent, pageId: string) => void
}

function formatDate(dateStr: string): string {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'hoje'
    if (days === 1) return 'ontem'
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export function PageItem({ page, isActive, onSelect, onRename, onContextMenu }: Props) {
    const [editing, setEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const startRename = useCallback(() => {
        setEditing(true)
        setTimeout(() => inputRef.current?.select(), 0)
    }, [])

    const confirmRename = useCallback(() => {
        const val = inputRef.current?.value.trim()
        if (val && val !== page.name) onRename(page.id, val)
        setEditing(false)
    }, [page.id, page.name, onRename])

    const icon = page.pageType === 'board' ? '📋' : '📄'

    if (editing) {
        return (
            <div className="sb-page">
                <span className="sb-page-icon">{icon}</span>
                <input
                    ref={inputRef}
                    className="sb-inline-input"
                    defaultValue={page.name}
                    onBlur={confirmRename}
                    onKeyDown={e => {
                        if (e.key === 'Enter') confirmRename()
                        if (e.key === 'Escape') setEditing(false)
                    }}
                    autoFocus
                />
            </div>
        )
    }

    return (
        <div
            className={`sb-page ${isActive ? 'sb-active' : ''}`}
            onClick={() => onSelect(page.id)}
            onDoubleClick={startRename}
            onContextMenu={e => onContextMenu(e, page.id)}
        >
            <span className="sb-page-icon">{icon}</span>
            <span className="sb-page-name">{page.name}</span>
            <span className="sb-page-date">{formatDate(page.updatedAt)}</span>
        </div>
    )
}
