/**
 * Drawing Worker Proxy — main thread interface.
 *
 * Creates a Web Worker that renders elements to an internal OffscreenCanvas.
 * Worker sends ImageBitmap frames back, which this proxy blits to the DOM canvas.
 * DOM canvas is NEVER transferred — safe for HMR/React StrictMode re-runs.
 *
 * Uses diff-based state transfer: only changed/removed elements are sent
 * to the worker, avoiding structured clone of the entire element array.
 */

import type { DrawingElement } from './types'

export interface RenderState {
    elements: DrawingElement[]
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

// Fast FNV-1a hash for element change detection
function fnv1a(str: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}

function hashElement(el: DrawingElement): number {
    // Hash the mutable fields that affect rendering
    // This is cheaper than JSON.stringify of the whole object
    let s = `${el.x},${el.y},${el.width},${el.height},${el.strokeColor},${el.strokeWidth},${el.backgroundColor ?? ''},${el.fillStyle ?? ''},${el.strokeDasharray ?? ''},${el.opacity ?? 1},${el.borderRadius ?? 0},${el.text ?? ''},${el.label ?? ''},${el.labelT ?? 0.5},${el.fontSize ?? 0},${el.fontWeight ?? 0},${el.textColor ?? ''},${el.textAlign ?? ''},${el.verticalAlign ?? ''},${el.arrowEnd ?? ''},${el.arrowStart ?? ''}`
    if (el.points) {
        for (const p of el.points) s += `,${p[0]},${p[1]}`
    }
    if (el.startConnection) s += `,sc:${el.startConnection.elementId},${el.startConnection.side},${el.startConnection.t}`
    if (el.endConnection) s += `,ec:${el.endConnection.elementId},${el.endConnection.side},${el.endConnection.t}`
    return fnv1a(s)
}

export class DrawingWorkerProxy {
    private worker: Worker
    private ready = false
    private pendingRender: RenderState | null = null
    private rendering = false
    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D

    // Diff tracking
    private sentHashes: Map<string, number> = new Map()
    private needsFullSync = true
    private lastTheme = ''
    private lastSketchy = false

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Cannot get 2d context')
        this.ctx = ctx

        // Create worker
        this.worker = new Worker(
            new URL('./drawing-worker.ts', import.meta.url),
            { type: 'module' }
        )

        this.worker.onmessage = (e) => {
            switch (e.data.type) {
                case 'ready':
                    console.log('[drawing-worker] ready')
                    this.ready = true
                    // Flush pending render
                    if (this.pendingRender) {
                        this.doRender(this.pendingRender)
                        this.pendingRender = null
                    }
                    break
                case 'frame': {
                    // Blit ImageBitmap from worker to DOM canvas
                    this.rendering = false
                    const bitmap = e.data.bitmap as ImageBitmap
                    const c = this.canvas
                    // Resize canvas if needed to match bitmap
                    if (c.width !== bitmap.width || c.height !== bitmap.height) {
                        c.width = bitmap.width
                        c.height = bitmap.height
                    }
                    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
                    this.ctx.clearRect(0, 0, c.width, c.height)
                    this.ctx.drawImage(bitmap, 0, 0)
                    bitmap.close()
                    // If a new render was queued while worker was busy, send it
                    if (this.pendingRender) {
                        this.doRender(this.pendingRender)
                        this.pendingRender = null
                    }
                    break
                }
                case 'rendered':
                    // Fallback signal (worker error path)
                    this.rendering = false
                    if (this.pendingRender) {
                        this.doRender(this.pendingRender)
                        this.pendingRender = null
                    }
                    break
                case 'error':
                    console.error('[drawing-worker] error:', e.data.message)
                    break
            }
        }

        this.worker.onerror = (err) => {
            console.error('[drawing-worker] worker error:', err)
        }

        // Init worker (no canvas transfer — worker creates its own OffscreenCanvas)
        this.worker.postMessage({ type: 'init' })
    }

    /** Request a render. If worker is busy, latest state is queued (drops intermediate frames). */
    requestRender(state: RenderState): void {
        if (!this.ready || this.rendering) {
            // Queue latest state — worker will pick it up when done
            this.pendingRender = state
            return
        }
        this.doRender(state)
    }

    private doRender(state: RenderState): void {
        this.rendering = true

        // Detect global changes that require full sync
        const globalChanged = this.needsFullSync ||
            state.theme !== this.lastTheme ||
            state.sketchy !== this.lastSketchy
        this.lastTheme = state.theme
        this.lastSketchy = state.sketchy

        if (globalChanged) {
            // Full sync: send all elements
            this.needsFullSync = false
            this.sentHashes.clear()
            for (const el of state.elements) {
                this.sentHashes.set(el.id, hashElement(el))
            }
            this.worker.postMessage({
                type: 'render',
                state: {
                    fullSync: true,
                    elements: state.elements,
                    viewport: state.viewport,
                    selectedId: state.selectedId,
                    multiSelectedIds: state.multiSelectedIds,
                    currentElement: state.currentElement,
                    highlightedIds: state.highlightedIds,
                    sketchy: state.sketchy,
                    canvasWidth: state.canvasWidth,
                    canvasHeight: state.canvasHeight,
                    dpr: state.dpr,
                    theme: state.theme,
                    canvasBg: state.canvasBg,
                    defaultStroke: state.defaultStroke,
                    highlightColor: state.highlightColor,
                    editingElementId: state.editingElementId,
                },
            })
        } else {
            // Diff: compute changed and removed elements
            const currentIds = new Set<string>()
            const dirtyElements: DrawingElement[] = []

            for (const el of state.elements) {
                currentIds.add(el.id)
                const hash = hashElement(el)
                const prev = this.sentHashes.get(el.id)
                if (prev === undefined || prev !== hash) {
                    dirtyElements.push(el)
                    this.sentHashes.set(el.id, hash)
                }
            }

            // Find removed elements
            const removedIds: string[] = []
            for (const id of this.sentHashes.keys()) {
                if (!currentIds.has(id)) {
                    removedIds.push(id)
                }
            }
            for (const id of removedIds) {
                this.sentHashes.delete(id)
            }

            this.worker.postMessage({
                type: 'render',
                state: {
                    fullSync: false,
                    dirtyElements: dirtyElements.length > 0 ? dirtyElements : undefined,
                    removedIds: removedIds.length > 0 ? removedIds : undefined,
                    viewport: state.viewport,
                    selectedId: state.selectedId,
                    multiSelectedIds: state.multiSelectedIds,
                    currentElement: state.currentElement,
                    highlightedIds: state.highlightedIds,
                    sketchy: state.sketchy,
                    canvasWidth: state.canvasWidth,
                    canvasHeight: state.canvasHeight,
                    dpr: state.dpr,
                    theme: state.theme,
                    canvasBg: state.canvasBg,
                    defaultStroke: state.defaultStroke,
                    highlightColor: state.highlightColor,
                    editingElementId: state.editingElementId,
                },
            })
        }
    }

    /** Force full sync on next render (e.g. page switch) */
    invalidate(): void {
        this.needsFullSync = true
        this.sentHashes.clear()
    }

    dispose(): void {
        this.worker.terminate()
    }
}

