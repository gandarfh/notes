// ── Shape Handler ──────────────────────────────────────────
// Handles: drag-to-create shapes (rectangle, ellipse, diamond).

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'
import type { DrawingSubTool } from '../types'
import { genId } from '../types'

interface ShapeState {
    isDrawing: boolean
    dragStart: Point
}

export class ShapeHandler implements InteractionHandler {
    private s: ShapeState = { isDrawing: false, dragStart: { x: 0, y: 0 } }
    private shapeType: 'rectangle' | 'ellipse' | 'diamond'

    constructor(shapeType: 'rectangle' | 'ellipse' | 'diamond') {
        this.shapeType = shapeType
    }

    deactivate(ctx: DrawingContext) {
        this.s = { isDrawing: false, dragStart: { x: 0, y: 0 } }
        ctx.currentElement = null
    }

    onMouseDown(ctx: DrawingContext, world: Point) {
        this.s.isDrawing = true
        this.s.dragStart = { x: ctx.snap(world.x), y: ctx.snap(world.y) }

        const d = ctx.getDefaults(this.shapeType)
        ctx.currentElement = {
            id: genId(), type: this.shapeType,
            x: this.s.dragStart.x, y: this.s.dragStart.y, width: 0, height: 0,
            strokeColor: d.strokeColor, strokeWidth: d.strokeWidth,
            backgroundColor: d.backgroundColor,
            fontSize: d.fontSize, fontFamily: d.fontFamily, fontWeight: d.fontWeight,
            textColor: d.textColor, borderRadius: d.borderRadius,
            opacity: d.opacity, fillStyle: d.fillStyle as 'solid' | 'hachure',
        }
    }

    onMouseMove(ctx: DrawingContext, world: Point) {
        if (!this.s.isDrawing || !ctx.currentElement) return

        const x = Math.min(this.s.dragStart.x, world.x)
        const y = Math.min(this.s.dragStart.y, world.y)
        ctx.currentElement.x = x
        ctx.currentElement.y = y
        ctx.currentElement.width = Math.abs(world.x - this.s.dragStart.x)
        ctx.currentElement.height = Math.abs(world.y - this.s.dragStart.y)
        ctx.render()
    }

    onMouseUp(ctx: DrawingContext) {
        if (!this.s.isDrawing || !ctx.currentElement) return
        this.s.isDrawing = false

        const el = ctx.currentElement
        if (el.width > 5 || el.height > 5) {
            // Drag-to-create: snap and commit
            el.x = ctx.snap(el.x); el.y = ctx.snap(el.y)
            el.width = Math.max(ctx.grid(), ctx.snap(el.width))
            el.height = Math.max(ctx.grid(), ctx.snap(el.height))
        } else {
            // Click-to-place: create with default size, centered on click
            const defaultW = this.shapeType === 'rectangle' ? ctx.grid() * 5.33 : ctx.grid() * 4  // rect: ~160px, others: 120px
            const defaultH = this.shapeType === 'rectangle' ? ctx.grid() * 2 : ctx.grid() * 4  // rect: 60px, others: 120px
            el.x = ctx.snap(this.s.dragStart.x - defaultW / 2)
            el.y = ctx.snap(this.s.dragStart.y - defaultH / 2)
            el.width = defaultW
            el.height = defaultH
        }

        ctx.elements.push(el)
        ctx.selectedElement = el
        ctx.save()
        ctx.setSubTool('draw-select')

        ctx.currentElement = null
        ctx.render()
    }
}
