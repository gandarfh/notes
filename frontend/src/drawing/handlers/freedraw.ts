// ── Freedraw Handler ───────────────────────────────────────
// Handles: freehand drawing paths.

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'
import { genId } from '../types'

interface FreedrawState {
    isDrawing: boolean
}

export class FreedrawHandler implements InteractionHandler {
    private s: FreedrawState = { isDrawing: false }

    deactivate(ctx: DrawingContext) {
        this.s = { isDrawing: false }
        ctx.currentElement = null
    }

    onMouseDown(ctx: DrawingContext, world: Point) {
        this.s.isDrawing = true
        const d = ctx.getDefaults('freedraw')
        ctx.currentElement = {
            id: genId(), type: 'freedraw',
            x: world.x, y: world.y, width: 0, height: 0,
            points: [[0, 0]],
            strokeColor: d.strokeColor, strokeWidth: d.strokeWidth,
            backgroundColor: 'transparent',
            opacity: d.opacity,
        }
    }

    onMouseMove(ctx: DrawingContext, world: Point) {
        if (!this.s.isDrawing || !ctx.currentElement?.points) return
        ctx.currentElement.points.push([world.x - ctx.currentElement.x, world.y - ctx.currentElement.y])
        ctx.render()
    }

    onMouseUp(ctx: DrawingContext) {
        if (!this.s.isDrawing || !ctx.currentElement) return
        this.s.isDrawing = false

        if ((ctx.currentElement.points?.length ?? 0) > 2) {
            ctx.elements.push(ctx.currentElement)
            ctx.selectedElement = ctx.currentElement
            ctx.save()
        }

        ctx.currentElement = null
        ctx.render()
    }
}
