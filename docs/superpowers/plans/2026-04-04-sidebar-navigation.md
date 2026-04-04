# Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace breadcrumb navigation with a persistent, collapsible sidebar showing the full notebook/page hierarchy with metadata and CRUD actions.

**Architecture:** A `Sidebar` component renders a tree of `NotebookItem` and `PageItem` components. Pages are loaded per-notebook on demand (via `api.listPages`) and cached in a local Map ref. The sidebar is positioned fixed-left with the main content shifted via CSS variable. The existing Breadcrumb is removed from App.tsx.

**Tech Stack:** React, Zustand (existing store), TypeScript, CSS (colocated with `.sb-` prefix)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/Sidebar/Sidebar.tsx` | Rewrite | Main sidebar: notebook list, collapse toggle, pages cache |
| `frontend/src/components/Sidebar/Sidebar.css` | Rewrite | All sidebar styles with `.sb-` prefix |
| `frontend/src/components/Sidebar/SidebarHeader.tsx` | Create | [+ New] button with dropdown |
| `frontend/src/components/Sidebar/NotebookItem.tsx` | Create | Expandable notebook row with inline rename |
| `frontend/src/components/Sidebar/PageItem.tsx` | Create | Page row with icon, name, date, active state |
| `frontend/src/components/Sidebar/ContextMenu.tsx` | Create | Right-click menu (rename, duplicate, delete) |
| `frontend/src/App.tsx` | Modify | Remove Breadcrumb, add Sidebar, adjust layout |
| `frontend/src/components/Toolbar/toolbar.css` | Modify | Adjust header to account for sidebar |

---

### Task 1: Create Sidebar CSS

**Files:**
- Rewrite: `frontend/src/components/Sidebar/Sidebar.css`

- [ ] **Step 1: Write the sidebar styles**

```css
/* ── Sidebar ──────────────────────────────────────── */

.sb-sidebar {
  position: fixed;
  top: 38px; /* below macOS titlebar drag area */
  left: 0;
  bottom: 0;
  width: var(--spacing-sidebar, 260px);
  background: var(--color-sidebar);
  border-right: 1px solid var(--color-border-subtle);
  z-index: 35;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: transform 0.2s ease;
  -webkit-app-region: no-drag;
}

.sb-sidebar.sb-collapsed {
  transform: translateX(-100%);
}

.sb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
  flex-shrink: 0;
}

.sb-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 8px 12px;
}

/* ── Notebook Item ────────────────────────────────── */

.sb-notebook {
  margin-bottom: 2px;
}

.sb-notebook-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  user-select: none;
  transition: background 0.1s;
}

.sb-notebook-header:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.sb-notebook-arrow {
  font-size: 10px;
  transition: transform 0.15s ease;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.sb-notebook-arrow.sb-expanded {
  transform: rotate(90deg);
}

.sb-notebook-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-notebook-count {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 400;
  flex-shrink: 0;
}

.sb-notebook-pages {
  padding-left: 20px;
}

/* ── Page Item ────────────────────────────────────── */

.sb-page {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 13px;
  user-select: none;
  transition: background 0.1s;
}

.sb-page:hover {
  background: var(--color-hover);
}

.sb-page.sb-active {
  background: var(--color-hover);
  color: var(--color-text-primary);
  font-weight: 500;
}

.sb-page-icon {
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0.6;
}

.sb-page-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-page-date {
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

/* ── Inline Input ─────────────────────────────────── */

.sb-inline-input {
  width: 100%;
  background: var(--color-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 13px;
  color: var(--color-text-primary);
  outline: none;
}

.sb-inline-input:focus {
  border-color: var(--color-text-accent);
}

/* ── Context Menu ─────────────────────────────────── */

.sb-context-menu {
  position: fixed;
  background: var(--color-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 4px;
  min-width: 140px;
  z-index: 999;
}

.sb-context-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
}

.sb-context-item:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.sb-context-item.sb-danger {
  color: var(--color-error);
}

.sb-context-item.sb-danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.sb-context-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 4px 0;
}

/* ── New Button ───────────────────────────────────── */

.sb-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;
}

.sb-new-btn:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.sb-new-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 12px;
  right: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 4px;
  z-index: 50;
}

/* ── Toggle Button ────────────────────────────────── */

.sb-toggle {
  position: fixed;
  bottom: 12px;
  left: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  z-index: 36;
  transition: opacity 0.2s;
}

.sb-toggle:hover {
  color: var(--color-text-primary);
  background: var(--color-hover);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar/Sidebar.css
git commit -m "style: add sidebar CSS with sb- prefix"
```

---

### Task 2: Create ContextMenu component

**Files:**
- Create: `frontend/src/components/Sidebar/ContextMenu.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/Sidebar/ContextMenu.tsx
import { useEffect, useRef } from 'react'

interface MenuItem {
    label: string
    action: () => void
    danger?: boolean
}

interface Props {
    x: number
    y: number
    items: MenuItem[]
    onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [onClose])

    return (
        <div ref={ref} className="sb-context-menu" style={{ left: x, top: y }}>
            {items.map((item, i) =>
                item.label === '---' ? (
                    <div key={i} className="sb-context-divider" />
                ) : (
                    <button
                        key={i}
                        className={`sb-context-item ${item.danger ? 'sb-danger' : ''}`}
                        onClick={() => { item.action(); onClose() }}
                    >
                        {item.label}
                    </button>
                )
            )}
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar/ContextMenu.tsx
git commit -m "feat: add ContextMenu component for sidebar"
```

---

### Task 3: Create PageItem component

**Files:**
- Create: `frontend/src/components/Sidebar/PageItem.tsx`

- [ ] **Step 1: Create the component**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar/PageItem.tsx
git commit -m "feat: add PageItem component for sidebar"
```

---

### Task 4: Create NotebookItem component

**Files:**
- Create: `frontend/src/components/Sidebar/NotebookItem.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/Sidebar/NotebookItem.tsx
import { useState, useRef, useCallback } from 'react'
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
    onContextMenu: (e: React.MouseEvent, type: 'notebook' | 'page', id: string) => void
}

export function NotebookItem({
    notebook, pages, isExpanded, activePageId,
    onToggle, onSelectPage, onRenamePage, onRenameNotebook, onContextMenu,
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
                <span className={`sb-notebook-arrow ${isExpanded ? 'sb-expanded' : ''}`}>
                    ▶
                </span>
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
                        <span className="sb-notebook-count">{pages.length || ''}</span>
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar/NotebookItem.tsx
git commit -m "feat: add NotebookItem component for sidebar"
```

---

### Task 5: Create SidebarHeader component

**Files:**
- Create: `frontend/src/components/Sidebar/SidebarHeader.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/Sidebar/SidebarHeader.tsx
import { useState, useRef, useEffect } from 'react'

interface Props {
    onNewNotebook: () => void
    onNewPage: () => void
    onNewBoard: () => void
    hasActiveNotebook: boolean
}

export function SidebarHeader({ onNewNotebook, onNewPage, onNewBoard, hasActiveNotebook }: Props) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    return (
        <div className="sb-header" ref={ref}>
            <button className="sb-new-btn" onClick={() => setOpen(!open)}>
                + New
            </button>
            {open && (
                <div className="sb-new-dropdown">
                    <button
                        className="sb-context-item"
                        onClick={() => { onNewNotebook(); setOpen(false) }}
                    >
                        New Notebook
                    </button>
                    {hasActiveNotebook && (
                        <>
                            <button
                                className="sb-context-item"
                                onClick={() => { onNewPage(); setOpen(false) }}
                            >
                                New Page
                            </button>
                            <button
                                className="sb-context-item"
                                onClick={() => { onNewBoard(); setOpen(false) }}
                            >
                                New Board
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar/SidebarHeader.tsx
git commit -m "feat: add SidebarHeader component with new dropdown"
```

---

### Task 6: Create main Sidebar component

**Files:**
- Rewrite: `frontend/src/components/Sidebar/Sidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/Sidebar/Sidebar.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import type { Page } from '../../bridge/wails'
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

    const contextMenuItems = contextMenu ? [
        { label: 'Rename', action: () => { /* handled by double-click */ setContextMenu(null) } },
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
                ≡
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/joao/gandarfh/notes/frontend && npx tsc --noEmit`
Expected: No errors related to Sidebar

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar/Sidebar.tsx
git commit -m "feat: add main Sidebar component with pages cache and CRUD"
```

---

### Task 7: Integrate Sidebar into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Toolbar/toolbar.css`

- [ ] **Step 1: Update App.tsx — remove Breadcrumb, add Sidebar**

Replace Breadcrumb import with Sidebar:

```diff
-import { Breadcrumb } from './components/Breadcrumb/Breadcrumb'
+import { Sidebar } from './components/Sidebar/Sidebar'
```

Replace JSX layout:

```diff
 return (
-    <div className="w-full h-full relative">
-        <header className="app-header">
-            <div className="header-left">
-                <Breadcrumb />
-            </div>
+    <div className="w-full h-full relative sb-layout">
+        <Sidebar />
+        <header className="app-header">
+            <div className="header-left" />
             <Toolbar
```

- [ ] **Step 2: Update toolbar.css — adjust header for sidebar**

Add to end of `toolbar.css`:

```css
/* ── Sidebar layout adjustments ────────────────── */

.sb-layout > .app-header {
    left: var(--spacing-sidebar, 260px);
    padding-left: 12px;
    transition: left 0.2s ease;
}

.sb-layout > main {
    margin-left: var(--spacing-sidebar, 260px);
    transition: margin-left 0.2s ease;
}

/* When sidebar is collapsed */
.sb-layout:has(.sb-collapsed) > .app-header {
    left: 0;
    padding-left: 78px;
}

.sb-layout:has(.sb-collapsed) > main {
    margin-left: 0;
}
```

- [ ] **Step 3: Verify TypeScript compiles and lint passes**

Run: `cd /Users/joao/gandarfh/notes/frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Toolbar/toolbar.css
git commit -m "feat: integrate sidebar into app layout, remove breadcrumb"
```

---

### Task 8: Manual testing and fixes

- [ ] **Step 1: Run dev server**

Run: `cd /Users/joao/gandarfh/notes && make dev`

- [ ] **Step 2: Test checklist**

1. Sidebar visible on left with notebooks list
2. Click notebook → expands, shows pages with icons and dates
3. Click page → navigates, page highlighted
4. Double-click notebook name → inline rename
5. Double-click page name → inline rename
6. Right-click notebook → context menu with Delete
7. Right-click page → context menu with Delete
8. [+ New] dropdown → creates notebook, page, or board
9. Cmd+\ → toggles sidebar
10. Collapse state persists on reload
11. Header and content shift when sidebar collapses/expands
12. Command palette (Cmd+K) still works

- [ ] **Step 3: Commit fixes**

```bash
git add -u
git commit -m "fix: sidebar integration adjustments"
```
