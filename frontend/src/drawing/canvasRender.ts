/**
 * Canvas2D rendering functions for the drawing layer.
 * Each function draws directly to a CanvasRenderingContext2D.
 */
import { type DrawingElement, type AnchorPoint, ANCHOR_RADIUS, HANDLE_SIZE, isArrowType } from './types'

// ── Utilities ──

/** Stable numeric hash from element ID */
function hashId(id: string): number {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = ((h << 5) - h + id.charCodeAt(i)) | 0
    }
    return Math.abs(h)
}

/** Seeded random — deterministic per element */
function sr(x: number, y: number, i: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233 + i * 4356.13) * 43758.5453
    return n - Math.floor(n)
}

/** Resolve CSS color — reads var() from the DOM computed style */
function resolveColor(color: string | undefined, fallback = '#ffffff'): string {
    if (!color) return fallback
    if (color.startsWith('var(')) {
        const m = color.match(/var\(\s*([^,)]+)/)
        if (m) {
            const val = getComputedStyle(document.documentElement).getPropertyValue(m[1].trim()).trim()
            if (val) return val
        }
        // Extract inline fallback from var(--name, fallback)
        const fb = color.match(/,\s*(.+)\)/)
        return fb ? fb[1].trim() : fallback
    }
    return color
}

/** Read theme colors from computed style (call once per render frame) */
let _cachedThemeColors: { handleFill: string; canvasBg: string; textPrimary: string; isLight: boolean } | null = null
let _themeColorFrame = -1

function getThemeColors() {
    const frame = performance.now()
    // Cache for ~16ms (1 frame)
    if (_cachedThemeColors && frame - _themeColorFrame < 16) return _cachedThemeColors
    const cs = getComputedStyle(document.documentElement)
    _cachedThemeColors = {
        handleFill: cs.getPropertyValue('--color-elevated').trim() || '#ffffff',
        canvasBg: cs.getPropertyValue('--color-app').trim() || '#151310',
        textPrimary: cs.getPropertyValue('--color-text-primary').trim() || '#e8e8f0',
        isLight: document.documentElement.dataset.theme === 'light',
    }
    _themeColorFrame = frame
    return _cachedThemeColors
}

/**
 * Swap white ↔ black drawing colors for the active theme.
 * Only exact palette matches are swapped — other colors are untouched.
 * Render-time only; stored data is unchanged.
 */
const LIGHT_SWAP: Record<string, string> = {
    '#e8e8f0': '#1e1e2e',   // near-white → near-black
    '#e0e0e0': '#2a2a2a',   // default stroke gray → dark gray
    '#ffffff': '#000000',   // pure white → pure black
    '#fff': '#000',
    '#1e1e2e': '#e8e8f0',   // near-black → near-white
    '#000000': '#ffffff',   // pure black → pure white
    '#000': '#fff',
}

export function remapForTheme(color: string): string {
    const { isLight } = getThemeColors()
    if (!isLight) return color
    const key = color.trim().toLowerCase()
    return LIGHT_SWAP[key] ?? color
}

// ── Sketchy Helpers ──

function drawSketchLine(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, x2: number, y2: number,
    color: string, sw: number, seed: number, pass: number,
    overshoot = 6, dash = ''
): void {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len < 1) return
    const nx = dx / len, ny = dy / len

    const osStart = overshoot * (0.1 + sr(seed, pass, 1) * 1.2)
    const osEnd = overshoot * (0.1 + sr(seed, pass, 2) * 1.2)

    const perpAmount = sw * (0.2 + sr(seed, pass, 3) * 0.5) * (sr(seed, pass, 4) > 0.5 ? 1 : -1)
    const ox = -ny * perpAmount, oy = nx * perpAmount

    const sx = x1 - nx * osStart + ox
    const sy = y1 - ny * osStart + oy
    const ex = x2 + nx * osEnd + ox
    const ey = y2 + ny * osEnd + oy

    const t1 = 0.3 + (sr(seed, pass, 5) - 0.5) * 0.1
    const t2 = 0.7 + (sr(seed, pass, 6) - 0.5) * 0.1
    const wobbleAmount = len * 0.01 + sw * 0.8
    const c1x = sx + (ex - sx) * t1 + (sr(seed, pass, 7) - 0.5) * wobbleAmount
    const c1y = sy + (ey - sy) * t1 + (sr(seed, pass, 8) - 0.5) * wobbleAmount
    const c2x = sx + (ex - sx) * t2 + (sr(seed, pass, 9) - 0.5) * wobbleAmount
    const c2y = sy + (ey - sy) * t2 + (sr(seed, pass, 10) - 0.5) * wobbleAmount

    const op = pass === 0 ? (0.7 + sr(seed, pass, 11) * 0.2) : (0.15 + sr(seed, pass, 12) * 0.2)
    const w = sw * (pass === 0 ? (0.8 + sr(seed, pass, 13) * 0.4) : (0.3 + sr(seed, pass, 14) * 0.35))

    ctx.save()
    ctx.globalAlpha = op
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.lineCap = 'round'
    if (dash) {
        const parts = dash.split(/[\s,]+/).map(Number)
        ctx.setLineDash(parts)
    }
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
    ctx.stroke()
    ctx.restore()
}

function drawSketchRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    color: string, sw: number, seed: number, rx: number = 0, dash = ''
): void {
    rx = Math.min(rx, Math.min(w, h) / 2)
    if (rx <= 0) {
        const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        for (let e = 0; e < 4; e++) {
            const [ax, ay] = corners[e]
            const [bx, by] = corners[(e + 1) % 4]
            for (let p = 0; p < 2; p++) {
                drawSketchLine(ctx, ax, ay, bx, by, color, sw, seed + e * 137 + p * 31, p, 6, dash)
            }
        }
    } else {
        const edges: [number, number, number, number][] = [
            [x + rx, y, x + w - rx, y],
            [x + w, y + rx, x + w, y + h - rx],
            [x + w - rx, y + h, x + rx, y + h],
            [x, y + h - rx, x, y + rx],
        ]
        const arcs: [number, number, number, number, number, number][] = [
            [x + w, y, x + w, y + rx, x + w - rx, y],
            [x + w, y + h, x + w - rx, y + h, x + w, y + h - rx],
            [x, y + h, x, y + h - rx, x + rx, y + h],
            [x, y, x + rx, y, x, y + rx],
        ]
        for (let e = 0; e < 4; e++) {
            const [ax, ay, bx, by] = edges[e]
            for (let p = 0; p < 2; p++) {
                drawSketchLine(ctx, ax, ay, bx, by, color, sw, seed + e * 137 + p * 31, p, 6, dash)
            }
            // Corner arc
            const [cx, cy, ex, ey] = arcs[e]
            const j1 = (sr(seed, e + 40, 0) - 0.5) * 1.5
            const j2 = (sr(seed, e + 41, 0) - 0.5) * 1.5
            ctx.save()
            ctx.strokeStyle = color
            ctx.lineWidth = sw
            ctx.lineCap = 'round'
            if (dash) {
                const parts = dash.split(/[\s,]+/).map(Number)
                ctx.setLineDash(parts)
            }
            ctx.beginPath()
            ctx.moveTo(bx + j1, by + j2)
            ctx.quadraticCurveTo(cx + j1, cy + j2, ex + j1, ey + j2)
            ctx.stroke()
            ctx.restore()
        }
    }
}

function drawSketchEllipse(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, rx: number, ry: number,
    color: string, sw: number, seed: number, dash = ''
): void {
    for (let p = 0; p < 2; p++) {
        const steps = 24
        const points: [number, number][] = []
        const startOffset = (sr(seed, p, 80) - 0.5) * 0.15
        const endOffset = 1.0 + (sr(seed, p, 81) - 0.5) * 0.1
        for (let i = 0; i <= steps; i++) {
            const t = i / steps
            const a = (startOffset + t * (endOffset - startOffset)) * Math.PI * 2
            const wobbleR = sw * (0.6 + sr(seed + p * 50, i, 0) * 0.8)
            const px = cx + (rx + (sr(seed + p * 50, i, 2) - 0.5) * wobbleR) * Math.cos(a)
            const py = cy + (ry + (sr(seed + p * 50, i, 3) - 0.5) * wobbleR) * Math.sin(a)
            points.push([px, py])
        }
        const op = p === 0 ? 0.75 : 0.2
        const w = sw * (p === 0 ? 1 : (0.4 + sr(seed, p, 90) * 0.3))

        ctx.save()
        ctx.globalAlpha = op
        ctx.strokeStyle = color
        ctx.lineWidth = w
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (dash) {
            const parts = dash.split(/[\s,]+/).map(Number)
            ctx.setLineDash(parts)
        }
        ctx.beginPath()
        ctx.moveTo(points[0][0], points[0][1])
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1], cur = points[i]
            const cpx = (prev[0] + cur[0]) / 2 + (sr(seed, i + p * 100, 4) - 0.5) * sw * 0.6
            const cpy = (prev[1] + cur[1]) / 2 + (sr(seed, i + p * 100, 5) - 0.5) * sw * 0.6
            ctx.quadraticCurveTo(cpx, cpy, cur[0], cur[1])
        }
        ctx.stroke()
        ctx.restore()
    }
}

function drawSketchDiamond(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, w: number, h: number,
    color: string, sw: number, seed: number, dash = ''
): void {
    const pts: [number, number][] = [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]]
    for (let e = 0; e < 4; e++) {
        for (let p = 0; p < 2; p++) {
            drawSketchLine(ctx, pts[e][0], pts[e][1], pts[(e + 1) % 4][0], pts[(e + 1) % 4][1],
                color, sw, seed + e * 137 + p * 31, p, 6, dash)
        }
    }
}

function drawSketchFill(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    color: string, seed: number, clipFn: (ctx: CanvasRenderingContext2D) => void,
    style: 'solid' | 'hachure'
): void {
    ctx.save()
    // Apply clip path
    ctx.beginPath()
    clipFn(ctx)
    ctx.clip()

    if (style === 'hachure') {
        const baseAngle = 0.7 + (sr(seed, seed, 50) - 0.5) * 0.2
        const cos = Math.cos(baseAngle), sin = Math.sin(baseAngle)
        const diag = Math.hypot(w, h) + 20
        const spacing = 14 + sr(seed, seed, 51) * 4
        const numStrokes = Math.ceil(diag / spacing)

        for (let i = 0; i < numStrokes; i++) {
            const t = i / numStrokes
            const offset = -diag / 2 + t * diag
            const cxc = x + w / 2, cyc = y + h / 2
            const sx = cxc + cos * (-diag / 2) + sin * offset
            const sy = cyc + sin * (-diag / 2) - cos * offset
            const ex = cxc + cos * (diag / 2) + sin * offset
            const ey = cyc + sin * (diag / 2) - cos * offset

            const strokeW = 4 + sr(seed, i, 52) * 3
            const op = 0.2 + sr(seed, i, 53) * 0.15
            const mx = (sx + ex) / 2 + (sr(seed, i, 54) - 0.5) * 3
            const my = (sy + ey) / 2 + (sr(seed, i, 55) - 0.5) * 3

            ctx.globalAlpha = op
            ctx.strokeStyle = color
            ctx.lineWidth = strokeW
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.quadraticCurveTo(mx, my, ex, ey)
            ctx.stroke()
        }
    } else {
        // 'solid' — dense marker wash
        const baseAngle = 0.5 + (sr(seed, seed, 60) - 0.5) * 0.3
        const cos = Math.cos(baseAngle), sin = Math.sin(baseAngle)
        const diag = Math.hypot(w, h) + 30
        const spacing = 5 + sr(seed, seed, 61) * 2
        const numStrokes = Math.ceil(diag / spacing)
        const bleed = 3 + sr(seed, seed, 62) * 2

        for (let i = 0; i < numStrokes; i++) {
            const t = i / numStrokes
            const offset = -diag / 2 + t * diag
            const cxc = x + w / 2, cyc = y + h / 2
            const sx = cxc + cos * (-diag / 2 - bleed) + sin * offset
            const sy = cyc + sin * (-diag / 2 - bleed) - cos * offset
            const ex = cxc + cos * (diag / 2 + bleed) + sin * offset
            const ey = cyc + sin * (diag / 2 + bleed) - cos * offset

            const strokeW = 4 + sr(seed, i, 63) * 3
            const op = 0.05 + sr(seed, i, 64) * 0.06

            ctx.globalAlpha = op
            ctx.strokeStyle = color
            ctx.lineWidth = strokeW
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.lineTo(ex, ey)
            ctx.stroke()
        }
    }
    ctx.restore()
}

// ── Arrow Heads ──

function drawArrowHead(
    ctx: CanvasRenderingContext2D,
    el: DrawingElement, color: string, sw: number, which: 'start' | 'end', sketchy: boolean
): void {
    if (!el.points || el.points.length < 2) return

    const style = which === 'end' ? (el.arrowEnd || 'arrow') : (el.arrowStart || 'none')
    if (style === 'none') return

    let tip: number[], prev: number[]
    if (which === 'end') {
        tip = el.points[el.points.length - 1]
        prev = el.points[el.points.length - 2]
    } else {
        tip = el.points[0]
        prev = el.points[1]
    }

    const ax = el.x + tip[0], ay = el.y + tip[1]
    const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0])
    const size = 6 + sw * 3
    const seed = hashId(el.id) + (which === 'start' ? 500 : 0)

    if (sketchy) {
        switch (style) {
            case 'dot': {
                const r = 2 + sw * 1.5
                for (let p = 0; p < 2; p++) {
                    const steps = 12
                    const op = p === 0 ? 0.8 : 0.25
                    ctx.save()
                    ctx.globalAlpha = op
                    ctx.fillStyle = color
                    ctx.beginPath()
                    for (let i = 0; i <= steps; i++) {
                        const a = (i / steps) * Math.PI * 2
                        const jx = (sr(seed + p * 40, i, 0) - 0.5) * sw * 0.6
                        const jy = (sr(seed + p * 40, i, 1) - 0.5) * sw * 0.6
                        const px = ax + r * Math.cos(a) + jx
                        const py = ay + r * Math.sin(a) + jy
                        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
                    }
                    ctx.closePath()
                    ctx.fill()
                    ctx.restore()
                }
                break
            }
            case 'arrow': {
                const p1x = ax - size * Math.cos(angle - Math.PI / 6)
                const p1y = ay - size * Math.sin(angle - Math.PI / 6)
                const p2x = ax - size * Math.cos(angle + Math.PI / 6)
                const p2y = ay - size * Math.sin(angle + Math.PI / 6)
                const j = sw * 0.4
                const jt = (i: number) => (sr(seed, i, 20) - 0.5) * j
                // Filled triangle
                ctx.save()
                ctx.globalAlpha = 0.7
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.moveTo(ax + jt(0), ay + jt(1))
                ctx.lineTo(p1x + jt(2), p1y + jt(3))
                ctx.lineTo(p2x + jt(4), p2y + jt(5))
                ctx.closePath()
                ctx.fill()
                ctx.restore()
                // Outline
                ctx.save()
                ctx.globalAlpha = 0.5
                ctx.strokeStyle = color
                ctx.lineWidth = sw * 0.5
                ctx.lineJoin = 'round'
                ctx.beginPath()
                ctx.moveTo(ax + jt(6), ay + jt(7))
                ctx.lineTo(p1x + jt(8), p1y + jt(9))
                ctx.lineTo(p2x + jt(10), p2y + jt(11))
                ctx.closePath()
                ctx.stroke()
                ctx.restore()
                break
            }
            case 'triangle': {
                const p1x = ax - size * Math.cos(angle - Math.PI / 6)
                const p1y = ay - size * Math.sin(angle - Math.PI / 6)
                const p2x = ax - size * Math.cos(angle + Math.PI / 6)
                const p2y = ay - size * Math.sin(angle + Math.PI / 6)
                for (let p = 0; p < 2; p++) {
                    drawSketchLine(ctx, ax, ay, p1x, p1y, color, sw * 0.7, seed + p * 50, p, 2)
                    drawSketchLine(ctx, ax, ay, p2x, p2y, color, sw * 0.7, seed + 200 + p * 50, p, 2)
                    drawSketchLine(ctx, p1x, p1y, p2x, p2y, color, sw * 0.7, seed + 400 + p * 50, p, 2)
                }
                break
            }
            case 'bar': {
                const half = size * 0.6
                const bx1 = ax + half * Math.cos(angle + Math.PI / 2)
                const by1 = ay + half * Math.sin(angle + Math.PI / 2)
                const bx2 = ax - half * Math.cos(angle + Math.PI / 2)
                const by2 = ay - half * Math.sin(angle + Math.PI / 2)
                for (let p = 0; p < 2; p++) {
                    drawSketchLine(ctx, bx1, by1, bx2, by2, color, sw, seed + p * 50, p, 2)
                }
                break
            }
            case 'diamond': {
                const half = size * 0.6
                const pts: [number, number][] = [
                    [ax + half * Math.cos(angle), ay + half * Math.sin(angle)],
                    [ax + half * Math.cos(angle + Math.PI / 2), ay + half * Math.sin(angle + Math.PI / 2)],
                    [ax - half * Math.cos(angle), ay - half * Math.sin(angle)],
                    [ax - half * Math.cos(angle - Math.PI / 2), ay - half * Math.sin(angle - Math.PI / 2)],
                ]
                for (let e = 0; e < 4; e++) {
                    drawSketchLine(ctx, pts[e][0], pts[e][1], pts[(e + 1) % 4][0], pts[(e + 1) % 4][1],
                        color, sw * 0.7, seed + e * 100, 0, 1)
                }
                break
            }
        }
        return
    }

    // Normal mode arrow heads
    switch (style) {
        case 'dot': {
            const r = 2 + sw * 1.5
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(ax, ay, r, 0, Math.PI * 2)
            ctx.fill()
            break
        }
        case 'arrow': {
            const p1x = ax - size * Math.cos(angle - Math.PI / 6)
            const p1y = ay - size * Math.sin(angle - Math.PI / 6)
            const p2x = ax - size * Math.cos(angle + Math.PI / 6)
            const p2y = ay - size * Math.sin(angle + Math.PI / 6)
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.moveTo(ax, ay); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y)
            ctx.closePath()
            ctx.fill()
            break
        }
        case 'triangle': {
            const p1x = ax - size * Math.cos(angle - Math.PI / 6)
            const p1y = ay - size * Math.sin(angle - Math.PI / 6)
            const p2x = ax - size * Math.cos(angle + Math.PI / 6)
            const p2y = ay - size * Math.sin(angle + Math.PI / 6)
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1, sw * 0.6)
            ctx.lineJoin = 'round'
            ctx.beginPath()
            ctx.moveTo(ax, ay); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y)
            ctx.closePath()
            ctx.stroke()
            break
        }
        case 'bar': {
            const half = size * 0.6
            const bx1 = ax + half * Math.cos(angle + Math.PI / 2)
            const by1 = ay + half * Math.sin(angle + Math.PI / 2)
            const bx2 = ax - half * Math.cos(angle + Math.PI / 2)
            const by2 = ay - half * Math.sin(angle + Math.PI / 2)
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1.5, sw)
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by2)
            ctx.stroke()
            break
        }
        case 'diamond': {
            const half = size * 0.6
            const pts = [
                [ax + half * Math.cos(angle), ay + half * Math.sin(angle)],
                [ax + half * Math.cos(angle + Math.PI / 2), ay + half * Math.sin(angle + Math.PI / 2)],
                [ax - half * Math.cos(angle), ay - half * Math.sin(angle)],
                [ax - half * Math.cos(angle - Math.PI / 2), ay - half * Math.sin(angle - Math.PI / 2)],
            ]
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.moveTo(pts[0][0], pts[0][1])
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
            ctx.closePath()
            ctx.fill()
            break
        }
    }
}

// ── Arrow Label ──

function drawArrowLabel(
    ctx: CanvasRenderingContext2D,
    el: DrawingElement, color: string, sketchy: boolean
): void {
    if (!el.label || !el.points || el.points.length < 2) return
    const t = el.labelT ?? 0.5

    const segs: { len: number; i: number }[] = []
    let totalLen = 0
    for (let i = 0; i < el.points.length - 1; i++) {
        const dx = el.points[i + 1][0] - el.points[i][0]
        const dy = el.points[i + 1][1] - el.points[i][1]
        const len = Math.hypot(dx, dy)
        segs.push({ len, i })
        totalLen += len
    }

    let targetDist = t * totalLen
    let px = el.points[0][0], py = el.points[0][1]
    for (const seg of segs) {
        if (targetDist <= seg.len || seg === segs[segs.length - 1]) {
            const frac = seg.len > 0 ? Math.min(1, targetDist / seg.len) : 0
            const a = el.points[seg.i], b = el.points[seg.i + 1]
            px = a[0] + (b[0] - a[0]) * frac
            py = a[1] + (b[1] - a[1]) * frac
            break
        }
        targetDist -= seg.len
    }

    const ax = el.x + px, ay = el.y + py
    const fontSize = sketchy ? Math.round((el.fontSize || 14) * 1.3) : (el.fontSize || 14)
    const font = sketchy
        ? "'Architects Daughter', Caveat, cursive"
        : (el.fontFamily ? `${el.fontFamily}, system-ui, sans-serif` : 'Inter, system-ui, sans-serif')
    const fw = el.fontWeight || 400
    const textColor = remapForTheme(el.textColor || color)

    const lines = el.label.split('\n')
    const lineH = fontSize * 1.3
    const maxLineLen = Math.max(...lines.map(l => l.length))
    const textWidth = maxLineLen * fontSize * 0.6
    const textHeight = lineH * lines.length
    const padX = 6, padY = 2

    // Background rect
    ctx.fillStyle = getThemeColors().canvasBg
    ctx.beginPath()
    const rr = 4 // border radius
    const bx = ax - textWidth / 2 - padX, by = ay - textHeight / 2 - padY
    const bw = textWidth + padX * 2, bh = textHeight + padY * 2
    ctx.roundRect(bx, by, bw, bh, rr)
    ctx.fill()

    // Text
    ctx.fillStyle = textColor
    ctx.font = `${fw} ${fontSize}px ${font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (lines.length <= 1) {
        ctx.fillText(el.label, ax, ay)
    } else {
        const startY = ay - (lineH * (lines.length - 1)) / 2
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i] || ' ', ax, startY + i * lineH)
        }
    }
}

// ── Main Element Drawing ──

export function drawElement(
    ctx: CanvasRenderingContext2D,
    el: DrawingElement, _selected: boolean, hideText = false, sketchy = false
): void {
    const color = remapForTheme(el.strokeColor)
    const sw = el.strokeWidth
    const fill = el.backgroundColor
    const safeFill = fill === 'transparent' ? 'none' : (fill ? remapForTheme(fill) : 'none')
    const textFill = remapForTheme(el.textColor || el.strokeColor)
    const font = sketchy
        ? "'Architects Daughter', Caveat, cursive"
        : (el.fontFamily ? `${el.fontFamily}, system-ui, sans-serif` : 'Inter, system-ui, sans-serif')
    const fw = el.fontWeight || 400
    const textSize = sketchy ? Math.round((el.fontSize || 14) * 1.3) : (el.fontSize || 14)
    const rx = el.borderRadius ?? (el.roundness ? 8 : 0)
    const seed = hashId(el.id)
    const dash = el.strokeDasharray || ''

    if (el.opacity != null && el.opacity < 1) {
        ctx.save()
        ctx.globalAlpha = el.opacity
    }

    switch (el.type) {
        case 'rectangle': {
            if (sketchy) {
                const fs = el.fillStyle || 'hachure'
                if (safeFill !== 'none') {
                    drawSketchFill(ctx, el.x, el.y, el.width, el.height, safeFill, seed,
                        (c) => { c.rect(el.x, el.y, el.width, el.height) }, fs)
                }
                drawSketchRect(ctx, el.x, el.y, el.width, el.height, color, sw, seed, rx, dash)
            } else {
                ctx.strokeStyle = color
                ctx.lineWidth = sw
                if (safeFill !== 'none') ctx.fillStyle = safeFill
                if (dash) ctx.setLineDash(dash.split(/[\s,]+/).map(Number))
                ctx.beginPath()
                if (rx > 0) {
                    ctx.roundRect(el.x, el.y, el.width, el.height, rx)
                } else {
                    ctx.rect(el.x, el.y, el.width, el.height)
                }
                if (safeFill !== 'none') ctx.fill()
                ctx.stroke()
                if (dash) ctx.setLineDash([])
            }
            break
        }
        case 'ellipse': {
            const cx = el.x + el.width / 2, cy = el.y + el.height / 2
            if (sketchy) {
                const fs = el.fillStyle || 'hachure'
                if (safeFill !== 'none') {
                    drawSketchFill(ctx, el.x, el.y, el.width, el.height, safeFill, seed + 500,
                        (c) => { c.ellipse(cx, cy, el.width / 2, el.height / 2, 0, 0, Math.PI * 2) }, fs)
                }
                drawSketchEllipse(ctx, cx, cy, el.width / 2, el.height / 2, color, sw, seed, dash)
            } else {
                ctx.strokeStyle = color
                ctx.lineWidth = sw
                if (safeFill !== 'none') ctx.fillStyle = safeFill
                if (dash) ctx.setLineDash(dash.split(/[\s,]+/).map(Number))
                ctx.beginPath()
                ctx.ellipse(cx, cy, el.width / 2, el.height / 2, 0, 0, Math.PI * 2)
                if (safeFill !== 'none') ctx.fill()
                ctx.stroke()
                if (dash) ctx.setLineDash([])
            }
            break
        }
        case 'diamond': {
            const cx = el.x + el.width / 2, cy = el.y + el.height / 2
            if (sketchy) {
                const fs = el.fillStyle || 'hachure'
                if (safeFill !== 'none') {
                    drawSketchFill(ctx, el.x, el.y, el.width, el.height, safeFill, seed + 700,
                        (c) => {
                            c.moveTo(cx, el.y)
                            c.lineTo(el.x + el.width, cy)
                            c.lineTo(cx, el.y + el.height)
                            c.lineTo(el.x, cy)
                            c.closePath()
                        }, fs)
                }
                drawSketchDiamond(ctx, cx, cy, el.width, el.height, color, sw, seed, dash)
            } else {
                ctx.strokeStyle = color
                ctx.lineWidth = sw
                if (safeFill !== 'none') ctx.fillStyle = safeFill
                if (dash) ctx.setLineDash(dash.split(/[\s,]+/).map(Number))
                ctx.beginPath()
                ctx.moveTo(cx, el.y)
                ctx.lineTo(el.x + el.width, cy)
                ctx.lineTo(cx, el.y + el.height)
                ctx.lineTo(el.x, cy)
                ctx.closePath()
                if (safeFill !== 'none') ctx.fill()
                ctx.stroke()
                if (dash) ctx.setLineDash([])
            }
            break
        }
        case 'line':
        case 'arrow':
        case 'ortho-arrow': {
            if (!el.points || el.points.length < 2) break
            if (sketchy) {
                for (let i = 0; i < el.points.length - 1; i++) {
                    const px1 = el.x + el.points[i][0], py1 = el.y + el.points[i][1]
                    const px2 = el.x + el.points[i + 1][0], py2 = el.y + el.points[i + 1][1]
                    for (let p = 0; p < 2; p++) {
                        drawSketchLine(ctx, px1, py1, px2, py2, color, sw, seed + i * 100, p, 3, dash)
                    }
                }
            } else {
                ctx.strokeStyle = color
                ctx.lineWidth = sw
                if (dash) ctx.setLineDash(dash.split(/[\s,]+/).map(Number))
                ctx.beginPath()
                ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1])
                for (let i = 1; i < el.points.length; i++) {
                    ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1])
                }
                ctx.stroke()
                if (dash) ctx.setLineDash([])
            }
            if (el.type !== 'line') drawArrowHead(ctx, el, color, sw, 'end', sketchy)
            if (el.arrowStart && el.arrowStart !== 'none') drawArrowHead(ctx, el, color, sw, 'start', sketchy)
            if (!hideText && el.label && el.points.length >= 2) {
                drawArrowLabel(ctx, el, color, sketchy)
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
            if (dash) ctx.setLineDash(dash.split(/[\s,]+/).map(Number))
            ctx.beginPath()
            ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1])
            for (let i = 1; i < el.points.length; i++) {
                ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1])
            }
            ctx.stroke()
            if (dash) ctx.setLineDash([])
            if (el.opacity != null && el.opacity < 1) ctx.restore()
            return
        }
        case 'text': {
            if (hideText) break
            ctx.fillStyle = textFill
            ctx.font = `${fw} ${textSize}px ${font}`
            ctx.textBaseline = 'alphabetic'
            ctx.textAlign = 'start'
            const lines = (el.text || '').split('\n')
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i] || '', el.x, el.y + i * textSize * 1.3)
            }
            if (el.opacity != null && el.opacity < 1) ctx.restore()
            return
        }
        default: break
    }

    // Text inside shapes (rectangle, ellipse, diamond)
    if (!hideText && el.text && (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond')) {
        const cx = el.x + el.width / 2, cy = el.y + el.height / 2
        const lines = el.text.split('\n')
        const lineH = textSize * 1.3

        const hAlign = el.textAlign || 'center'
        const textX = hAlign === 'left' ? el.x + 8 : hAlign === 'right' ? el.x + el.width - 8 : cx

        const vAlign = el.verticalAlign || 'center'
        const totalTextH = lineH * lines.length
        let textY: number
        if (vAlign === 'top') {
            textY = el.y + 8 + textSize
        } else if (vAlign === 'bottom') {
            textY = el.y + el.height - totalTextH - 8 + textSize
        } else {
            textY = lines.length <= 1
                ? cy + textSize * 0.35
                : cy - (lineH * (lines.length - 1)) / 2 + textSize * 0.35
        }

        ctx.fillStyle = textFill
        ctx.font = `${fw} ${textSize}px ${font}`
        ctx.textAlign = hAlign === 'left' ? 'start' : hAlign === 'right' ? 'end' : 'center'
        ctx.textBaseline = 'alphabetic'

        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i] || '', textX, textY + i * lineH)
        }
    }

    if (el.opacity != null && el.opacity < 1) ctx.restore()
}

// ── Selection UI ──

export function drawSelectionUI(ctx: CanvasRenderingContext2D, el: DrawingElement): void {
    const ACCENT = '#6c9eff'

    if (isArrowType(el) && el.points && el.points.length >= 2) {
        // Arrow endpoint handles
        const sx = el.x + el.points[0][0], sy = el.y + el.points[0][1]
        const last = el.points[el.points.length - 1]
        const ex = el.x + last[0], ey = el.y + last[1]

        for (const [cx, cy] of [[sx, sy], [ex, ey]]) {
            ctx.fillStyle = getThemeColors().handleFill
            ctx.strokeStyle = ACCENT
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(cx, cy, 5, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }

        // Ortho midpoints
        if (el.type === 'ortho-arrow' && el.points.length >= 3) {
            for (let i = 0; i < el.points.length - 1; i++) {
                const mx = el.x + (el.points[i][0] + el.points[i + 1][0]) / 2
                const my = el.y + (el.points[i][1] + el.points[i + 1][1]) / 2
                ctx.fillStyle = getThemeColors().handleFill
                ctx.strokeStyle = ACCENT
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.roundRect(mx - 3, my - 3, 6, 6, 1)
                ctx.fill()
                ctx.stroke()
            }
        }

        // Arrowhead style indicator
        const arrowStyle = el.arrowEnd || 'arrow'
        ctx.fillStyle = ACCENT
        ctx.font = '10px Inter, system-ui, sans-serif'
        ctx.textAlign = 'start'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(arrowStyle === 'arrow' ? '▸' : arrowStyle === 'dot' ? '●' : '○', ex + 10, ey - 8)

    } else if (el.type !== 'freedraw' && el.type !== 'text' && el.type !== 'line') {
        // Bounding box
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 1
        ctx.setLineDash([4, 2])
        ctx.strokeRect(el.x, el.y, el.width, el.height)
        ctx.setLineDash([])

        // 8 resize handles
        const handles = [
            { hx: el.x, hy: el.y }, { hx: el.x + el.width / 2, hy: el.y },
            { hx: el.x + el.width, hy: el.y }, { hx: el.x + el.width, hy: el.y + el.height / 2 },
            { hx: el.x + el.width, hy: el.y + el.height }, { hx: el.x + el.width / 2, hy: el.y + el.height },
            { hx: el.x, hy: el.y + el.height }, { hx: el.x, hy: el.y + el.height / 2 },
        ]
        for (const h of handles) {
            ctx.fillStyle = getThemeColors().handleFill
            ctx.strokeStyle = ACCENT
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.roundRect(h.hx - HANDLE_SIZE, h.hy - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2, 1)
            ctx.fill()
            ctx.stroke()
        }
    } else if (el.type === 'text') {
        const lines = (el.text || '').split('\n')
        const maxLineLen = Math.max(...lines.map(l => l.length))
        const tw = maxLineLen * (el.fontSize ?? 16) * 0.6
        const lineH = (el.fontSize ?? 16) * 1.3
        const th = lineH * lines.length
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 1
        ctx.setLineDash([4, 2])
        ctx.strokeRect(el.x - 2, el.y - (el.fontSize ?? 16), tw + 4, th + 4)
        ctx.setLineDash([])
    }
}

// ── Anchors ──

export function drawAnchors(
    ctx: CanvasRenderingContext2D,
    hoveredElement: DrawingElement | null,
    hoveredAnchor: AnchorPoint | null,
    anchorsForElement: (el: DrawingElement) => AnchorPoint[],
): void {
    const ACCENT = '#6c9eff'

    if (hoveredElement) {
        for (const a of anchorsForElement(hoveredElement)) {
            const isHovered = hoveredAnchor?.elementId === a.elementId && hoveredAnchor?.side === a.side && hoveredAnchor?.t === a.t
            const fill = isHovered ? ACCENT : 'rgba(108,158,255,0.3)'
            const r = isHovered ? ANCHOR_RADIUS + 1 : ANCHOR_RADIUS
            ctx.fillStyle = fill
            ctx.strokeStyle = ACCENT
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }
    } else if (hoveredAnchor) {
        ctx.fillStyle = ACCENT
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(hoveredAnchor.x, hoveredAnchor.y, ANCHOR_RADIUS + 1, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
}

// ── Box Selection (for SelectHandler overlay) ──

export function drawBoxSelection(
    ctx: CanvasRenderingContext2D,
    boxStart: { x: number; y: number },
    boxEnd: { x: number; y: number },
    previewIds: Set<string>,
    elements: DrawingElement[],
): void {
    const ACCENT = '#6366f1'
    const x = Math.min(boxStart.x, boxEnd.x)
    const y = Math.min(boxStart.y, boxEnd.y)
    const w = Math.abs(boxEnd.x - boxStart.x)
    const h = Math.abs(boxEnd.y - boxStart.y)

    // Selection rect
    ctx.fillStyle = 'rgba(99,102,241,0.08)'
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1
    ctx.setLineDash([4, 2])
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    ctx.stroke()
    ctx.setLineDash([])

    // Preview highlights
    for (const el of elements) {
        if (previewIds.has(el.id)) {
            const pad = 4
            const b = { x: el.x, y: el.y, w: el.width, h: el.height }
            ctx.fillStyle = 'rgba(99,102,241,0.06)'
            ctx.strokeStyle = ACCENT
            ctx.lineWidth = 1.5
            ctx.setLineDash([4, 2])
            ctx.beginPath()
            ctx.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 3)
            ctx.fill()
            ctx.stroke()
            ctx.setLineDash([])
        }
    }
}

// ── Arrow Label Position (pure math helper) ──

/** Compute the point at labelT along the arrow path (world coords) */
export function getArrowLabelPos(el: DrawingElement): { x: number; y: number } | null {
    if (!el.points || el.points.length < 2) return null
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
    for (const seg of segs) {
        if (targetDist <= seg.len || seg === segs[segs.length - 1]) {
            const frac = seg.len > 0 ? Math.min(1, targetDist / seg.len) : 0
            const a = el.points[seg.i], b = el.points[seg.i + 1]
            return {
                x: el.x + a[0] + (b[0] - a[0]) * frac,
                y: el.y + a[1] + (b[1] - a[1]) * frac,
            }
        }
        targetDist -= seg.len
    }
    return null
}
