import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CalloutView } from './CalloutView'

export const CalloutExtension = Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',

    addAttributes() {
        return {
            type: {
                default: 'info',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-type') || 'info',
                renderHTML: (attrs: Record<string, any>) => ({ 'data-type': attrs.type }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-callout]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
    },

    addNodeView() {
        return ReactNodeViewRenderer(CalloutView)
    },
})
