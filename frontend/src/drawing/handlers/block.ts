// ── Block Handler ──────────────────────────────────────────
// Handles: drag-to-create note blocks on the canvas.
// Uses React-driven preview (no DOM manipulation).

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'

export interface BlockCreationCallback {
    (type: string, worldX: number, worldY: number, width: number, height: number): void
}

interface BlockState {
    isDragging: boolean
    dragStart: Point
    lastWorld: Point
}

export class BlockHandler implements InteractionHandler {
    private s: BlockState = { isDragging: false, dragStart: { x: 0, y: 0 }, lastWorld: { x: 0, y: 0 } }
    private onBlockCreate: BlockCreationCallback
    private blockType: string
    private defaultW: number
    private defaultH: number

    constructor(onBlockCreate: BlockCreationCallback, blockType = 'markdown', defaultW = 320, defaultH = 220) {
        this.onBlockCreate = onBlockCreate
        this.blockType = blockType
        this.defaultW = defaultW
        this.defaultH = defaultH
    }

    deactivate(ctx: DrawingContext) {
        ctx.setBlockPreview(null)
        this.s.isDragging = false
    }

    onMouseDown(ctx: DrawingContext, world: Point) {
        this.s.isDragging = true
        this.s.dragStart = { x: ctx.snap(world.x), y: ctx.snap(world.y) }
        this.s.lastWorld = { ...this.s.dragStart }

        // Show React-driven preview
        ctx.setBlockPreview({
            x: this.s.dragStart.x,
            y: this.s.dragStart.y,
            width: 0,
            height: 0,
        })
    }

    onMouseMove(ctx: DrawingContext, world: Point) {
        if (!this.s.isDragging) return
        this.s.lastWorld = world

        const x = Math.min(this.s.dragStart.x, world.x)
        const y = Math.min(this.s.dragStart.y, world.y)
        const w = Math.abs(world.x - this.s.dragStart.x)
        const h = Math.abs(world.y - this.s.dragStart.y)

        ctx.setBlockPreview({ x, y, width: w, height: h })
    }

    onMouseUp(ctx: DrawingContext) {
        if (!this.s.isDragging) return
        this.s.isDragging = false

        // Remove preview
        ctx.setBlockPreview(null)

        const x = Math.min(this.s.dragStart.x, this.s.lastWorld.x)
        const y = Math.min(this.s.dragStart.y, this.s.lastWorld.y)
        const w = Math.abs(this.s.lastWorld.x - this.s.dragStart.x)
        const h = Math.abs(this.s.lastWorld.y - this.s.dragStart.y)

        const minW = 160, minH = 100
        const finalW = w < minW ? this.defaultW : w
        const finalH = h < minH ? this.defaultH : h

        this.onBlockCreate(this.blockType, x, y, finalW, finalH)
        ctx.setSubTool('draw-select')
    }
}

