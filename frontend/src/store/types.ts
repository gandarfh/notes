import type { Block, Connection, CanvasEntity, CanvasConnection, CanvasEntityPatch, CanvasEntityPatchWithID, Notebook, Page, PageState } from '../bridge/wails'
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
    initializing: boolean
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

// ── Entity Slice (unified canvas entities) ────────────────

export interface EntitySlice {
    entities: Map<string, CanvasEntity>
    canvasConnections: CanvasConnection[]

    setEntities: (entities: CanvasEntity[]) => void
    addEntity: (entity: CanvasEntity) => void
    removeEntity: (id: string) => void
    updateEntity: (id: string, patch: Partial<CanvasEntity>) => void
    setCanvasConnections: (conns: CanvasConnection[]) => void
    addCanvasConnection: (conn: CanvasConnection) => void
    removeCanvasConnection: (id: string) => void

    createEntity: (type: string, x: number, y: number, w: number, h: number) => Promise<CanvasEntity | null>
    deleteEntity: (id: string) => Promise<void>
    saveEntityPatch: (id: string, patch: CanvasEntityPatch) => void
    batchUpdateEntities: (patches: CanvasEntityPatchWithID[]) => Promise<void>
    updateEntityZOrder: (orderedIDs: string[]) => Promise<void>
    createCanvasConnection: (fromId: string, toId: string) => Promise<void>
    deleteCanvasConnection: (id: string) => Promise<void>

    getDomEntities: () => CanvasEntity[]
    getCanvasEntities: () => CanvasEntity[]
}

// ── Selection Slice (unified selection) ────────────────────

export interface SelectionSlice {
    selectedIds: Set<string>

    select: (id: string) => void
    selectMultiple: (ids: string[]) => void
    addToSelection: (id: string) => void
    removeFromSelection: (id: string) => void
    toggleSelection: (id: string) => void
    clearSelection: () => void
    isSelected: (id: string) => boolean
}

// ── Combined Store ─────────────────────────────────────────

export type AppState = NotebookSlice & CanvasSlice & BlockSlice & DrawingSlice & ConnectionSlice & EntitySlice & SelectionSlice & {
    /** Load full page state (blocks + connections + viewport + drawing) */
    loadPageState: (pageId: string) => Promise<void>

    /** Subscribe to backend events (terminal, file changes) */
    initEventListeners: () => () => void
}
