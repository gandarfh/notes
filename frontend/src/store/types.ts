import type { Block, Connection, Notebook, Page, PageState } from '../bridge/wails'
import { api, onEvent } from '../bridge/wails'

// ── Types ──────────────────────────────────────────────────

export interface ViewportState {
    x: number
    y: number
    zoom: number
}

// ── Notebook Slice ─────────────────────────────────────────

export interface NotebookSlice {
    notebooks: Notebook[]
    pages: Page[]
    activeNotebookId: string | null
    activePageId: string | null
    expandedNotebooks: Set<string>

    loadNotebooks: () => Promise<void>
    createNotebook: (name: string) => Promise<void>
    renameNotebook: (id: string, name: string) => Promise<void>
    deleteNotebook: (id: string) => Promise<void>

    selectNotebook: (id: string) => Promise<void>
    toggleNotebook: (id: string) => void

    loadPages: (notebookId: string) => Promise<void>
    createPage: (notebookId: string, name: string) => Promise<void>
    renamePage: (id: string, name: string) => Promise<void>
    deletePage: (id: string) => Promise<void>
    selectPage: (id: string) => Promise<void>
}

// ── Canvas Slice ───────────────────────────────────────────

export interface CanvasSlice {
    viewport: ViewportState

    setViewport: (x: number, y: number, zoom: number) => void
    pan: (dx: number, dy: number) => void
    zoomTo: (zoom: number, cx?: number, cy?: number) => void
    resetZoom: () => void
    saveViewport: () => void
}

// ── Block Slice ────────────────────────────────────────────

export interface BlockSlice {
    blocks: Map<string, Block>
    selectedBlockId: string | null
    editingBlockId: string | null
    scrollToLine: number | null

    setBlocks: (blocks: Block[]) => void
    addBlock: (block: Block) => void
    removeBlock: (id: string) => void
    updateBlock: (id: string, updates: Partial<Block>) => void
    selectBlock: (id: string | null) => void
    setEditing: (id: string | null) => void
    moveBlock: (id: string, x: number, y: number) => void
    resizeBlock: (id: string, w: number, h: number) => void

    createBlock: (type: string, x: number, y: number, w: number, h: number) => Promise<Block | null>
    deleteBlock: (id: string) => Promise<void>
    saveBlockPosition: (id: string) => void
    saveBlockContent: (id: string, content: string) => void
}

// ── Drawing Slice ──────────────────────────────────────────

import type { DrawingSubTool } from '../drawing/types'
export type { DrawingSubTool }

export interface ElementStyleDefaults {
    strokeColor: string
    strokeWidth: number
    backgroundColor: string
    fontSize: number
    fontFamily: string
    fontWeight: number
    textColor: string
    borderRadius: number
    opacity: number
    fillStyle: string
    strokeDasharray: string
    textAlign: string
    verticalAlign: string
}

export type ElementTypeCategory = 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'freedraw' | 'text'

export type BoardStyle = 'clean' | 'sketchy'

export interface DrawingSlice {
    drawingData: string
    drawingSubTool: DrawingSubTool
    boardStyle: BoardStyle
    styleDefaults: Record<ElementTypeCategory, ElementStyleDefaults>

    setDrawingData: (data: string) => void
    setDrawingSubTool: (tool: DrawingSubTool) => void
    setBoardStyle: (style: BoardStyle) => void
    setStyleDefaults: (type: ElementTypeCategory, patch: Partial<ElementStyleDefaults>) => void
    getStyleDefaults: (type: ElementTypeCategory) => ElementStyleDefaults
    saveDrawingData: () => void
}

// ── Connection Slice ───────────────────────────────────────

export interface ConnectionSlice {
    connections: Connection[]

    setConnections: (connections: Connection[]) => void
    addConnection: (conn: Connection) => void
    removeConnection: (id: string) => void
    updateConnection: (id: string, label: string, color: string, style: string) => void
    createConnection: (fromId: string, toId: string) => Promise<void>
    deleteConnection: (id: string) => Promise<void>
}

// ── Combined Store ─────────────────────────────────────────

export type AppState = NotebookSlice & CanvasSlice & BlockSlice & DrawingSlice & ConnectionSlice & {
    /** Load full page state (blocks + connections + viewport + drawing) */
    loadPageState: (pageId: string) => Promise<void>

    /** Subscribe to backend events (terminal, file changes) */
    initEventListeners: () => () => void
}
