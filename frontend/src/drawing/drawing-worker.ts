/**
 * Drawing Worker — runs in a Web Worker thread.
 *
 * Owns: WASM engine loading, all rendering (drawElement), ortho routing.
 * Receives element state from main thread via postMessage.
 * Renders to an OffscreenCanvas (browser composites automatically).
 */

// wasm_exec.js is loaded dynamically in initWASM() via fetch/eval
// (importScripts not available in module workers)

// ── Types (minimal subset for structured clone) ──

interface DrawingElement {
    id: string
    type: string
    x: number; y: number
    width: number; height: number
    strokeColor: string
    strokeWidth: number
    backgroundColor?: string
    fillStyle?: string
    strokeDasharray?: string
    text?: string
    label?: string
    labelT?: number
    fontSize?: number
    fontWeight?: number
    fontFamily?: string
    textAlign?: string
    verticalAlign?: string
    textColor?: string
    opacity?: number
    borderRadius?: number
    roundness?: boolean
    points?: number[][]
    arrowEnd?: string
    arrowStart?: string
    startConnection?: { elementId: string; side: string; t: number }
    endConnection?: { elementId: string; side: string; t: number }
}

interface RenderState {
    // Full element list (only sent on fullSync)
    elements?: DrawingElement[]
    // Diff-based updates (sent on partial renders)
    dirtyElements?: DrawingElement[]
    removedIds?: string[]
    // Force full redraw (page switch, theme change, zoom change)
    fullSync: boolean
    viewport: { x: number; y: number; zoom: number }
    selectedId: string | null
    multiSelectedIds: string[]
    currentElement: DrawingElement | null
    highlightedIds: string[]
    sketchy: boolean
    canvasWidth: number
    canvasHeight: number
    dpr: number
    theme: 'light' | 'dark'
    canvasBg: string
    defaultStroke: string
    highlightColor: string
    editingElementId: string | null
}

// ── WASM Engine (types from drawing-shared.ts) ──

import { type PathCmd, type StrokePath, SHAPE_IDS, ARROW_STYLE_IDS, OP_MOVE_TO, OP_LINE_TO, OP_CURVE_TO, OP_QUAD_TO, OP_ARC, OP_CLOSE } from './drawing-shared'

interface WASMExports {
    memory: WebAssembly.Memory
    getBuffer: () => number
    getResultBuffer: () => number
    getFloat64Buffer: () => number
    getFloat64ResultBuffer: () => number
    hitTestPointBin: () => void
    nearestAnchorBin: () => void
    computeOrthoRouteBin: () => void
    getSketchLinePathsBin: () => number
    getArrowHeadPathsBin: () => number
    getSketchPathsBin: () => number
}

let engine: {
    exports: WASMExports
    f64In: Float64Array
    f64Out: Float64Array
    lastBuffer: ArrayBuffer | null
} | null = null

function ensureViews() {
    if (!engine) return
    if (engine.exports.memory.buffer !== engine.lastBuffer) {
        engine.lastBuffer = engine.exports.memory.buffer
        const inPtr = engine.exports.getFloat64Buffer()
        const outPtr = engine.exports.getFloat64ResultBuffer()
        engine.f64In = new Float64Array(engine.exports.memory.buffer, inPtr, 8192)
        engine.f64Out = new Float64Array(engine.exports.memory.buffer, outPtr, 8192)
    }
}

async function initWASM(): Promise<void> {
    // Load wasm_exec.js (TinyGo support) via fetch + eval
    // (importScripts is not available in ES module workers)
    const wasmExecScript = await fetch('/wasm_exec.js').then(r => r.text())
        // eslint-disable-next-line no-eval
        ; (0, eval)(wasmExecScript)

    const go = new (globalThis as any).Go()
    const result = await WebAssembly.instantiateStreaming(
        fetch(`/drawing.wasm?v=${Date.now()}`),
        go.importObject,
    )
    go.run(result.instance)
    const exports = result.instance.exports as unknown as WASMExports
    const mem = exports.memory.buffer
    engine = {
        exports,
        f64In: new Float64Array(mem, exports.getFloat64Buffer(), 8192),
        f64Out: new Float64Array(mem, exports.getFloat64ResultBuffer(), 8192),
        lastBuffer: mem,
    }

    // Load fonts in worker (workers have isolated font context — they can't see
    // fonts loaded via CSS in the main document)
    try {
        const fontUrl = 'https://fonts.gstatic.com/s/architectsdaughter/v18/KtkxAKiDZI_td1Lkx62xHZHDtgO_Y-bvTYlg4w.woff2'
        const fontData = await fetch(fontUrl).then(r => r.arrayBuffer())
        const face = new FontFace('Architects Daughter', fontData)
        await face.load()
            ; (self as any).fonts.add(face)
        console.log('[drawing-worker] Architects Daughter font loaded')
    } catch (err) {
        console.error('[drawing-worker] font load failed:', err)
    }
}

// ── Binary WASM helpers ──

function readStrokePaths(): StrokePath[] {
    if (!engine) return []
    const f64Out = engine.f64Out
    const nStrokes = f64Out[0]
    if (!isFinite(nStrokes) || nStrokes < 0 || nStrokes > 5000) return []
    const paths: StrokePath[] = []
    let o = 1
    for (let s = 0; s < nStrokes; s++) {
        if (o + 4 > 8192) break
        const nCmds = f64Out[o]
        const opacity = f64Out[o + 1]
        const strokeWidth = f64Out[o + 2]
        const flags = f64Out[o + 3]
        o += 4
        if (!isFinite(nCmds) || nCmds < 0 || nCmds > 500) break
        const isClip = (flags & 1) !== 0
        const isFill = (flags & 2) !== 0
        const cmds: PathCmd[] = []
        for (let c = 0; c < nCmds; c++) {
            if (o + 2 > 8192) break
            const op = f64Out[o]
            const nArgs = f64Out[o + 1]
            o += 2
            if (!isFinite(nArgs) || nArgs < 0 || nArgs > 20) break
            const args: number[] = []
            for (let a = 0; a < nArgs; a++) {
                if (o >= 8192) break
                args.push(f64Out[o])
                o++
            }
            cmds.push({ op, args })
        }
        paths.push({ cmds, opacity, strokeWidth, isClip, isFill })
    }
    return paths
}

function getSketchLinePathsBin(absPoints: number[][], seed: number, sw: number): StrokePath[] {
    if (!engine) return []
    ensureViews()
    engine.f64In[0] = absPoints.length
    let idx = 1
    for (const pt of absPoints) {
        engine.f64In[idx] = pt[0]
        engine.f64In[idx + 1] = pt[1]
        idx += 2
    }
    engine.f64In[idx] = seed
    engine.f64In[idx + 1] = sw
    engine.exports.getSketchLinePathsBin()
    return readStrokePaths()
}

function getArrowHeadPathsBin(styleId: number, tipX: number, tipY: number, angle: number, size: number, seed: number, sw: number): StrokePath[] {
    if (!engine) return []
    ensureViews()
    engine.f64In[0] = styleId
    engine.f64In[1] = tipX
    engine.f64In[2] = tipY
    engine.f64In[3] = angle
    engine.f64In[4] = size
    engine.f64In[5] = seed
    engine.f64In[6] = sw
    engine.exports.getArrowHeadPathsBin()
    return readStrokePaths()
}

function getSketchPathsBin(shapeTypeId: number, w: number, h: number, seed: number, sw: number, hasFill: boolean, fillStyleId: number): StrokePath[] {
    if (!engine) return []
    ensureViews()
    engine.f64In[0] = shapeTypeId
    engine.f64In[1] = w
    engine.f64In[2] = h
    engine.f64In[3] = seed
    engine.f64In[4] = sw
    engine.f64In[5] = hasFill ? 1 : 0
    engine.f64In[6] = fillStyleId
    engine.exports.getSketchPathsBin()
    return readStrokePaths()
}

// ── Rendering ──

function hashId(id: string): number {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = ((h << 5) - h + id.charCodeAt(i)) | 0
    }
    return Math.abs(h)
}

function remapForTheme(c: string, _isLight = false): string {
    if (!c) return _lastDefaultStroke
    // Swap dark↔light default strokes
    if (c === _darkStroke && _isLight) return _lastDefaultStroke
    if (c === _lightStroke && !_isLight) return _lastDefaultStroke
    return c
}

// Default stroke colors stored on elements (data-level, not theme-level)
const _darkStroke = '#e8e8f0'   // what elements store for dark mode
const _lightStroke = '#1e1e2e'  // what elements store for light mode

function applyPathCmds(ctx: OffscreenCanvasRenderingContext2D, cmds: PathCmd[]): void {
    if (!cmds) return
    for (const cmd of cmds) {
        const a = cmd.args || []
        switch (cmd.op) {
            case OP_MOVE_TO: ctx.moveTo(a[0], a[1]); break
            case OP_LINE_TO: ctx.lineTo(a[0], a[1]); break
            case OP_CURVE_TO: ctx.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]); break
            case OP_QUAD_TO: ctx.quadraticCurveTo(a[0], a[1], a[2], a[3]); break
            case OP_ARC: {
                if (a.length >= 6) ctx.arc(a[0], a[1], a[2], a[3], a[4], a[5] > 0)
                else if (a.length >= 5) ctx.arc(a[0], a[1], a[2], a[3], a[4])
                break
            }
            case OP_CLOSE: ctx.closePath(); break
        }
    }
}

function renderStrokePaths(
    ctx: OffscreenCanvasRenderingContext2D, paths: StrokePath[],
    color: string, sw: number, dash: string,
    offsetX = 0, offsetY = 0,
    fillColor?: string
): void {
    // Paths arrive as: [clip?, fill1, fill2, ..., outline1, outline2, icon?]
    // Clip + fill share a save/restore so clipping persists across fill strokes.
    let clipActive = false
    for (const sp of paths) {
        if (!sp.cmds) continue
        if (sp.isClip) {
            // Start a new clipping group
            if (clipActive) ctx.restore()
            ctx.save()
            if (offsetX || offsetY) ctx.translate(offsetX, offsetY)
            ctx.beginPath()
            applyPathCmds(ctx, sp.cmds)
            ctx.clip()
            clipActive = true
        } else if (sp.isFill) {
            // Fill strokes render inside the active clip
            ctx.globalAlpha = sp.opacity
            ctx.strokeStyle = fillColor || color
            ctx.lineWidth = sp.strokeWidth || sw
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.beginPath()
            applyPathCmds(ctx, sp.cmds)
            ctx.stroke()
        } else {
            // Outline/icon stroke — close any active clip group first
            if (clipActive) { ctx.restore(); clipActive = false }
            ctx.save()
            if (offsetX || offsetY) ctx.translate(offsetX, offsetY)
            ctx.globalAlpha = sp.opacity
            ctx.strokeStyle = color
            ctx.lineWidth = sp.strokeWidth || sw
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            if (dash) ctx.setLineDash(dash.split(/[\s,]+/).map(Number))
            ctx.beginPath()
            applyPathCmds(ctx, sp.cmds)
            ctx.stroke()
            ctx.restore()
        }
    }
    if (clipActive) ctx.restore()
}

function isArrowType(el: DrawingElement): boolean {
    return el.type === 'arrow' || el.type === 'ortho-arrow' || el.type === 'line'
}

/** Wrap a single line of text to fit within maxWidth, splitting by words then by characters. */
function wrapLine(ctx: OffscreenCanvasRenderingContext2D, line: string, maxWidth: number): string[] {
    if (maxWidth <= 0 || ctx.measureText(line).width <= maxWidth) return [line]

    const words = line.split(' ')
    const result: string[] = []
    let cur = ''

    for (const word of words) {
        const test = cur ? cur + ' ' + word : word
        if (ctx.measureText(test).width > maxWidth && cur) {
            result.push(cur)
            cur = word
        } else {
            cur = test
        }
    }
    if (cur) result.push(cur)

    // Break any remaining too-long segments by character
    const final: string[] = []
    for (const seg of result) {
        if (ctx.measureText(seg).width <= maxWidth) { final.push(seg); continue }
        let c = ''
        for (const ch of seg) {
            const t = c + ch
            if (ctx.measureText(t).width > maxWidth && c) { final.push(c); c = ch } else { c = t }
        }
        if (c) final.push(c)
    }
    return final
}

// ── Draw Element (runs in worker, calls WASM freely) ──

function drawElement(ctx: OffscreenCanvasRenderingContext2D, el: DrawingElement, isLight: boolean): void {
    const color = remapForTheme(el.strokeColor, isLight)
    const sw = el.strokeWidth
    const seed = hashId(el.id)
    const baseFontSize = el.fontSize || 14
    const textSize = _lastSketchy ? Math.round(baseFontSize * 1.3) : baseFontSize
    const font = "'Architects Daughter'"
    const fw = el.fontWeight || 400
    const textFill = remapForTheme(el.textColor || el.strokeColor, isLight)
    const dash = el.strokeDasharray || ''

    if (el.opacity != null && el.opacity < 1) {
        ctx.save()
        ctx.globalAlpha = el.opacity
    }

    switch (el.type) {
        case 'line':
        case 'arrow':
        case 'ortho-arrow': {
            if (!el.points || el.points.length < 2) break

            // Arrow lines + heads via WASM (no lag — we're in a worker thread!)
            try {
                const absPoints = el.points.map(p => [el.x + p[0], el.y + p[1]])
                if (absPoints.length >= 2) {
                    const linePaths = getSketchLinePathsBin(absPoints, seed, sw)
                    renderStrokePaths(ctx, linePaths, color, sw, dash)
                }

                // Arrow heads
                const renderHead = (which: 'start' | 'end') => {
                    const style = which === 'end' ? (el.arrowEnd || 'arrow') : (el.arrowStart || 'none')
                    if (style === 'none') return
                    const styleId = ARROW_STYLE_IDS[style] ?? 2
                    let tip: number[], prev: number[]
                    if (which === 'end') {
                        tip = el.points![el.points!.length - 1]
                        prev = el.points![el.points!.length - 2]
                    } else {
                        tip = el.points![0]
                        prev = el.points![1]
                    }
                    if (!tip || !prev) return
                    const tipX = el.x + tip[0], tipY = el.y + tip[1]
                    const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0])
                    if (!isFinite(angle)) return
                    const size = 6 + sw * 3
                    const headSeed = seed + (which === 'start' ? 500 : 0)
                    const headPaths = getArrowHeadPathsBin(styleId, tipX, tipY, angle, size, headSeed, sw)
                    renderStrokePaths(ctx, headPaths, color, sw, '')
                }
                if (el.type !== 'line') renderHead('end')
                if (el.arrowStart && el.arrowStart !== 'none') renderHead('start')
            } catch { /* WASM error — skip */ }

            // Arrow label
            if (el.label && el.points.length >= 2 && _editingElementId !== el.id) {
                drawArrowLabel(ctx, el, color)
            }
            if (el.opacity != null && el.opacity < 1) ctx.restore()
            return
        }
        case 'freedraw': {
            if (!el.points || el.points.length < 2) break
            ctx.strokeStyle = color
            ctx.lineWidth = sw
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.beginPath()
            ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1])
            for (let i = 1; i < el.points.length; i++) {
                ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1])
            }
            ctx.stroke()
            if (el.opacity != null && el.opacity < 1) ctx.restore()
            return
        }
        case 'text': {
            if (_editingElementId === el.id) break
            const lines = (el.text || '').split('\n')
            ctx.fillStyle = textFill
            ctx.font = `${fw} ${textSize}px ${font}`
            ctx.textBaseline = 'alphabetic'
            ctx.textAlign = (el.textAlign as CanvasTextAlign) || 'start'
            const lineH = textSize * 1.3
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], el.x, el.y + lineH * i)
            }
            if (el.opacity != null && el.opacity < 1) ctx.restore()
            return
        }
        case 'group': {
            // Dashed border
            ctx.strokeStyle = color
            ctx.lineWidth = sw || 2
            ctx.setLineDash([8, 4])
            ctx.beginPath()
            ctx.roundRect(el.x, el.y, el.width, el.height, el.borderRadius ?? 0)
            ctx.stroke()
            ctx.setLineDash([])
            // Group label
            if (el.text && _editingElementId !== el.id) {
                ctx.fillStyle = textFill
                ctx.font = `${fw} ${textSize}px ${font}`
                ctx.textBaseline = 'alphabetic'
                ctx.textAlign = 'start'
                ctx.fillText(el.text, el.x + 8, el.y - 6)
            }
            if (el.opacity != null && el.opacity < 1) ctx.restore()
            return
        }
        default: {
            // Shapes via WASM (no lag in worker!)
            try {
                const shapeId = SHAPE_IDS[el.type] ?? 0
                const hasFill = !!(el.backgroundColor && el.backgroundColor !== 'transparent')
                const bgColor = hasFill ? remapForTheme(el.backgroundColor!, _lastIsLight) : undefined
                const fillStyleId = el.fillStyle === 'solid' ? 1 : 0
                const paths = getSketchPathsBin(shapeId, el.width, el.height, seed, sw, hasFill, fillStyleId)
                renderStrokePaths(ctx, paths, color, sw, dash, el.x, el.y, bgColor)
            } catch { /* WASM error — skip */ }
            break
        }
    }

    // Text inside shapes (skip if inline editor is open for this element)
    if (el.text && !isArrowType(el) && el.type !== 'text' && el.type !== 'freedraw' && el.type !== 'group' && _editingElementId !== el.id) {
        const cx = el.x + el.width / 2, cy = el.y + el.height / 2
        ctx.fillStyle = textFill
        ctx.font = `${fw} ${textSize}px ${font}`
        ctx.textAlign = (el.textAlign as CanvasTextAlign) || 'center'
        ctx.textBaseline = 'middle'

        // Word-wrap text to fit within shape width
        const maxTextW = el.width - 16
        const rawLines = el.text.split('\n')
        const lines: string[] = []
        for (const raw of rawLines) {
            lines.push(...wrapLine(ctx, raw, maxTextW))
        }

        const lineH = textSize * 1.2
        const totalH = lines.length * lineH
        const valign = el.verticalAlign || 'middle'
        const baseY = valign === 'top' ? el.y + textSize : valign === 'bottom' ? el.y + el.height - totalH + lineH / 2 : cy - totalH / 2 + lineH / 2
        const tx = el.textAlign === 'start' ? el.x + 8 : el.textAlign === 'end' ? el.x + el.width - 8 : cx
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], tx, baseY + i * lineH)
        }
    }

    // Fill inside shapes
    if (el.backgroundColor && el.backgroundColor !== 'transparent' && !isArrowType(el) && el.type !== 'text' && el.type !== 'freedraw' && el.type !== 'group') {
        // Fill is handled by WASM getSketchPathsBin (isFill flag)
    }

    if (el.opacity != null && el.opacity < 1) ctx.restore()
}

function drawArrowLabel(ctx: OffscreenCanvasRenderingContext2D, el: DrawingElement, color: string): void {
    if (!el.label || !el.points || el.points.length < 2) return
    const t = el.labelT ?? 0.5
    const segs: { len: number; i: number }[] = []
    let totalLen = 0
    for (let i = 0; i < el.points.length - 1; i++) {
        const dx = el.points[i + 1][0] - el.points[i][0]
        const dy = el.points[i + 1][1] - el.points[i][1]
        segs.push({ len: Math.hypot(dx, dy), i })
        totalLen += segs[segs.length - 1].len
    }
    let targetDist = t * totalLen
    let lx = el.x, ly = el.y
    for (const seg of segs) {
        if (targetDist <= seg.len || seg === segs[segs.length - 1]) {
            const frac = seg.len > 0 ? Math.min(1, targetDist / seg.len) : 0
            const a = el.points[seg.i], b = el.points[seg.i + 1]
            lx = el.x + a[0] + (b[0] - a[0]) * frac
            ly = el.y + a[1] + (b[1] - a[1]) * frac
            break
        }
        targetDist -= seg.len
    }

    const baseFontSize = el.fontSize || 14
    const fontSize = _lastSketchy ? Math.round(baseFontSize * 1.3) : baseFontSize
    ctx.font = `${el.fontWeight || 400} ${fontSize}px 'Architects Daughter'`
    const lines = el.label.split('\n')
    const lineHeight = fontSize * 1.2
    let maxWidth = 0
    for (const line of lines) {
        const w = ctx.measureText(line).width
        if (w > maxWidth) maxWidth = w
    }
    const pw = maxWidth + 6
    const ph = lineHeight * lines.length + 4
    const topY = ly - ph / 2
    ctx.globalAlpha = 1
    ctx.fillStyle = _lastCanvasBg
    ctx.beginPath()
    ctx.roundRect(lx - pw / 2, topY, pw, ph, 3)
    ctx.fill()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], lx, topY + 2 + lineHeight * (i + 0.5))
    }
}

// ── Viewport Culling ──

function getElementAABB(el: DrawingElement): { x1: number; y1: number; x2: number; y2: number } {
    if (el.points && el.points.length > 0) {
        // Arrow/line/freedraw: compute bounds from points
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const p of el.points) {
            const px = el.x + p[0], py = el.y + p[1]
            if (px < minX) minX = px
            if (py < minY) minY = py
            if (px > maxX) maxX = px
            if (py > maxY) maxY = py
        }
        return { x1: minX, y1: minY, x2: maxX, y2: maxY }
    }
    return { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height }
}

function isVisible(
    el: DrawingElement,
    viewL: number, viewT: number, viewR: number, viewB: number,
    margin: number,
): boolean {
    const b = getElementAABB(el)
    return b.x2 + margin >= viewL && b.x1 - margin <= viewR &&
        b.y2 + margin >= viewT && b.y1 - margin <= viewB
}

// ── Worker Message Handler ──

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let wasmReady = false
let _lastIsLight = false
let _lastSketchy = false
let _lastCanvasBg = ''
let _lastDefaultStroke = ''
let _lastHighlightColor = ''
let _editingElementId: string | null = null

// ── Static Cache Layer ──
let staticCanvas: OffscreenCanvas | null = null
let staticCtx: OffscreenCanvasRenderingContext2D | null = null
let cachedElementMap: Map<string, DrawingElement> = new Map()
let staticDirty = true // force full redraw on first render
let lastVp = { x: 0, y: 0, zoom: 0 }
let lastCw = 0, lastCh = 0
let lastTheme = ''
let lastSketchy = false
let lastEditingElementId: string | null = null

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data

    switch (msg.type) {
        case 'init': {
            try {
                await initWASM()
                wasmReady = true
                self.postMessage({ type: 'ready' })
            } catch (err) {
                console.error('[drawing-worker] init failed:', err)
                self.postMessage({ type: 'error', message: String(err) })
            }
            break
        }
        case 'render': {
            if (!wasmReady) return
            try {
                const state = msg.state as RenderState
                const isLight = state.theme === 'light'
                const cw = state.canvasWidth
                const ch = state.canvasHeight
                const vp = state.viewport
                const dpr = state.dpr

                // Track render state for helpers
                _lastIsLight = isLight
                _lastSketchy = state.sketchy
                _lastCanvasBg = state.canvasBg
                _lastDefaultStroke = state.defaultStroke
                _lastHighlightColor = state.highlightColor
                _editingElementId = state.editingElementId

                // Invalidate static cache when editing element changes (text must hide/show)
                if (state.editingElementId !== lastEditingElementId) {
                    staticDirty = true
                    lastEditingElementId = state.editingElementId
                }

                // Detect global changes that require full static cache rebuild
                const globalChanged = state.fullSync ||
                    cw !== lastCw || ch !== lastCh ||
                    vp.x !== lastVp.x || vp.y !== lastVp.y || vp.zoom !== lastVp.zoom ||
                    state.theme !== lastTheme || state.sketchy !== lastSketchy

                lastVp = { ...vp }; lastCw = cw; lastCh = ch
                lastTheme = state.theme; lastSketchy = state.sketchy

                // Create/resize canvases as needed
                if (!canvas || canvas.width !== cw || canvas.height !== ch) {
                    canvas = new OffscreenCanvas(cw, ch)
                    ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
                    staticDirty = true
                }
                if (!staticCanvas || staticCanvas.width !== cw || staticCanvas.height !== ch) {
                    staticCanvas = new OffscreenCanvas(cw, ch)
                    staticCtx = staticCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
                    staticDirty = true
                }
                if (!ctx || !staticCtx) return

                // Compute visible world-space rectangle for culling
                const invZoom = 1 / vp.zoom
                const viewL = -vp.x * invZoom
                const viewT = -vp.y * invZoom
                const viewR = viewL + (cw / dpr) * invZoom
                const viewB = viewT + (ch / dpr) * invZoom
                const MARGIN = 100

                // Apply state updates to element map
                if (state.fullSync && state.elements) {
                    cachedElementMap.clear()
                    for (const el of state.elements) {
                        cachedElementMap.set(el.id, el)
                    }
                    staticDirty = true
                } else {
                    // Apply diffs
                    if (state.removedIds) {
                        for (const id of state.removedIds) {
                            cachedElementMap.delete(id)
                        }
                        staticDirty = true
                    }
                    if (state.dirtyElements) {
                        for (const el of state.dirtyElements) {
                            cachedElementMap.set(el.id, el)
                        }
                    }
                }

                const allElements = Array.from(cachedElementMap.values())
                const dirtyIds = state.dirtyElements
                    ? new Set(state.dirtyElements.map(e => e.id))
                    : new Set<string>()

                // ── Rebuild static cache if needed ──
                if (globalChanged || staticDirty) {
                    staticCtx.setTransform(1, 0, 0, 1, 0, 0)
                    staticCtx.clearRect(0, 0, cw, ch)
                    staticCtx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, vp.x * dpr, vp.y * dpr)

                    for (const el of allElements) {
                        try {
                            if (!isVisible(el, viewL, viewT, viewR, viewB, MARGIN)) continue
                            drawElement(staticCtx, el, isLight)
                        } catch { /* skip */ }
                    }
                    staticDirty = false
                    dirtyIds.clear() // all elements are now in static cache
                } else if (dirtyIds.size > 0) {
                    // Partial update: redraw only dirty elements into static cache
                    // Full redraw of static cache is simpler and more correct than
                    // trying to erase individual elements (overlapping elements, anti-aliasing)
                    staticCtx.setTransform(1, 0, 0, 1, 0, 0)
                    staticCtx.clearRect(0, 0, cw, ch)
                    staticCtx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, vp.x * dpr, vp.y * dpr)

                    for (const el of allElements) {
                        try {
                            if (!isVisible(el, viewL, viewT, viewR, viewB, MARGIN)) continue
                            drawElement(staticCtx, el, isLight)
                        } catch { /* skip */ }
                    }
                }

                // ── Compose final frame ──
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.clearRect(0, 0, cw, ch)

                // Blit static cache
                ctx.drawImage(staticCanvas, 0, 0)

                // Draw current in-progress element (not in cache)
                if (state.currentElement) {
                    ctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, vp.x * dpr, vp.y * dpr)
                    try {
                        drawElement(ctx, state.currentElement, isLight)
                    } catch { /* skip */ }
                }

                // Draw highlight glow for pending-delete elements
                if (state.highlightedIds.length > 0) {
                    ctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, vp.x * dpr, vp.y * dpr)
                    const highlightSet = new Set(state.highlightedIds)
                    for (const el of allElements) {
                        if (!highlightSet.has(el.id)) continue
                        if (!isVisible(el, viewL, viewT, viewR, viewB, MARGIN)) continue
                        ctx.save()
                        ctx.strokeStyle = _lastHighlightColor
                        ctx.lineWidth = 3
                        ctx.shadowColor = _lastHighlightColor
                        ctx.shadowBlur = 12
                        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(Date.now() / 300)
                        const pad = 6
                        ctx.beginPath()
                        ctx.roundRect(el.x - pad, el.y - pad, el.width + pad * 2, el.height + pad * 2, 8)
                        ctx.stroke()
                        ctx.restore()
                    }
                }

                // Send rendered frame as ImageBitmap (zero-copy transfer)
                const bitmap = canvas.transferToImageBitmap()
                    ; (self as unknown as Worker).postMessage({ type: 'frame', bitmap }, [bitmap] as any)
            } catch (err) {
                console.error('[drawing-worker] render failed:', err)
                self.postMessage({ type: 'rendered' }) // signal done to avoid blocking
            }
            break
        }
    }
}
