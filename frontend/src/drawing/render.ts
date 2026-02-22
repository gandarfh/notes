import { type DrawingElement, type AnchorPoint, ANCHOR_RADIUS, HANDLE_SIZE, isArrowType } from './types'

/** Render a label along an arrow/line path at position labelT */
export function renderArrowLabel(el: DrawingElement, color: string, sketchy = false): string {
    if (!el.label || !el.points || el.points.length < 2) return ''
    const t = el.labelT ?? 0.5

    // Compute total path length and find position at t
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
    const textColor = el.textColor || color

    const lines = el.label.split('\n')
    const lineH = fontSize * 1.3
    // Estimate text dimensions for background
    const maxLineLen = Math.max(...lines.map(l => l.length))
    const textWidth = maxLineLen * fontSize * 0.6
    const textHeight = lineH * lines.length
    const padX = 6, padY = 2
    const bgRect = `<rect x="${ax - textWidth / 2 - padX}" y="${ay - textHeight / 2 - padY}" 
        width="${textWidth + padX * 2}" height="${textHeight + padY * 2}" 
        rx="4" fill="var(--color-canvas-bg, #0d0d12)"/>`

    if (lines.length <= 1) {
        return bgRect + `<text x="${ax}" y="${ay}" dy="0.35em" fill="${textColor}" font-size="${fontSize}" 
            font-family="${font}" font-weight="${fw}" text-anchor="middle">${el.label}</text>`
    }
    // Multi-line: center vertically
    const startY = ay - (lineH * (lines.length - 1)) / 2
    const tspans = lines.map((line, i) =>
        `<tspan x="${ax}" dy="${i === 0 ? '0.35em' : lineH}">${line || '&#160;'}</tspan>`
    ).join('')
    return bgRect + `<text x="${ax}" y="${startY}" fill="${textColor}" font-size="${fontSize}" 
        font-family="${font}" font-weight="${fw}" text-anchor="middle">${tspans}</text>`
}

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

function renderHead(el: DrawingElement, color: string, sw: number, which: 'start' | 'end', sketchy = false): string {
    if (!el.points || el.points.length < 2) return ''

    const style = which === 'end' ? (el.arrowEnd || 'arrow') : (el.arrowStart || 'none')
    if (style === 'none') return ''

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
    const seed = Math.round(ax * 7 + ay * 13 + (which === 'start' ? 500 : 0))

    if (sketchy) {
        // Hand-drawn arrowheads using sketch lines
        switch (style) {
            case 'dot': {
                const r = 2 + sw * 1.5
                // Draw a rough circle as a few arcs
                let svg = ''
                for (let p = 0; p < 2; p++) {
                    const steps = 12
                    let d = ''
                    for (let i = 0; i <= steps; i++) {
                        const a = (i / steps) * Math.PI * 2
                        const jx = (sr(seed + p * 40, i, 0) - 0.5) * sw * 0.6
                        const jy = (sr(seed + p * 40, i, 1) - 0.5) * sw * 0.6
                        const px = ax + r * Math.cos(a) + jx
                        const py = ay + r * Math.sin(a) + jy
                        d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`
                    }
                    d += ' Z'
                    const op = p === 0 ? 0.8 : 0.25
                    svg += `<path d="${d}" fill="${color}" stroke="none" opacity="${op}"/>`
                }
                return svg
            }
            case 'arrow': {
                const p1x = ax - size * Math.cos(angle - Math.PI / 6)
                const p1y = ay - size * Math.sin(angle - Math.PI / 6)
                const p2x = ax - size * Math.cos(angle + Math.PI / 6)
                const p2y = ay - size * Math.sin(angle + Math.PI / 6)
                // Filled wobbly triangle
                const j = sw * 0.4
                const jt = (i: number) => (sr(seed, i, 20) - 0.5) * j
                const d1 = `M ${ax + jt(0)} ${ay + jt(1)} L ${p1x + jt(2)} ${p1y + jt(3)} L ${p2x + jt(4)} ${p2y + jt(5)} Z`
                const d2 = `M ${ax + jt(6)} ${ay + jt(7)} L ${p1x + jt(8)} ${p1y + jt(9)} L ${p2x + jt(10)} ${p2y + jt(11)} Z`
                return `<path d="${d1}" fill="${color}" opacity="0.7" stroke="none"/>` +
                    `<path d="${d2}" fill="none" stroke="${color}" stroke-width="${sw * 0.5}" stroke-linejoin="round" opacity="0.5"/>`
            }
            case 'triangle': {
                const p1x = ax - size * Math.cos(angle - Math.PI / 6)
                const p1y = ay - size * Math.sin(angle - Math.PI / 6)
                const p2x = ax - size * Math.cos(angle + Math.PI / 6)
                const p2y = ay - size * Math.sin(angle + Math.PI / 6)
                let svg = ''
                for (let p = 0; p < 2; p++) {
                    svg += sketchLine(ax, ay, p1x, p1y, color, sw * 0.7, seed + p * 50, p, 2)
                    svg += sketchLine(ax, ay, p2x, p2y, color, sw * 0.7, seed + 200 + p * 50, p, 2)
                    svg += sketchLine(p1x, p1y, p2x, p2y, color, sw * 0.7, seed + 400 + p * 50, p, 2)
                }
                return svg
            }
            case 'bar': {
                const half = size * 0.6
                const bx1 = ax + half * Math.cos(angle + Math.PI / 2)
                const by1 = ay + half * Math.sin(angle + Math.PI / 2)
                const bx2 = ax - half * Math.cos(angle + Math.PI / 2)
                const by2 = ay - half * Math.sin(angle + Math.PI / 2)
                let svg = ''
                for (let p = 0; p < 2; p++) {
                    svg += sketchLine(bx1, by1, bx2, by2, color, sw, seed + p * 50, p, 2)
                }
                return svg
            }
            case 'diamond': {
                const half = size * 0.6
                const pts: [number, number][] = [
                    [ax + half * Math.cos(angle), ay + half * Math.sin(angle)],
                    [ax + half * Math.cos(angle + Math.PI / 2), ay + half * Math.sin(angle + Math.PI / 2)],
                    [ax - half * Math.cos(angle), ay - half * Math.sin(angle)],
                    [ax - half * Math.cos(angle - Math.PI / 2), ay - half * Math.sin(angle - Math.PI / 2)],
                ]
                let svg = ''
                for (let e = 0; e < 4; e++) {
                    svg += sketchLine(pts[e][0], pts[e][1], pts[(e + 1) % 4][0], pts[(e + 1) % 4][1],
                        color, sw * 0.7, seed + e * 100, 0, 1)
                }
                return svg
            }
            default: return ''
        }
    }

    switch (style) {
        case 'dot': {
            const r = 2 + sw * 1.5
            return `<circle cx="${ax}" cy="${ay}" r="${r}" fill="${color}"/>`
        }
        case 'arrow': {
            const p1x = ax - size * Math.cos(angle - Math.PI / 6)
            const p1y = ay - size * Math.sin(angle - Math.PI / 6)
            const p2x = ax - size * Math.cos(angle + Math.PI / 6)
            const p2y = ay - size * Math.sin(angle + Math.PI / 6)
            return `<polygon points="${ax},${ay} ${p1x},${p1y} ${p2x},${p2y}" fill="${color}"/>`
        }
        case 'triangle': {
            const p1x = ax - size * Math.cos(angle - Math.PI / 6)
            const p1y = ay - size * Math.sin(angle - Math.PI / 6)
            const p2x = ax - size * Math.cos(angle + Math.PI / 6)
            const p2y = ay - size * Math.sin(angle + Math.PI / 6)
            return `<polygon points="${ax},${ay} ${p1x},${p1y} ${p2x},${p2y}" fill="none" stroke="${color}" stroke-width="${Math.max(1, sw * 0.6)}" stroke-linejoin="round"/>`
        }
        case 'bar': {
            const half = size * 0.6
            const bx1 = ax + half * Math.cos(angle + Math.PI / 2)
            const by1 = ay + half * Math.sin(angle + Math.PI / 2)
            const bx2 = ax - half * Math.cos(angle + Math.PI / 2)
            const by2 = ay - half * Math.sin(angle + Math.PI / 2)
            return `<line x1="${bx1}" y1="${by1}" x2="${bx2}" y2="${by2}" stroke="${color}" stroke-width="${Math.max(1.5, sw)}" stroke-linecap="round"/>`
        }
        case 'diamond': {
            const half = size * 0.6
            const pts = [
                [ax + half * Math.cos(angle), ay + half * Math.sin(angle)],
                [ax + half * Math.cos(angle + Math.PI / 2), ay + half * Math.sin(angle + Math.PI / 2)],
                [ax - half * Math.cos(angle), ay - half * Math.sin(angle)],
                [ax - half * Math.cos(angle - Math.PI / 2), ay - half * Math.sin(angle - Math.PI / 2)],
            ]
            return `<polygon points="${pts.map(p => `${p[0]},${p[1]}`).join(' ')}" fill="${color}"/>`
        }
        default:
            return ''
    }
}

// ── Sketchy / Industrial Design Sketch helpers ──────────────

/** Seeded random — deterministic per element */
function sr(x: number, y: number, i: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233 + i * 4356.13) * 43758.5453
    return n - Math.floor(n)
}

/** 
 * Draw a single hand-drawn line. Each line:
 * - Has highly varied overshoot at start/end (some long, some short)
 * - Curves via cubic bezier with randomized control points
 * - Has perpendicular drift (the whole line shifts sideways slightly per pass)
 * - Varying thickness and opacity
 */
function sketchLine(x1: number, y1: number, x2: number, y2: number,
    color: string, sw: number, seed: number, pass: number, overshoot = 6, dash = ''): string {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len < 1) return ''
    const nx = dx / len, ny = dy / len

    // Varied overshoot — some lines extend past corners, others barely
    const osStart = overshoot * (0.1 + sr(seed, pass, 1) * 1.2)
    const osEnd = overshoot * (0.1 + sr(seed, pass, 2) * 1.2)

    // Perpendicular drift — each pass offsets sideways
    const perpAmount = sw * (0.2 + sr(seed, pass, 3) * 0.5) * (sr(seed, pass, 4) > 0.5 ? 1 : -1)
    const ox = -ny * perpAmount, oy = nx * perpAmount

    // Start and end with overshoot + drift
    const sx = x1 - nx * osStart + ox
    const sy = y1 - ny * osStart + oy
    const ex = x2 + nx * osEnd + ox
    const ey = y2 + ny * osEnd + oy

    // Two random control points for cubic bezier — creates natural curve
    const t1 = 0.3 + (sr(seed, pass, 5) - 0.5) * 0.1
    const t2 = 0.7 + (sr(seed, pass, 6) - 0.5) * 0.1
    const wobbleAmount = len * 0.01 + sw * 0.8
    const c1x = sx + (ex - sx) * t1 + (sr(seed, pass, 7) - 0.5) * wobbleAmount
    const c1y = sy + (ey - sy) * t1 + (sr(seed, pass, 8) - 0.5) * wobbleAmount
    const c2x = sx + (ex - sx) * t2 + (sr(seed, pass, 9) - 0.5) * wobbleAmount
    const c2y = sy + (ey - sy) * t2 + (sr(seed, pass, 10) - 0.5) * wobbleAmount

    const op = pass === 0 ? (0.7 + sr(seed, pass, 11) * 0.2) : (0.15 + sr(seed, pass, 12) * 0.2)
    const w = sw * (pass === 0 ? (0.8 + sr(seed, pass, 13) * 0.4) : (0.3 + sr(seed, pass, 14) * 0.35))

    const dashA = dash ? ` stroke-dasharray="${dash}"` : ''
    return `<path d="M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity="${op}"${dashA}/>`
}

/** Draw a rectangle as 4 edge lines with 2-3 passes each. Supports rounded corners via rx. */
function sketchRect(x: number, y: number, w: number, h: number,
    color: string, sw: number, seed: number, rx: number = 0, dash = ''): string {
    rx = Math.min(rx, Math.min(w, h) / 2) // clamp to half of smallest dimension
    let svg = ''
    if (rx <= 0) {
        // Sharp corners — original behavior
        const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        for (let e = 0; e < 4; e++) {
            const [ax, ay] = corners[e]
            const [bx, by] = corners[(e + 1) % 4]
            const passes = 2 + (sr(seed, e, 99) > 0.5 ? 1 : 0)
            for (let p = 0; p < passes; p++) {
                svg += sketchLine(ax, ay, bx, by, color, sw, seed + e * 137 + p * 31, p, 6, dash)
            }
        }
    } else {
        // Rounded corners — draw 4 edge lines with arcs at corners
        // Edge endpoints (lines stop at rx offset from corners)
        const edges: [number, number, number, number][] = [
            [x + rx, y, x + w - rx, y],           // top
            [x + w, y + rx, x + w, y + h - rx],   // right
            [x + w - rx, y + h, x + rx, y + h],   // bottom
            [x, y + h - rx, x, y + rx],            // left
        ]
        // Corner arc control & end points (quadratic bezier)
        const arcs: [number, number, number, number, number, number][] = [
            [x + w, y, x + w, y + rx, x + w - rx, y],     // top-right
            [x + w, y + h, x + w - rx, y + h, x + w, y + h - rx], // bottom-right
            [x, y + h, x, y + h - rx, x + rx, y + h],     // bottom-left
            [x, y, x + rx, y, x, y + rx],                 // top-left
        ]
        for (let e = 0; e < 4; e++) {
            const [ax, ay, bx, by] = edges[e]
            const passes = 2 + (sr(seed, e, 99) > 0.5 ? 1 : 0)
            for (let p = 0; p < passes; p++) {
                svg += sketchLine(ax, ay, bx, by, color, sw, seed + e * 137 + p * 31, p, 6, dash)
            }
            // Draw corner arc
            const [cx, cy, ex, ey] = arcs[e]
            const j1 = (sr(seed, e + 40, 0) - 0.5) * 1.5
            const j2 = (sr(seed, e + 41, 0) - 0.5) * 1.5
            const arcDashA = dash ? ` stroke-dasharray="${dash}"` : ''
            svg += `<path d="M ${bx + j1},${by + j2} Q ${cx + j1},${cy + j2} ${ex + j1},${ey + j2}" 
                fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"${arcDashA}/>`
        }
    }
    return svg
}

/** Draw an ellipse as multiple freehand loops with natural wobble */
function sketchEllipse(cx: number, cy: number, rx: number, ry: number,
    color: string, sw: number, seed: number, dash = ''): string {
    let svg = ''
    for (let p = 0; p < 2; p++) {
        const steps = 36
        const points: [number, number][] = []
        // Don't close exactly — leave a small gap or overlap (natural)
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
        // Build smooth cubic path through points
        let d = `M ${points[0][0]} ${points[0][1]}`
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1], cur = points[i]
            const cpx = (prev[0] + cur[0]) / 2 + (sr(seed, i + p * 100, 4) - 0.5) * sw * 0.6
            const cpy = (prev[1] + cur[1]) / 2 + (sr(seed, i + p * 100, 5) - 0.5) * sw * 0.6
            d += ` Q ${cpx} ${cpy} ${cur[0]} ${cur[1]}`
        }
        const op = p === 0 ? 0.75 : 0.2
        const w = sw * (p === 0 ? 1 : (0.4 + sr(seed, p, 90) * 0.3))
        const eDashA = dash ? ` stroke-dasharray="${dash}"` : ''
        svg += `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"${eDashA}/>`
    }
    return svg
}

/** Draw a diamond as 4 edge lines with overshooting */
function sketchDiamond(cx: number, cy: number, w: number, h: number,
    color: string, sw: number, seed: number, dash = ''): string {
    const pts: [number, number][] = [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]]
    let svg = ''
    for (let e = 0; e < 4; e++) {
        const passes = 2 + (sr(seed, e, 99) > 0.6 ? 1 : 0)
        for (let p = 0; p < passes; p++) {
            svg += sketchLine(pts[e][0], pts[e][1], pts[(e + 1) % 4][0], pts[(e + 1) % 4][1],
                color, sw, seed + e * 137 + p * 31, p, 6, dash)
        }
    }
    return svg
}

/** 
 * Sketchy fills — two modes:
 * - 'solid': dense marker wash that bleeds slightly past edges
 * - 'hachure': thick diagonal stripes clipped to shape
 */
function sketchFill(x: number, y: number, w: number, h: number,
    color: string, seed: number, clipPath: string, style: 'solid' | 'hachure'): string {

    const clipId = `sf${Math.abs(seed)}`

    if (style === 'hachure') {
        // Thick diagonal stripes
        let svg = ''
        const baseAngle = 0.7 + (sr(seed, seed, 50) - 0.5) * 0.2
        const cos = Math.cos(baseAngle), sin = Math.sin(baseAngle)
        const diag = Math.hypot(w, h) + 20
        const spacing = 8 + sr(seed, seed, 51) * 4
        const numStrokes = Math.ceil(diag / spacing)

        for (let i = 0; i < numStrokes; i++) {
            const t = i / numStrokes
            const offset = -diag / 2 + t * diag
            const cx = x + w / 2, cy = y + h / 2
            const sx = cx + cos * (-diag / 2) + sin * offset
            const sy = cy + sin * (-diag / 2) - cos * offset
            const ex = cx + cos * (diag / 2) + sin * offset
            const ey = cy + sin * (diag / 2) - cos * offset

            const strokeW = 3 + sr(seed, i, 52) * 2
            const op = 0.2 + sr(seed, i, 53) * 0.15
            // Slight midpoint wobble
            const mx = (sx + ex) / 2 + (sr(seed, i, 54) - 0.5) * 3
            const my = (sy + ey) / 2 + (sr(seed, i, 55) - 0.5) * 3

            svg += `<path d="M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}" 
                stroke="${color}" stroke-width="${strokeW}" fill="none" stroke-linecap="round" opacity="${op}"/>`
        }
        return `<defs><clipPath id="${clipId}"><path d="${clipPath}"/></clipPath></defs>` +
            `<g clip-path="url(#${clipId})">${svg}</g>`
    }

    // 'solid' — dense marker wash that bleeds slightly past edges
    let svg = ''
    const baseAngle = 0.5 + (sr(seed, seed, 60) - 0.5) * 0.3
    const cos = Math.cos(baseAngle), sin = Math.sin(baseAngle)
    const diag = Math.hypot(w, h) + 30
    const spacing = 2.5 + sr(seed, seed, 61) * 1.5
    const numStrokes = Math.ceil(diag / spacing)
    // Expand bounds slightly for bleed
    const bleed = 3 + sr(seed, seed, 62) * 2

    for (let i = 0; i < numStrokes; i++) {
        const t = i / numStrokes
        const offset = -diag / 2 + t * diag
        const cx = x + w / 2, cy = y + h / 2
        const sx = cx + cos * (-diag / 2 - bleed) + sin * offset
        const sy = cy + sin * (-diag / 2 - bleed) - cos * offset
        const ex = cx + cos * (diag / 2 + bleed) + sin * offset
        const ey = cy + sin * (diag / 2 + bleed) - cos * offset

        const strokeW = 2.5 + sr(seed, i, 63) * 2
        const op = 0.05 + sr(seed, i, 64) * 0.06
        svg += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" 
            stroke="${color}" stroke-width="${strokeW}" opacity="${op}" stroke-linecap="round"/>`
    }

    // Clip to the actual shape outline (not a rectangle — that bleeds outside ellipses/diamonds)
    return `<defs><clipPath id="${clipId}"><path d="${clipPath}"/></clipPath></defs>` +
        `<g clip-path="url(#${clipId})">${svg}</g>`
}

/** No-op defs (no SVG filter needed for industrial style) */
export function getSketchyDefs(): string {
    return ''
}

export function renderElement(el: DrawingElement, _selected: boolean, hideText = false, sketchy = false): string {
    const { strokeColor: color, strokeWidth: sw, backgroundColor: fill } = el
    const safeFill = fill === 'transparent' ? 'none' : (fill || 'none')
    const textFill = el.textColor || color
    const font = sketchy
        ? "'Architects Daughter', Caveat, cursive"
        : (el.fontFamily ? `${el.fontFamily}, system-ui, sans-serif` : 'Inter, system-ui, sans-serif')
    const fw = el.fontWeight || 400
    const textSize = sketchy ? Math.round((el.fontSize || 14) * 1.3) : (el.fontSize || 14)
    const rx = el.borderRadius ?? (el.roundness ? 8 : 0)
    const opacityAttr = el.opacity != null && el.opacity < 1 ? ` opacity="${el.opacity}"` : ''
    const dashAttr = el.strokeDasharray ? ` stroke-dasharray="${el.strokeDasharray}"` : ''
    // Seed based on position for deterministic look
    const seed = Math.round(el.x * 7 + el.y * 13)

    let shapeSvg = ''

    switch (el.type) {
        case 'rectangle': {
            if (sketchy) {
                // Sketchy fill
                const fs = el.fillStyle || 'hachure'
                if (safeFill !== 'none') {
                    const cp = `M ${el.x} ${el.y} L ${el.x + el.width} ${el.y} L ${el.x + el.width} ${el.y + el.height} L ${el.x} ${el.y + el.height} Z`
                    shapeSvg += sketchFill(el.x, el.y, el.width, el.height, safeFill, seed, cp, fs)
                }
                // Multi-pass sketch strokes
                shapeSvg += sketchRect(el.x, el.y, el.width, el.height, color, sw, seed, rx, el.strokeDasharray || '')
            } else {
                shapeSvg = `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" 
                    stroke="${color}" stroke-width="${sw}" fill="${safeFill}" rx="${rx}"${opacityAttr}${dashAttr}/>`
            }
            break
        }
        case 'ellipse': {
            const cx = el.x + el.width / 2, cy = el.y + el.height / 2
            if (sketchy) {
                const fs = el.fillStyle || 'hachure'
                if (safeFill !== 'none') {
                    let cp = ''
                    for (let i = 0; i <= 32; i++) {
                        const a = (i / 32) * Math.PI * 2
                        cp += (i === 0 ? 'M ' : ' L ') + `${cx + (el.width / 2) * Math.cos(a)} ${cy + (el.height / 2) * Math.sin(a)}`
                    }
                    cp += ' Z'
                    shapeSvg += sketchFill(el.x, el.y, el.width, el.height, safeFill, seed + 500, cp, fs)
                }
                shapeSvg += sketchEllipse(cx, cy, el.width / 2, el.height / 2, color, sw, seed, el.strokeDasharray || '')
            } else {
                shapeSvg = `<ellipse cx="${cx}" cy="${cy}" rx="${el.width / 2}" ry="${el.height / 2}" 
                    stroke="${color}" stroke-width="${sw}" fill="${safeFill}"${opacityAttr}${dashAttr}/>`
            }
            break
        }
        case 'diamond': {
            const cx = el.x + el.width / 2, cy = el.y + el.height / 2
            if (sketchy) {
                const fs = el.fillStyle || 'hachure'
                if (safeFill !== 'none') {
                    const cp = `M ${cx} ${el.y} L ${el.x + el.width} ${cy} L ${cx} ${el.y + el.height} L ${el.x} ${cy} Z`
                    shapeSvg += sketchFill(el.x, el.y, el.width, el.height, safeFill, seed + 700, cp, fs)
                }
                shapeSvg += sketchDiamond(cx, cy, el.width, el.height, color, sw, seed, el.strokeDasharray || '')
            } else {
                shapeSvg = `<polygon points="${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}" 
                    stroke="${color}" stroke-width="${sw}" fill="${safeFill}"${opacityAttr}${dashAttr}/>`
            }
            break
        }
        case 'line':
        case 'arrow':
        case 'ortho-arrow': {
            if (!el.points || el.points.length < 2) return ''
            if (sketchy) {
                // Draw each segment with multi-pass
                for (let i = 0; i < el.points.length - 1; i++) {
                    const ax = el.x + el.points[i][0], ay = el.y + el.points[i][1]
                    const bx = el.x + el.points[i + 1][0], by = el.y + el.points[i + 1][1]
                    const passes = 2
                    for (let p = 0; p < passes; p++) {
                        shapeSvg += sketchLine(ax, ay, bx, by, color, sw, seed + i * 100, p, 3, el.strokeDasharray || '')
                    }
                }
            } else {
                const pts = el.points.map(p => `${el.x + p[0]},${el.y + p[1]}`).join(' ')
                shapeSvg = `<polyline points="${pts}" stroke="${color}" stroke-width="${sw}" fill="none"${opacityAttr}${dashAttr}/>`
            }
            if (el.type !== 'line') shapeSvg += renderHead(el, color, sw, 'end', sketchy)
            if (el.arrowStart && el.arrowStart !== 'none') shapeSvg += renderHead(el, color, sw, 'start', sketchy)
            if (!hideText && el.label && el.points.length >= 2) {
                shapeSvg += renderArrowLabel(el, color, sketchy)
            }
            return shapeSvg
        }
        case 'freedraw': {
            if (!el.points || el.points.length < 2) return ''
            const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${el.x + p[0]} ${el.y + p[1]}`).join(' ')
            return `<path d="${d}" stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}${dashAttr}/>`
        }
        case 'text': {
            if (hideText) return ''
            const lines = (el.text || '').split('\n')
            if (lines.length <= 1) {
                return `<text x="${el.x}" y="${el.y}" fill="${textFill}" font-size="${textSize}" 
                    font-family="${font}" font-weight="${fw}"${opacityAttr}>${el.text || ''}</text>`
            }
            // Multi-line: use tspan with dy offsets
            const tspans = lines.map((line, i) =>
                `<tspan x="${el.x}" dy="${i === 0 ? 0 : textSize * 1.3}">${line || '&#160;'}</tspan>`
            ).join('')
            return `<text x="${el.x}" y="${el.y}" fill="${textFill}" font-size="${textSize}" 
                font-family="${font}" font-weight="${fw}"${opacityAttr}>${tspans}</text>`
        }
        default: return ''
    }

    // Text inside shapes
    if (!hideText && el.text && (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond')) {
        const cx = el.x + el.width / 2, cy = el.y + el.height / 2
        const lines = el.text.split('\n')
        const lineH = textSize * 1.3

        // Horizontal alignment
        const hAlign = el.textAlign || 'center'
        const textAnchor = hAlign === 'left' ? 'start' : hAlign === 'right' ? 'end' : 'middle'
        const textX = hAlign === 'left' ? el.x + 8 : hAlign === 'right' ? el.x + el.width - 8 : cx

        // Vertical alignment
        const vAlign = el.verticalAlign || 'center'
        const totalTextH = lineH * lines.length
        let textY: number
        if (vAlign === 'top') {
            textY = el.y + 8
        } else if (vAlign === 'bottom') {
            textY = el.y + el.height - totalTextH - 8 + textSize
        } else {
            // center
            textY = lines.length <= 1
                ? cy
                : cy - (lineH * (lines.length - 1)) / 2
        }

        if (lines.length <= 1) {
            shapeSvg += `<text x="${textX}" y="${textY}" dy="0.35em" fill="${textFill}" font-size="${textSize}" 
                font-family="${font}" font-weight="${fw}" text-anchor="${textAnchor}">${el.text}</text>`
        } else {
            const tspans = lines.map((line, i) =>
                `<tspan x="${textX}" dy="${i === 0 ? '0.35em' : lineH}">${line || '&#160;'}</tspan>`
            ).join('')
            shapeSvg += `<text x="${textX}" y="${textY}" fill="${textFill}" font-size="${textSize}" 
                font-family="${font}" font-weight="${fw}" text-anchor="${textAnchor}">${tspans}</text>`
        }
    }

    return shapeSvg
}

export function renderSelectionUI(el: DrawingElement): string {
    let svg = ''

    if (isArrowType(el) && el.points && el.points.length >= 2) {
        // Arrow endpoint handles (draggable circles)
        const sx = el.x + el.points[0][0], sy = el.y + el.points[0][1]
        const last = el.points[el.points.length - 1]
        const ex = el.x + last[0], ey = el.y + last[1]

        svg += `<circle cx="${sx}" cy="${sy}" r="5" fill="#fff" stroke="#6c9eff" stroke-width="2" style="cursor:grab"/>`
        svg += `<circle cx="${ex}" cy="${ey}" r="5" fill="#fff" stroke="#6c9eff" stroke-width="2" style="cursor:grab"/>`

        // For ortho-arrows, show midpoints on segments
        if (el.type === 'ortho-arrow' && el.points.length >= 3) {
            for (let i = 0; i < el.points.length - 1; i++) {
                const mx = el.x + (el.points[i][0] + el.points[i + 1][0]) / 2
                const my = el.y + (el.points[i][1] + el.points[i + 1][1]) / 2
                svg += `<rect x="${mx - 3}" y="${my - 3}" width="6" height="6" rx="1" 
                    fill="#fff" stroke="#6c9eff" stroke-width="1.5" style="cursor:move"/>`
            }
        }

        // Show arrowhead style indicator
        const style = el.arrowEnd || 'arrow'
        svg += `<text x="${ex + 10}" y="${ey - 8}" fill="#6c9eff" font-size="10" 
            font-family="Inter, system-ui, sans-serif">${style === 'arrow' ? '▸' : style === 'dot' ? '●' : '○'}</text>`
    } else if (el.type !== 'freedraw' && el.type !== 'text' && el.type !== 'line') {
        // Bounding box + 8 resize handles
        svg += `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" 
            fill="none" stroke="#6c9eff" stroke-width="1" stroke-dasharray="4,2" pointer-events="none"/>`

        const handles = [
            { hx: el.x, hy: el.y }, { hx: el.x + el.width / 2, hy: el.y },
            { hx: el.x + el.width, hy: el.y }, { hx: el.x + el.width, hy: el.y + el.height / 2 },
            { hx: el.x + el.width, hy: el.y + el.height }, { hx: el.x + el.width / 2, hy: el.y + el.height },
            { hx: el.x, hy: el.y + el.height }, { hx: el.x, hy: el.y + el.height / 2 },
        ]
        for (const h of handles) {
            svg += `<rect x="${h.hx - HANDLE_SIZE}" y="${h.hy - HANDLE_SIZE}" width="${HANDLE_SIZE * 2}" height="${HANDLE_SIZE * 2}" rx="1"
                fill="#fff" stroke="#6c9eff" stroke-width="1.5"/>`
        }
    } else if (el.type === 'text') {
        const lines = (el.text || '').split('\n')
        const maxLineLen = Math.max(...lines.map(l => l.length))
        const tw = maxLineLen * (el.fontSize ?? 16) * 0.6
        const lineH = (el.fontSize ?? 16) * 1.3
        const th = lineH * lines.length
        svg += `<rect x="${el.x - 2}" y="${el.y - (el.fontSize ?? 16)}" width="${tw + 4}" height="${th + 4}"
            fill="none" stroke="#6c9eff" stroke-width="1" stroke-dasharray="4,2"/>`
    }

    return svg
}

export function renderAnchors(
    hoveredElement: DrawingElement | null,
    hoveredAnchor: AnchorPoint | null,
    anchorsForElement: (el: DrawingElement) => AnchorPoint[],
): string {
    let svg = ''
    if (hoveredElement) {
        for (const a of anchorsForElement(hoveredElement)) {
            const isHovered = hoveredAnchor?.elementId === a.elementId && hoveredAnchor?.side === a.side && hoveredAnchor?.t === a.t
            const fill = isHovered ? '#6c9eff' : 'rgba(108,158,255,0.3)'
            const stroke = '#6c9eff'
            const r = isHovered ? ANCHOR_RADIUS + 1 : ANCHOR_RADIUS
            svg += `<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
        }
    } else if (hoveredAnchor) {
        svg += `<circle cx="${hoveredAnchor.x}" cy="${hoveredAnchor.y}" r="${ANCHOR_RADIUS + 1}" 
            fill="#6c9eff" stroke="#6c9eff" stroke-width="1.5"/>`
    }
    return svg
}
