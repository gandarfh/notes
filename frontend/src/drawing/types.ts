// ── Drawing Types & Constants ──────────────────────────────

export const GRID = 30
export const ANCHOR_RADIUS = 5
export const HANDLE_SIZE = 4

export function snap(v: number): number {
    return Math.round(v / GRID) * GRID
}

let nextId = 0
export function genId(): string {
    return `el_${Date.now()}_${nextId++}`
}

// ── Anchor types ───────────────────────────────────────────

export type AnchorSide = 'top' | 'right' | 'bottom' | 'left'

export interface AnchorPoint {
    elementId: string
    side: AnchorSide
    t: number   // 0..1 parametric position along the edge
    x: number
    y: number
}

export interface Connection {
    elementId: string
    side: AnchorSide
    t: number   // parametric position along the edge
}

// ── Element model ──────────────────────────────────────────

export interface DrawingElement {
    id: string
    type: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'ortho-arrow' | 'freedraw' | 'text' | 'diamond' | 'group' | (string & {})
    x: number
    y: number
    width: number
    height: number
    points?: number[][]
    text?: string
    strokeColor: string
    strokeWidth: number
    backgroundColor: string
    fontSize?: number
    roundness?: boolean       // legacy — prefer borderRadius
    borderRadius?: number     // numeric rx (0, 4, 8, 16, 999)
    fontFamily?: string       // e.g. 'Inter', 'monospace', 'serif'
    fontWeight?: number       // 400 (normal), 500 (medium), 700 (bold)
    textColor?: string        // independent text color (falls back to strokeColor)
    fillStyle?: 'solid' | 'hachure'  // sketchy fill: solid marker or diagonal stripes
    opacity?: number          // 0–1 element opacity
    strokeDasharray?: string  // '' (solid), '8 4' (dashed), '2 4' (dotted)
    textAlign?: 'left' | 'center' | 'right'
    verticalAlign?: 'top' | 'center' | 'bottom'
    // Connector data — arrow endpoints attached to shapes
    startConnection?: Connection
    endConnection?: Connection
    // Arrowhead style
    arrowEnd?: 'arrow' | 'none' | 'dot' | 'triangle' | 'bar' | 'diamond'
    arrowStart?: 'none' | 'arrow' | 'dot' | 'triangle' | 'bar' | 'diamond'
    // Label text (attached to any element — centered on shapes, positioned on arrows)
    label?: string
    labelT?: number  // 0..1 position along arrow path (default 0.5 = midpoint)
}

export type DrawingSubTool = 'draw-select' | 'block' | 'db-block' | 'code-block' | 'localdb-block' | 'chart-block' | 'etl-block' | 'http-block' | 'rectangle' | 'ellipse' | 'ortho-arrow' | 'freedraw' | 'text' | 'diamond' | 'group'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export function isArrowType(el: DrawingElement): boolean {
    return el.type === 'arrow' || el.type === 'ortho-arrow'
}

// ── Style helpers (extracted for testability) ────────────

import type { ElementTypeCategory } from '../store/types'

/** Map any element type string to its style default category */
export function elementTypeCategory(type: string): ElementTypeCategory {
    switch (type) {
        case 'rectangle': return 'rectangle'
        case 'ellipse': return 'ellipse'
        case 'diamond': return 'diamond'
        case 'arrow': case 'ortho-arrow': case 'line': return 'arrow'
        case 'text': return 'text'
        case 'freedraw': return 'freedraw'
        default: return 'rectangle'
    }
}

/** Get the common value of a property across multiple elements (undefined if they differ) */
export function getCommon<K extends keyof DrawingElement>(els: DrawingElement[], key: K): DrawingElement[K] | undefined {
    if (els.length === 0) return undefined
    const val = els[0][key]
    return els.every(e => e[key] === val) ? val : undefined
}

/** Determine which StylePanel sections should be visible for a set of elements */
export function stylePanelSections(elements: DrawingElement[]) {
    const types = new Set(elements.map(e => e.type))
    return {
        hasShapes: types.has('rectangle') || types.has('ellipse') || types.has('diamond'),
        hasRect: types.has('rectangle'),
        hasArrows: types.has('arrow') || types.has('ortho-arrow'),
        hasText: types.has('text') || elements.some(e => e.text || e.label),
        onlyText: types.size === 1 && types.has('text'),
    }
}

/** Apply a style patch to selected elements, returning affected type set */
export function applyStylePatch(
    elements: DrawingElement[],
    selectedIds: Set<string>,
    patch: Partial<DrawingElement>,
): { affectedTypes: Set<string> } {
    const affectedTypes = new Set<string>()
    for (const el of elements) {
        if (!selectedIds.has(el.id)) continue
        Object.assign(el, patch)
        affectedTypes.add(el.type)
    }
    return { affectedTypes }
}

// ── Text measurement (main thread only) ─────────────────

let _measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
    if (!_measureCtx) {
        const c = document.createElement('canvas')
        _measureCtx = c.getContext('2d')!
    }
    return _measureCtx
}

/** Measure text element dimensions using Canvas measureText (pixel-accurate) */
export function measureTextElement(el: DrawingElement): { w: number; h: number } {
    const lines = (el.text || '').split('\n')
    const isSketchy = (typeof localStorage !== 'undefined' && localStorage.getItem('boardStyle') === 'sketchy')
    const baseFontSize = el.fontSize || 14
    const fontSize = isSketchy ? Math.round(baseFontSize * 1.3) : (el.fontSize ?? 16)
    const lineH = fontSize * 1.3
    const ctx = getMeasureCtx()
    ctx.font = `${el.fontWeight || 400} ${fontSize}px 'Architects Daughter'`
    let maxW = 0
    for (const line of lines) {
        const w = ctx.measureText(line).width
        if (w > maxW) maxW = w
    }
    return { w: maxW, h: lineH * lines.length }
}

/** Compute the actual bounding box of an element, accounting for arrow points */
export function getElementBounds(el: DrawingElement): { x: number; y: number; w: number; h: number } {
    if (el.points && el.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const p of el.points) {
            const px = el.x + p[0], py = el.y + p[1]
            minX = Math.min(minX, px)
            minY = Math.min(minY, py)
            maxX = Math.max(maxX, px)
            maxY = Math.max(maxY, py)
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    return { x: el.x, y: el.y, w: el.width, h: el.height }
}
