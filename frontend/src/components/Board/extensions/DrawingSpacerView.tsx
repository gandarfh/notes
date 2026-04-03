import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

export function DrawingSpacerView({ node }: NodeViewProps) {
    const height = (node.attrs.height as number) || 100

    return (
        <NodeViewWrapper
            className="drawing-spacer"
            style={{ height: `${height}px` }}
            data-drawing-spacer=""
            data-spacer-id={node.attrs.spacerId}
        />
    )
}
