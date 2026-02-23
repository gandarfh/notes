// ── Drawing Interfaces ─────────────────────────────────────
// Core abstractions for the extensible canvas architecture.
// Adding a new tool = implement InteractionHandler.

import type { DrawingElement, DrawingSubTool, AnchorPoint } from './types'

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

    // ── Multi-selection ──
    selectedElements: Set<string>
    clipboard: DrawingElement[]

    // ── Tools ──
    snap(v: number): number
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
