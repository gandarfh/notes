import { useMemo, useCallback, useRef } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useAppStore } from '../../../store'
import { BlockRegistry } from '../../../plugins/registry'
import { createPluginContext } from '../../../plugins/sdk/runtime/contextFactory'
import type { BlockData } from '../../../plugins/sdk'

export function BlockEmbedView({ node, deleteNode, updateAttributes }: NodeViewProps) {
    const blockId = node.attrs.blockId as string
    const blockType = node.attrs.blockType as string
    const height = (node.attrs.height as number) || 200

    const block = useAppStore(s => s.blocks.get(blockId))
    const plugin = BlockRegistry.get(blockType)

    const startYRef = useRef(0)
    const startHeightRef = useRef(0)

    const onResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        startYRef.current = e.clientY
        startHeightRef.current = height

        const onMouseMove = (ev: MouseEvent) => {
            const delta = ev.clientY - startYRef.current
            const newHeight = Math.max(80, startHeightRef.current + delta)
            updateAttributes({ height: newHeight })
        }

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
        }

        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
    }, [height, updateAttributes])

    const ctx = useMemo(() => {
        if (!block) return null
        const blockData: BlockData = {
            id: block.id,
            pageId: block.pageId,
            type: block.type,
            content: block.content,
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height,
            filePath: block.filePath,
        }
        return createPluginContext(blockData)
    }, [block?.id])

    if (!block || !plugin || !ctx) {
        return (
            <NodeViewWrapper className="board-embed-missing" contentEditable={false}>
                <div className="board-embed-error">
                    Block not found
                    <button onClick={deleteNode} className="board-embed-remove">Remove</button>
                </div>
            </NodeViewWrapper>
        )
    }

    return (
        <NodeViewWrapper className="board-embed-wrapper" contentEditable={false} data-block-id={blockId}>
            <div className="board-embed-header">
                <plugin.Icon size={14} />
                <span>{plugin.label}</span>
            </div>
            <div className="board-embed-content" style={{ height }}>
                <plugin.Renderer
                    block={block as unknown as BlockData}
                    ctx={ctx}
                    isEditing={false}
                    isSelected={false}
                />
            </div>
            <div className="board-embed-resize-handle" onMouseDown={onResizeStart} />
        </NodeViewWrapper>
    )
}
