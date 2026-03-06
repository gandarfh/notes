import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

export function ToggleView({ node, updateAttributes }: any) {
    const isOpen = node.attrs.open

    return (
        <NodeViewWrapper className={`doc-toggle ${isOpen ? 'doc-toggle-open' : ''}`}>
            <button
                className="doc-toggle-trigger"
                onClick={() => updateAttributes({ open: !isOpen })}
                contentEditable={false}
                title={isOpen ? 'Collapse' : 'Expand'}
            >
                <span className="doc-toggle-arrow">▶</span>
            </button>
            <NodeViewContent className="doc-toggle-content" style={{ display: isOpen ? 'block' : 'none' }} />
        </NodeViewWrapper>
    )
}
