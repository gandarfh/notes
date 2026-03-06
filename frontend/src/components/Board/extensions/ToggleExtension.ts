import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ToggleView } from './ToggleView'

export const ToggleExtension = Node.create({
    name: 'toggle',
    group: 'block',
    content: 'block+',

    addAttributes() {
        return {
            open: {
                default: true,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-open') !== 'false',
                renderHTML: (attrs: Record<string, any>) => ({ 'data-open': String(attrs.open) }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-toggle]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0]
    },

    addNodeView() {
        return ReactNodeViewRenderer(ToggleView)
    },
})
