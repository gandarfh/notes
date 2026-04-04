// ── Drawing Interfaces ─────────────────────────────────────
// Core abstractions for the extensible canvas architecture.
// Adding a new tool = implement InteractionHandler.

import type { DrawingElement, DrawingSubTool, AnchorPoint, AnchorableRect } from './types'

// ── Geometry ───────────────────────────────────────────────

export interface Point {
    x: number
    y: number
}

// ── Inline Editor Request ──────────────────────────────────
// Instead of direct DOM manipulation, handlers request an editor via callback.

export interface EditorRequest {
    worldX: number
    worldY: number
    initialText: string
    elementId?: string
    // Style fields for matching element appearance
    fontSize?: number
    fontFamily?: string
    fontWeight?: number
    textColor?: string
    textAlign?: 'center' | 'left'
    // Shape dimensions for flex centering (only for centered text inside shapes)
    shapeWidth?: number
    shapeHeight?: number
    /** Optional background color for the editor (e.g. group labels with pill background) */
    background?: string
    onCommit: (text: string) => void
    onCancel?: () => void
}

// ── Block Preview ──────────────────────────────────────────
// Instead of creating DOM elements, handlers can request a preview overlay.

export interface BlockPreviewRect {
    x: number
    y: number
    width: number
    height: number
}

// ── Drawing Context ────────────────────────────────────────
// Shared context passed to all handlers. No DOM references.

export interface DrawingContext {
    // ── Data ──
    elements: DrawingElement[]
    selectedElement: DrawingElement | null
    currentElement: DrawingElement | null

    // ── DOM block rects (for unified anchor snapping) ──
    blockRects: AnchorableRect[]

    // ── Multi-selection ──
    selectedElements: Set<string>
    clipboard: DrawingElement[]

    // ── Tools ──
    snap(v: number): number
    /** Snap for drawing elements — returns value as-is when element snapping is disabled */
    snapElement(v: number): number
    grid(): number

    // ── Coordination ──
    setSubTool(tool: DrawingSubTool): void
    render(): void
    save(): void
    /** Immediate save — bypasses debounce (use for paste, bulk delete) */
    saveNow(): void

    // ── Editor (React-driven) ──
    showEditor(request: EditorRequest): void
    isEditing: boolean
    isSketchy: boolean
    getScreenCoords(wx: number, wy: number): Point
    getZoom(): number

    // ── Block Preview (React-driven) ──
    setBlockPreview(rect: BlockPreviewRect | null): void

    // ── Cursor (React-driven) ──
    setCursor(cursor: string): void

    // ── Style Defaults (per element type) ──
    getDefaults(type: string): import('../store/types').ElementStyleDefaults
    setDefaults(type: string, patch: Partial<import('../store/types').ElementStyleDefaults>): void

    // ── Canvas Connections (cross-type entity connections) ──
    onCanvasConnectionCreated?(fromEntityId: string, toEntityId: string): void

    // ── Unified entity operations (blocks via store, shapes via refs) ──
    /** IDs of blocks currently in the unified selection (from store.selectedIds) */
    getSelectedBlockIds(): string[]
    /** In board mode, returns { colW, rowH } for grid-snapped arrow-key nudge */
    getDashboardGrid?(): { colW: number; rowH: number } | null
    onMoveBlocks?(moves: Array<{id: string, x: number, y: number}>): void
    onDeleteBlocks?(ids: string[]): void
    onSelectEntities?(ids: string[]): void
}

// ── Interaction Handler ────────────────────────────────────
// Each tool mode (select, arrow, shape, etc.) implements this.

export interface InteractionHandler {
    onMouseDown(ctx: DrawingContext, world: Point): void
    onMouseMove(ctx: DrawingContext, world: Point): void
    onMouseUp(ctx: DrawingContext): void
    onKeyDown?(ctx: DrawingContext, e: KeyboardEvent): boolean
    onRightClick?(ctx: DrawingContext, world: Point): void
    onDoubleClick?(ctx: DrawingContext, world: Point): void
    /** Called when switching away from this handler */
    deactivate?(ctx: DrawingContext): void
    /** Extra rendering for overlays (e.g. anchor indicators). Draws to canvas. */
    renderOverlay?(ctx: DrawingContext, canvas: CanvasRenderingContext2D): void
}
