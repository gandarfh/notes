import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IconTable, IconLayoutKanban, IconCalendar } from '@tabler/icons-react'
import type { SavedView } from './types'

// ── View Switcher ──────────────────────────────────────────
// Tab bar for switching between saved views with add/rename/delete.

export type ViewType = 'table' | 'kanban' | 'calendar'

const VIEW_ICON_COMPONENTS: Record<string, React.FC<{ size?: number }>> = {
    table: IconTable,
    kanban: IconLayoutKanban,
    calendar: IconCalendar,
}

interface ViewSwitcherProps {
    views: SavedView[]
    activeViewId: string
    onSelectView: (viewId: string) => void
    onAddView: (layout: ViewType) => void
    onRenameView: (viewId: string, name: string) => void
    onDeleteView: (viewId: string) => void
    onDuplicateView: (viewId: string) => void
}

export function ViewSwitcher({ views, activeViewId, onSelectView, onAddView, onRenameView, onDeleteView, onDuplicateView }: ViewSwitcherProps) {
    const [showMenu, setShowMenu] = useState(false)
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
    const [contextViewId, setContextViewId] = useState<string | null>(null)
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [showAddMenu, setShowAddMenu] = useState(false)
    const [addMenuPos, setAddMenuPos] = useState({ top: 0, left: 0 })

    const handleContextMenu = (e: React.MouseEvent, viewId: string) => {
        e.preventDefault()
        setContextViewId(viewId)
        setMenuPos({ top: e.clientY, left: e.clientX })
        setShowMenu(true)
    }

    const startRename = (viewId: string) => {
        const view = views.find(v => v.id === viewId)
        if (view) {
            setRenamingId(viewId)
            setRenameValue(view.name)
        }
        setShowMenu(false)
    }

    const commitRename = () => {
        if (renamingId && renameValue.trim()) {
            onRenameView(renamingId, renameValue.trim())
        }
        setRenamingId(null)
    }

    return (
        <div className="ldb-view-switcher">
            {views.map(v => (
                <button
                    key={v.id}
                    className={`ldb-view-tab ${v.id === activeViewId ? 'active' : ''}`}
                    onClick={() => onSelectView(v.id)}
                    onContextMenu={e => handleContextMenu(e, v.id)}
                    title={v.name}
                >
                    <span className="ldb-view-tab-icon">{(() => { const I = VIEW_ICON_COMPONENTS[v.layout] || IconTable; return <I size={14} /> })()}</span>
                    {renamingId === v.id ? (
                        <input
                            className="ldb-view-tab-rename"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={e => {
                                if (e.key === 'Enter') commitRename()
                                if (e.key === 'Escape') setRenamingId(null)
                                e.stopPropagation()
                            }}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <span className="ldb-view-tab-label">{v.name}</span>
                    )}
                </button>
            ))}

            {/* Add view button */}
            <div className="ldb-view-add-group">
                <button
                    className="ldb-view-add-btn"
                    title="Add view"
                    onClick={e => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setAddMenuPos({ top: rect.bottom + 4, left: rect.left })
                        setShowAddMenu(true)
                    }}
                >
                    +
                </button>
            </div>

            {/* Add view type menu */}
            {showAddMenu && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => setShowAddMenu(false)} />
                    <div className="ldb-context-menu" style={{ position: 'fixed', top: addMenuPos.top, left: addMenuPos.left, zIndex: 9999 }}>
                        <button onClick={() => { onAddView('table'); setShowAddMenu(false) }}>
                            <IconTable size={14} /> Table
                        </button>
                        <button onClick={() => { onAddView('kanban'); setShowAddMenu(false) }}>
                            <IconLayoutKanban size={14} /> Kanban
                        </button>
                        <button onClick={() => { onAddView('calendar'); setShowAddMenu(false) }}>
                            <IconCalendar size={14} /> Calendar
                        </button>
                    </div>
                </>,
                document.body,
            )}

            {/* Context menu */}
            {showMenu && contextViewId && createPortal(
                <>
                    <div className="ldb-backdrop" onClick={() => setShowMenu(false)} />
                    <div className="ldb-context-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}>
                        <button onClick={() => startRename(contextViewId)}>Rename</button>
                        <button onClick={() => { onDuplicateView(contextViewId); setShowMenu(false) }}>Duplicate</button>
                        {views.length > 1 && (
                            <button className="danger" onClick={() => { onDeleteView(contextViewId); setShowMenu(false) }}>Delete</button>
                        )}
                    </div>
                </>,
                document.body,
            )}
        </div>
    )
}
