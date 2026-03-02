/**
 * Drawing Engine WASM Bridge
 *
 * Loads the TinyGo-compiled drawing.wasm module and provides
 * typed wrappers around the exported functions.
 *
 * Hot-path functions use Float64Array binary protocol (no JSON).
 * Cold-path functions (called rarely) use JSON protocol.
 */

import type { AnchorSide } from './types'

// Re-export Rect to match Go's drawing.Rect
export interface Rect { x: number; y: number; w: number; h: number }

export interface PathCmd { op: number; args: number[] }

export interface StrokePath {
    cmds: PathCmd[]
    opacity: number
    strokeWidth: number
    isClip?: boolean
    isFill?: boolean
    fillColor?: string
}

export interface RouteOpts {
    startSide?: AnchorSide
    endSide?: AnchorSide
    startRect?: Rect
    endRect?: Rect
    shapeObstacles?: Rect[]
    arrowObstacles?: Rect[]
}

// ── ID Mappings (must match Go's main.go) ──

export const SHAPE_IDS: Record<string, number> = {
    rectangle: 0, ellipse: 1, diamond: 2,
    database: 3, vm: 4, terminal: 5, user: 6, cloud: 7,
}

export const SIDE_IDS: Record<string, number> = {
    top: 0, right: 1, bottom: 2, left: 3,
}
const SIDE_NAMES: AnchorSide[] = ['top', 'right', 'bottom', 'left']

export const ARROW_STYLE_IDS: Record<string, number> = {
    none: 0, dot: 1, arrow: 2, triangle: 3, bar: 4, diamond: 5,
}

interface WASMExports {
    memory: WebAssembly.Memory
    // JSON protocol buffers
    getBuffer: () => number
    getResultBuffer: () => number
    // Binary protocol buffers
    getFloat64Buffer: () => number
    getFloat64ResultBuffer: () => number
    // JSON protocol functions
    computeOrthoRoute: (inputLen: number) => number
    hitTestPoint: (inputLen: number) => number
    nearestPoint: (inputLen: number) => number
    binarySubdivisionT: (index: number) => number
    // Binary protocol functions
    hitTestPointBin: () => void
    nearestAnchorBin: () => void
    computeOrthoRouteBin: () => void
    getSketchLinePathsBin: () => number
    getArrowHeadPathsBin: () => number
    getSketchPathsBin: () => number
}

let _engine: DrawingEngine | null = null
let _loading: Promise<DrawingEngine> | null = null

export class DrawingEngine {
    private exports: WASMExports
    private encoder = new TextEncoder()
    private decoder = new TextDecoder()
    private f64In!: Float64Array
    private f64Out!: Float64Array
    private lastBuffer: ArrayBuffer | null = null

    constructor(exports: WASMExports) {
        this.exports = exports
        this.initFloat64Views()
    }

    private initFloat64Views() {
        const mem = this.exports.memory.buffer
        this.lastBuffer = mem
        const inPtr = this.exports.getFloat64Buffer()
        const outPtr = this.exports.getFloat64ResultBuffer()
        this.f64In = new Float64Array(mem, inPtr, 8192)
        this.f64Out = new Float64Array(mem, outPtr, 8192)
    }

    /** Refresh Float64Array views if WASM memory has grown (new ArrayBuffer) */
    private ensureViews() {
        if (this.exports.memory.buffer !== this.lastBuffer) {
            this.initFloat64Views()
        }
    }

    // ── JSON protocol (cold-path) ──

    private writeInput(data: unknown): number {
        const json = JSON.stringify(data)
        const bytes = this.encoder.encode(json)
        const ptr = this.exports.getBuffer()
        const view = new Uint8Array(this.exports.memory.buffer, ptr, bytes.length)
        view.set(bytes)
        return bytes.length
    }

    private readResult(len: number): string {
        const ptr = this.exports.getResultBuffer()
        const view = new Uint8Array(this.exports.memory.buffer, ptr, len)
        return this.decoder.decode(view)
    }

    binarySubdivisionT(index: number): number {
        return this.exports.binarySubdivisionT(index)
    }

    getShapeOutline(shapeType: string, w: number, h: number): { outline: any[]; icon?: any[] } | null {
        const inputLen = this.writeInput({ shapeType, w, h })
        const resultLen = (this.exports as any).getShapeOutline(inputLen)
        const result = this.readResult(resultLen)
        try {
            const parsed = JSON.parse(result)
            if (parsed.error) return null
            return parsed
        } catch { return null }
    }

    listShapes(): { type: string; label: string; category: string; defaultW: number; defaultH: number; filled: boolean }[] {
        const resultLen = (this.exports as any).listShapes()
        const result = this.readResult(resultLen)
        return JSON.parse(result)
    }

    getAnchors(shapeType: string, w: number, h: number): { side: string; t: number; x: number; y: number }[] {
        const inputLen = this.writeInput({ shapeType, w, h })
        const resultLen = (this.exports as any).getAnchors(inputLen)
        const result = this.readResult(resultLen)
        try {
            const parsed = JSON.parse(result)
            if (parsed.error) return []
            return parsed
        } catch { return [] }
    }

    // ── Binary protocol (hot-path — 60fps) ──

    /** Hit test a point against a shape (binary — ~0.01ms) */
    hitTestPointBin(shapeTypeId: number, w: number, h: number, px: number, py: number): boolean {
        this.ensureViews()
        this.f64In[0] = shapeTypeId
        this.f64In[1] = w
        this.f64In[2] = h
        this.f64In[3] = px
        this.f64In[4] = py
        this.exports.hitTestPointBin()
        return this.f64Out[0] === 1
    }

    /** Find nearest anchor on a shape (binary — ~0.01ms) */
    nearestAnchorBin(shapeTypeId: number, w: number, h: number, px: number, py: number): { side: AnchorSide; t: number; x: number; y: number } | null {
        this.ensureViews()
        this.f64In[0] = shapeTypeId
        this.f64In[1] = w
        this.f64In[2] = h
        this.f64In[3] = px
        this.f64In[4] = py
        this.exports.nearestAnchorBin()
        if (this.f64Out[0] < 0) return null
        return {
            side: SIDE_NAMES[this.f64Out[0]] || 'top',
            t: this.f64Out[1],
            x: this.f64Out[2],
            y: this.f64Out[3],
        }
    }

    /** Compute ortho arrow route (binary — ~0.05ms) */
    computeOrthoRouteBin(dx: number, dy: number, opts: RouteOpts): number[][] {
        this.ensureViews()
        this.f64In[0] = dx
        this.f64In[1] = dy
        this.f64In[2] = SIDE_IDS[opts.startSide ?? ''] ?? -1
        this.f64In[3] = SIDE_IDS[opts.endSide ?? ''] ?? -1

        let idx = 4
        if (opts.startRect) {
            this.f64In[idx] = 1
            this.f64In[idx + 1] = opts.startRect.x
            this.f64In[idx + 2] = opts.startRect.y
            this.f64In[idx + 3] = opts.startRect.w
            this.f64In[idx + 4] = opts.startRect.h
        } else {
            this.f64In[idx] = 0
        }
        idx += 5

        if (opts.endRect) {
            this.f64In[idx] = 1
            this.f64In[idx + 1] = opts.endRect.x
            this.f64In[idx + 2] = opts.endRect.y
            this.f64In[idx + 3] = opts.endRect.w
            this.f64In[idx + 4] = opts.endRect.h
        } else {
            this.f64In[idx] = 0
        }
        idx += 5

        const obs = opts.shapeObstacles ?? []
        this.f64In[idx] = obs.length
        idx++
        for (const r of obs) {
            this.f64In[idx] = r.x
            this.f64In[idx + 1] = r.y
            this.f64In[idx + 2] = r.w
            this.f64In[idx + 3] = r.h
            idx += 4
        }

        this.exports.computeOrthoRouteBin()

        const nPoints = this.f64Out[0]
        const points: number[][] = []
        let o = 1
        for (let i = 0; i < nPoints; i++) {
            points.push([this.f64Out[o], this.f64Out[o + 1]])
            o += 2
        }
        return points
    }

    /** Read StrokePaths from binary result buffer */
    private readStrokePaths(): StrokePath[] {
        const nStrokes = this.f64Out[0]
        if (!isFinite(nStrokes) || nStrokes < 0 || nStrokes > 100) return []
        const paths: StrokePath[] = []
        let o = 1
        for (let s = 0; s < nStrokes; s++) {
            if (o + 4 > 8192) break
            const nCmds = this.f64Out[o]
            const opacity = this.f64Out[o + 1]
            const strokeWidth = this.f64Out[o + 2]
            const flags = this.f64Out[o + 3]
            o += 4
            if (!isFinite(nCmds) || nCmds < 0 || nCmds > 500) break
            const isClip = (flags & 1) !== 0
            const isFill = (flags & 2) !== 0

            const cmds: PathCmd[] = []
            for (let c = 0; c < nCmds; c++) {
                if (o + 2 > 8192) break
                const op = this.f64Out[o]
                const nArgs = this.f64Out[o + 1]
                o += 2
                if (!isFinite(nArgs) || nArgs < 0 || nArgs > 20) break
                const args: number[] = []
                for (let a = 0; a < nArgs; a++) {
                    if (o >= 8192) break
                    args.push(this.f64Out[o])
                    o++
                }
                cmds.push({ op, args })
            }
            paths.push({ cmds, opacity, strokeWidth, isClip, isFill })
        }
        return paths
    }

    /** Get sketch line paths for arrow segments (binary — ~0.02ms) */
    getSketchLinePathsBin(absPoints: number[][], seed: number, sw: number): StrokePath[] {
        this.ensureViews()
        this.f64In[0] = absPoints.length
        let idx = 1
        for (const pt of absPoints) {
            this.f64In[idx] = pt[0]
            this.f64In[idx + 1] = pt[1]
            idx += 2
        }
        this.f64In[idx] = seed
        this.f64In[idx + 1] = sw
        this.exports.getSketchLinePathsBin()
        return this.readStrokePaths()
    }

    /** Get arrow head paths (binary — ~0.01ms) */
    getArrowHeadPathsBin(styleId: number, tipX: number, tipY: number, angle: number, size: number, seed: number, sw: number): StrokePath[] {
        this.ensureViews()
        this.f64In[0] = styleId
        this.f64In[1] = tipX
        this.f64In[2] = tipY
        this.f64In[3] = angle
        this.f64In[4] = size
        this.f64In[5] = seed
        this.f64In[6] = sw
        this.exports.getArrowHeadPathsBin()
        return this.readStrokePaths()
    }

    /** Get sketch paths for shapes (binary — ~0.05ms) */
    getSketchPathsBin(shapeTypeId: number, w: number, h: number, seed: number, sw: number, hasFill: boolean, fillStyleId: number): StrokePath[] {
        this.ensureViews()
        this.f64In[0] = shapeTypeId
        this.f64In[1] = w
        this.f64In[2] = h
        this.f64In[3] = seed
        this.f64In[4] = sw
        this.f64In[5] = hasFill ? 1 : 0
        this.f64In[6] = fillStyleId
        this.exports.getSketchPathsBin()
        return this.readStrokePaths()
    }
}

/**
 * Get the shared DrawingEngine instance.
 * Loads the WASM module on first call, returns cached instance after.
 */
export async function getDrawingEngine(): Promise<DrawingEngine> {
    if (_engine) return _engine

    if (!_loading) {
        _loading = loadWASM()
    }
    return _loading
}

async function loadWASM(): Promise<DrawingEngine> {
    // TinyGo WASM requires the wasm_exec.js support file
    // which sets up the Go runtime environment
    const go = new (globalThis as any).Go()

    const wasmPath = '/drawing.wasm'
    const result = await WebAssembly.instantiateStreaming(
        fetch(wasmPath),
        go.importObject,
    )

    // Start the Go runtime (needed for TinyGo)
    go.run(result.instance)

    const exports = result.instance.exports as unknown as WASMExports
    _engine = new DrawingEngine(exports)
    return _engine
}
