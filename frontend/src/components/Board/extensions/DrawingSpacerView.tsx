import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

export function DrawingSpacerView({ node }: NodeViewProps) {
    const height = (node.attrs.height as number) || 100

    return (
        <NodeViewWrapper
            className="drawing-spacer"
            style={{
                height: `${height}px`,
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px dashed rgba(99, 102, 241, 0.4)',
                borderRadius: '4px',
            }}
            data-drawing-spacer=""
            data-spacer-id={node.attrs.spacerId}
        >
            <span style={{ fontSize: '10px', color: 'rgba(99, 102, 241, 0.6)', padding: '4px', userSelect: 'none' }}>
                spacer: {node.attrs.spacerId} — {height}px
            </span>
        </NodeViewWrapper>
    )
}
