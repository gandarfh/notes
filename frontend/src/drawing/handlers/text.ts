// ── Text Handler ───────────────────────────────────────────
// Handles: text tool — click to create inline text.

import type { DrawingContext, InteractionHandler, Point } from '../interfaces'
import { genId } from '../types'

export class TextHandler implements InteractionHandler {
    onMouseDown(ctx: DrawingContext, world: Point) {
        if (ctx.isEditing) return

        const tx = ctx.snap(world.x), ty = ctx.snap(world.y)
        const d = ctx.getDefaults('text')
        const resolvedFont = ctx.isSketchy ? "'Architects Daughter', Caveat, cursive" : d.fontFamily
        const resolvedSize = ctx.isSketchy ? Math.round((d.fontSize || 14) * 1.3) : d.fontSize
        ctx.showEditor({
            worldX: tx,
            worldY: ty,
            initialText: '',
            fontSize: resolvedSize,
            fontFamily: resolvedFont,
            fontWeight: d.fontWeight,
            textColor: d.textColor,
            textAlign: 'left',
            onCommit: (text) => {
                if (text) {
                    ctx.elements.push({
                        id: genId(), type: 'text',
                        x: tx, y: ty, width: 0, height: 0,
                        text, fontSize: d.fontSize,
                        strokeColor: d.strokeColor, strokeWidth: 1,
                        backgroundColor: 'transparent',
                        fontFamily: d.fontFamily, fontWeight: d.fontWeight,
                        textColor: d.textColor, opacity: d.opacity,
                    })
                    ctx.save(); ctx.render()
                }
                // Return to select tool after committing
                ctx.setSubTool('draw-select')
            },
            onCancel: () => {
                ctx.setSubTool('draw-select')
            },
        })
    }

    onMouseMove(_ctx: DrawingContext, _world: Point) {
        // No drag interaction for text tool
    }

    onMouseUp(_ctx: DrawingContext) {
        // No release interaction for text tool
    }
}
