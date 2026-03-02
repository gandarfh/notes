/**
 * Drawing Worker Proxy — main thread interface.
 *
 * Creates a Web Worker that renders elements to an internal OffscreenCanvas.
 * Worker sends ImageBitmap frames back, which this proxy blits to the DOM canvas.
 * DOM canvas is NEVER transferred — safe for HMR/React StrictMode re-runs.
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
}

export class DrawingWorkerProxy {
    private worker: Worker
    private ready = false
    private pendingRender: RenderState | null = null
    private rendering = false
    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D

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
        this.worker.postMessage({ type: 'render', state })
    }

    dispose(): void {
        this.worker.terminate()
    }
}
