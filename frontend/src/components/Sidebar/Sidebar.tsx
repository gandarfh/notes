// frontend/src/components/Sidebar/Sidebar.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import type { Page } from '../../bridge/wails'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { SidebarHeader } from './SidebarHeader'
import { NotebookItem } from './NotebookItem'
import { ContextMenu } from './ContextMenu'
import './Sidebar.css'

interface ContextMenuState {
    x: number
    y: number
    type: 'notebook' | 'page'
    id: string
}

export function Sidebar() {
    const notebooks = useAppStore(s => s.notebooks)
    const activeNotebookId = useAppStore(s => s.activeNotebookId)
    const activePageId = useAppStore(s => s.activePageId)
    const expandedNotebooks = useAppStore(s => s.expandedNotebooks)
    const toggleNotebook = useAppStore(s => s.toggleNotebook)
    const selectPage = useAppStore(s => s.selectPage)
    const createNotebook = useAppStore(s => s.createNotebook)
    const createPage = useAppStore(s => s.createPage)
    const createBoardPage = useAppStore(s => s.createBoardPage)
    const renameNotebook = useAppStore(s => s.renameNotebook)
    const renamePage = useAppStore(s => s.renamePage)
    const deleteNotebook = useAppStore(s => s.deleteNotebook)
    const deletePage = useAppStore(s => s.deletePage)
    const selectNotebook = useAppStore(s => s.selectNotebook)

    // Local cache of pages per notebook (store only holds active notebook's pages)
    const pagesCache = useRef<Map<string, Page[]>>(new Map())
    const [pagesCacheVersion, setPagesCacheVersion] = useState(0)
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

    const [collapsed, setCollapsed] = useState(() =>
        localStorage.getItem('notes:sidebarCollapsed') === 'true'
    )

    const toggleCollapse = useCallback(() => {
        setCollapsed(prev => {
            localStorage.setItem('notes:sidebarCollapsed', String(!prev))
            return !prev
        })
    }, [])

    // Keyboard shortcut: Cmd+\
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
                e.preventDefault()
                toggleCollapse()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [toggleCollapse])

    // Load pages when a notebook is expanded
    const handleToggle = useCallback(async (notebookId: string) => {
        toggleNotebook(notebookId)
        if (!pagesCache.current.has(notebookId)) {
            const pages = await api.listPages(notebookId)
            pagesCache.current.set(notebookId, pages || [])
            setPagesCacheVersion(v => v + 1)
        }
    }, [toggleNotebook])

    // Keep active notebook's pages in sync with store
    const storePages = useAppStore(s => s.pages)
    useEffect(() => {
        if (activeNotebookId) {
            pagesCache.current.set(activeNotebookId, storePages)
            setPagesCacheVersion(v => v + 1)
        }
    }, [activeNotebookId, storePages])

    const handleSelectPage = useCallback(async (pageId: string) => {
        // Find which notebook this page belongs to
        for (const [nbId, pages] of pagesCache.current) {
            if (pages.some(p => p.id === pageId)) {
                if (nbId !== activeNotebookId) {
                    await selectNotebook(nbId)
                }
                break
            }
        }
        await selectPage(pageId)
    }, [activeNotebookId, selectNotebook, selectPage])

    const handleContextMenu = useCallback((e: React.MouseEvent, type: 'notebook' | 'page', id: string) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, type, id })
    }, [])

    const handleNewNotebook = useCallback(async () => {
        await createNotebook('New Notebook')
    }, [createNotebook])

    const handleNewPage = useCallback(async () => {
        if (!activeNotebookId) return
        await createPage(activeNotebookId, 'New Page')
    }, [activeNotebookId, createPage])

    const handleNewBoard = useCallback(async () => {
        if (!activeNotebookId) return
        await createBoardPage(activeNotebookId, 'New Board')
    }, [activeNotebookId, createBoardPage])

    const handleDelete = useCallback(async () => {
        if (!contextMenu) return
        if (contextMenu.type === 'notebook') {
            await deleteNotebook(contextMenu.id)
            pagesCache.current.delete(contextMenu.id)
        } else {
            await deletePage(contextMenu.id)
            // Remove from cache
            for (const [nbId, pages] of pagesCache.current) {
                const filtered = pages.filter(p => p.id !== contextMenu.id)
                if (filtered.length !== pages.length) {
                    pagesCache.current.set(nbId, filtered)
                    break
                }
            }
        }
        setContextMenu(null)
        setPagesCacheVersion(v => v + 1)
    }, [contextMenu, deleteNotebook, deletePage])

    // suppress unused warning — version is used to trigger re-renders
    void pagesCacheVersion

    const contextMenuItems = contextMenu ? [
        { label: 'Rename', action: () => { setContextMenu(null) } },
        { label: '---', action: () => {} },
        { label: 'Delete', action: handleDelete, danger: true },
    ] : []

    return (
        <>
            <div className={`sb-sidebar ${collapsed ? 'sb-collapsed' : ''}`}>
                <SidebarHeader
                    onNewNotebook={handleNewNotebook}
                    onNewPage={handleNewPage}
                    onNewBoard={handleNewBoard}
                    hasActiveNotebook={!!activeNotebookId}
                />
                <div className="sb-tree">
                    {notebooks.map(nb => (
                        <NotebookItem
                            key={nb.id}
                            notebook={nb}
                            pages={pagesCache.current.get(nb.id) || []}
                            isExpanded={expandedNotebooks.has(nb.id)}
                            activePageId={activePageId}
                            onToggle={handleToggle}
                            onSelectPage={handleSelectPage}
                            onRenamePage={renamePage}
                            onRenameNotebook={renameNotebook}
                            onContextMenu={handleContextMenu}
                        />
                    ))}
                </div>
            </div>

            <button
                className="sb-toggle"
                onClick={toggleCollapse}
                title="Toggle sidebar (⌘\\)"
            >
                <IconLayoutSidebar size={16} />
            </button>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenuItems}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </>
    )
}
