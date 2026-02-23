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
    type: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'ortho-arrow' | 'freedraw' | 'text' | 'diamond'
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

export type DrawingSubTool = 'draw-select' | 'block' | 'db-block' | 'code-block' | 'rectangle' | 'ellipse' | 'ortho-arrow' | 'freedraw' | 'text' | 'diamond'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export function isArrowType(el: DrawingElement): boolean {
    return el.type === 'arrow' || el.type === 'ortho-arrow'
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
