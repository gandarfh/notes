/**
 * Shared Drawing Types & Constants
 *
 * Importable from both main thread (drawing-wasm.ts) and Web Worker (drawing-worker.ts).
 * Contains only pure types and constants — no runtime dependencies.
 */

// ── Rendering types ────────────────────────────────────────

export interface PathCmd { op: number; args: number[] }

export interface StrokePath {
    cmds: PathCmd[]
    opacity: number
    strokeWidth: number
    isClip?: boolean
    isFill?: boolean
    fillColor?: string
}

// ── ID Mappings (must match Go's exports) ──────────────────

export const SHAPE_IDS: Record<string, number> = {
    rectangle: 0, ellipse: 1, diamond: 2,
}

export const SIDE_IDS: Record<string, number> = {
    top: 0, right: 1, bottom: 2, left: 3,
}

export const ARROW_STYLE_IDS: Record<string, number> = {
    none: 0, dot: 1, arrow: 2, triangle: 3, bar: 4, diamond: 5,
}

// ── PathOp constants (match Go's PathOp iota) ──────────────

export const OP_MOVE_TO = 0
export const OP_LINE_TO = 1
export const OP_CURVE_TO = 2
export const OP_QUAD_TO = 3
export const OP_ARC = 4
export const OP_CLOSE = 5
