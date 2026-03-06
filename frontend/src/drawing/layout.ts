/**
 * Pure layout functions for alignment, distribution, and z-ordering.
 * Extracted from useDrawing.ts for testability.
 */
import type { DrawingElement } from './types'
import { getElementBounds } from './types'

// ── Alignment ────────────────────────────────────────────

export function alignElements(elements: DrawingElement[], action: string): void {
    if (elements.length < 2) return

    const bounds = elements.map(e => {
        const b = getElementBounds(e)
        return { el: e, x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }
    })

    switch (action) {
        case 'align-left': {
            const minX = Math.min(...bounds.map(b => b.x))
            bounds.forEach(b => { b.el.x += minX - b.x })
            break
        }
        case 'align-center-h': {
            const avg = bounds.reduce((s, b) => s + b.cx, 0) / bounds.length
            bounds.forEach(b => { b.el.x += avg - b.cx })
            break
        }
        case 'align-right': {
            const maxR = Math.max(...bounds.map(b => b.x + b.w))
            bounds.forEach(b => { b.el.x += maxR - (b.x + b.w) })
            break
        }
        case 'align-top': {
            const minY = Math.min(...bounds.map(b => b.y))
            bounds.forEach(b => { b.el.y += minY - b.y })
            break
        }
        case 'align-center-v': {
            const avg = bounds.reduce((s, b) => s + b.cy, 0) / bounds.length
            bounds.forEach(b => { b.el.y += avg - b.cy })
            break
        }
        case 'align-bottom': {
            const maxB = Math.max(...bounds.map(b => b.y + b.h))
            bounds.forEach(b => { b.el.y += maxB - (b.y + b.h) })
            break
        }
        case 'distribute-h': {
            if (bounds.length < 3) break
            bounds.sort((a, b) => a.x - b.x)
            const totalWidth = bounds.reduce((s, b) => s + b.w, 0)
            const containerW = bounds[bounds.length - 1].x + bounds[bounds.length - 1].w - bounds[0].x
            const gap = (containerW - totalWidth) / (bounds.length - 1)
            let cx = bounds[0].x + bounds[0].w
            for (let i = 1; i < bounds.length - 1; i++) {
                bounds[i].el.x = cx + gap
                cx = bounds[i].el.x + bounds[i].w
            }
            break
        }
        case 'distribute-v': {
            if (bounds.length < 3) break
            bounds.sort((a, b) => a.y - b.y)
            const totalHeight = bounds.reduce((s, b) => s + b.h, 0)
            const containerH = bounds[bounds.length - 1].y + bounds[bounds.length - 1].h - bounds[0].y
            const gap = (containerH - totalHeight) / (bounds.length - 1)
            let cy = bounds[0].y + bounds[0].h
            for (let i = 1; i < bounds.length - 1; i++) {
                bounds[i].el.y = cy + gap
                cy = bounds[i].el.y + bounds[i].h
            }
            break
        }
    }
}

// ── Z-Ordering ───────────────────────────────────────────

export function reorderElements(
    elements: DrawingElement[],
    selectedIds: Set<string>,
    action: 'toBack' | 'backward' | 'forward' | 'toFront',
): DrawingElement[] {
    if (selectedIds.size === 0) return elements

    const selected = elements.filter(e => selectedIds.has(e.id))
    const rest = elements.filter(e => !selectedIds.has(e.id))

    switch (action) {
        case 'toBack':
            return [...selected, ...rest]
        case 'toFront':
            return [...rest, ...selected]
        case 'backward': {
            const arr = [...elements]
            for (const el of selected) {
                const idx = arr.indexOf(el)
                if (idx > 0 && !selectedIds.has(arr[idx - 1].id)) {
                    ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
                }
            }
            return arr
        }
        case 'forward': {
            const arr = [...elements]
            for (let i = selected.length - 1; i >= 0; i--) {
                const idx = arr.indexOf(selected[i])
                if (idx < arr.length - 1 && !selectedIds.has(arr[idx + 1].id)) {
                    ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
                }
            }
            return arr
        }
    }
}

// ── Coordinate conversions ───────────────────────────────

export interface Viewport {
    x: number
    y: number
    zoom: number
}

/** Convert screen coordinates to world coordinates */
export function screenToWorld(sx: number, sy: number, viewport: Viewport, containerX = 0, containerY = 0): { x: number; y: number } {
    return {
        x: (sx - containerX - viewport.x) / viewport.zoom,
        y: (sy - containerY - viewport.y) / viewport.zoom,
    }
}

/** Convert world coordinates to screen coordinates */
export function worldToScreen(wx: number, wy: number, viewport: Viewport, containerX = 0, containerY = 0): { x: number; y: number } {
    return {
        x: wx * viewport.zoom + viewport.x + containerX,
        y: wy * viewport.zoom + viewport.y + containerY,
    }
}
