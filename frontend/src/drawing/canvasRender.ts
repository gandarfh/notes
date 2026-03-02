/**
 * Canvas2D overlay rendering — main thread only.
 *
 * Lightweight Canvas2D functions for selection UI, anchors, and box selection.
 * NO WASM calls — all element rendering is in the Web Worker (drawing-worker.ts).
 */
import { type DrawingElement, type AnchorPoint, ANCHOR_RADIUS, HANDLE_SIZE } from './types'

// ── Theme helpers (lightweight, no WASM) ──

const ACCENT = '#6366f1'

/**
 * Swap white ↔ black drawing colors for the active theme.
 * Only exact palette matches are swapped — other colors are untouched.
 * Render-time only; stored data is unchanged.
 */
const LIGHT_SWAP: Record<string, string> = {
    '#e8e8f0': '#1e1e2e',
    '#ffffff': '#000000',
    '#fff': '#000',
    '#1e1e2e': '#e8e8f0',
    '#000000': '#ffffff',
    '#000': '#fff',
}

export function remapForTheme(color: string): string {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    if (!isLight) return color
    return LIGHT_SWAP[color?.toLowerCase()] ?? color
}

let _cachedThemeColors: { handleFill: string; canvasBg: string; textPrimary: string; isLight: boolean } | null = null
let _themeColorFrame = -1

function getThemeColors() {
    const now = performance.now() | 0
    if (_cachedThemeColors && now - _themeColorFrame < 200) return _cachedThemeColors
    _themeColorFrame = now
    const s = getComputedStyle(document.documentElement)
    _cachedThemeColors = {
        handleFill: s.getPropertyValue('--c-bg').trim() || '#1e1e2e',
        canvasBg: s.getPropertyValue('--c-bg').trim() || '#1e1e2e',
        textPrimary: s.getPropertyValue('--c-text-primary').trim() || '#e8e8f0',
        isLight: document.documentElement.getAttribute('data-theme') === 'light',
    }
    return _cachedThemeColors
}

// ── Selection UI ──

export function drawSelectionUI(ctx: CanvasRenderingContext2D, el: DrawingElement): void {
    const ACCENT = '#6c9eff'

    if (el.type === 'arrow' || el.type === 'ortho-arrow' || el.type === 'line') {
        if (!el.points || el.points.length < 2) return

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

// ── Box Selection ──

export function drawBoxSelection(
    ctx: CanvasRenderingContext2D,
    boxStart: { x: number; y: number },
    boxEnd: { x: number; y: number },
    previewIds: Set<string>,
    elements: DrawingElement[],
): void {
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
            ctx.fillStyle = 'rgba(99,102,241,0.06)'
            ctx.strokeStyle = ACCENT
            ctx.lineWidth = 1.5
            ctx.setLineDash([4, 2])
            ctx.beginPath()
            ctx.roundRect(el.x - pad, el.y - pad, el.width + pad * 2, el.height + pad * 2, 3)
            ctx.fill()
            ctx.stroke()
            ctx.setLineDash([])
        }
    }
}

// ── Arrow Label Position (pure math) ──

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
