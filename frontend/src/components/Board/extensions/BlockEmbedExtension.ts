import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { BlockEmbedView } from './BlockEmbedView'

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        blockEmbed: {
            insertBlockEmbed: (attrs: { blockId: string; blockType: string }) => ReturnType
        }
    }
}

export const BlockEmbedExtension = Node.create({
    name: 'blockEmbed',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            blockId: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('blockid'),
                renderHTML: (attrs: Record<string, any>) => ({ blockid: attrs.blockId }),
            },
            blockType: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('blocktype'),
                renderHTML: (attrs: Record<string, any>) => ({ blocktype: attrs.blockType }),
            },
            height: {
                default: 200,
                parseHTML: (el: HTMLElement) => parseInt(el.getAttribute('height') || '200', 10),
                renderHTML: (attrs: Record<string, any>) => ({ height: attrs.height }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-block-embed]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-block-embed': '' })]
    },

    addCommands() {
        return {
            insertBlockEmbed: (attrs) => ({ commands }) => {
                return commands.insertContent({
                    type: this.name,
                    attrs,
                })
            },
        }
    },

    addNodeView() {
        return ReactNodeViewRenderer(BlockEmbedView)
    },
})
