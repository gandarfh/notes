# Sidebar Navigation

**Date:** 2026-04-04
**Status:** Approved

## Summary

Replace breadcrumb-based navigation with a persistent, collapsible sidebar that shows the full notebook/page hierarchy with metadata. Command palette remains unchanged.

## Current State

- Navigation via breadcrumb dropdowns (click to see notebooks, click again for pages)
- Command palette for search/quick navigation (Cmd+K)
- No persistent visibility of structure — user must open dropdowns to see what exists
- Breadcrumb component at `frontend/src/components/Breadcrumb/Breadcrumb.tsx`

## Design

### Layout

```
┌──────────────────────────────────────────────────────┐
│ macOS titlebar drag area (38px)                      │
├───────────┬──────────────────────────────────────────┤
│ SIDEBAR   │  TOOLBAR (center pill)        [settings] │
│ 280px     │──────────────────────────────────────────│
│           │                                          │
│ [+ New v] │  Document / Dashboard / Split            │
│ ────────  │                                          │
│ v 2026    │  Page content area                       │
│   doc lucas    03/30 │                               │
│   doc tomaram  03/30 │                               │
│   cvs reuniao  03/28 │                               │
│                      │                               │
│ > projetos           │                               │
│                      │                               │
│ v rascunhos          │                               │
│   doc teste    04/01 │                               │
│                      │                               │
│───────────│                                          │
│ [=] toggle│                                          │
└───────────┴──────────────────────────────────────────┘
```

- Sidebar: 280px fixed left panel, full height below titlebar
- Collapsible via toggle button or Cmd+\
- Collapse state persisted in localStorage
- Main content shifts right when sidebar is open, takes full width when collapsed

### Notebook Item

```
v 2026-03-30                    3
```

- Expand/collapse arrow (v / >)
- Notebook name (truncated with ellipsis)
- Page count badge (right-aligned, muted)
- Click to expand/collapse
- Double-click name to rename (inline input)
- Right-click for context menu

### Page Item

```
  doc tomaram essa deci...  03/30
```

- Indented under parent notebook
- Icon: document type (doc for board, cvs for canvas)
- Name (truncated with ellipsis)
- Date (right-aligned, short format: MM/DD or "today"/"yesterday")
- Click to navigate (selects page, loads content)
- Active page: highlighted background
- Double-click name to rename
- Right-click for context menu

### Sidebar Header

- [+ New] button with dropdown:
  - "New Notebook" — creates notebook, shows inline input at end of list
  - "New Page" — creates canvas page in active notebook, inline input
  - "New Board" — creates board/document page in active notebook, inline input
- Enter confirms, Escape cancels

### Context Menu (right-click)

```
┌──────────────┐
│ Rename       │
│ Duplicate    │
│ ────────     │
│ Delete       │
└──────────────┘
```

- Notebooks with pages: delete shows confirmation
- Pages: delete is immediate

### Keyboard Shortcuts

- `Cmd+\` — toggle sidebar
- Arrow keys — navigate items when sidebar is focused
- Enter — expand notebook or open page
- Command palette (Cmd+K) — unchanged, still works for quick search

## New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/Sidebar/Sidebar.tsx` | Main sidebar component (rewrite from scratch) |
| `frontend/src/components/Sidebar/Sidebar.css` | Sidebar styles (prefixed `.sb-`) |
| `frontend/src/components/Sidebar/NotebookItem.tsx` | Expandable notebook with context menu |
| `frontend/src/components/Sidebar/PageItem.tsx` | Page item with icon, name, date |
| `frontend/src/components/Sidebar/SidebarHeader.tsx` | Header with [+ New] dropdown |
| `frontend/src/components/Sidebar/ContextMenu.tsx` | Reusable right-click menu |

## Modified Files

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | Add Sidebar, remove Breadcrumb import, adjust layout to grid with sidebar + main |
| `frontend/src/App.css` or equivalent | Layout styles for sidebar + content grid |

## What Does NOT Change

- **Command palette** — stays as-is (Cmd+K for search/navigation)
- **Toolbar** — stays centered in header
- **Store (notebookSlice.ts)** — already has all needed state and actions (CRUD, expand/collapse, select)
- **Backend Go** — no changes needed
- **Page components** — Canvas, BoardPage, DocumentView unchanged

## CSS Conventions

- Colocated CSS file (`Sidebar.css`)
- Class prefix `.sb-` for all sidebar classes
- Theme colors via `var(--color-*)` — no hardcoded hex
- Tailwind for layout/spacing where simple
- CSS file for complex selectors, hover states, transitions

## Interaction Flow

1. App loads → sidebar shows notebooks from store, expanded state from localStorage
2. User clicks notebook → expands/collapses, shows/hides pages
3. User clicks page → navigates to it (loads content), page highlighted
4. User right-clicks → context menu with rename/duplicate/delete
5. User double-clicks name → inline rename input
6. User clicks [+ New] → dropdown, selects type, inline input appears
7. User presses Cmd+\ → sidebar collapses/expands
8. User presses Cmd+K → command palette opens (unchanged)

## Not Included (future)

- Drag & drop to reorder pages or move between notebooks
- Nested notebooks (sub-notebooks)
- Search within sidebar (command palette handles search)
- Favorites/pinned pages
