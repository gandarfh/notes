import { Node, mergeAttributes } from '@tiptap/core'

export const DrawingSpacerExtension = Node.create({
    name: 'drawingSpacer',
    group: 'block',
    atom: true,
    selectable: false,
    draggable: false,

    addAttributes() {
        return {
            spacerId: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-spacer-id') || '',
                renderHTML: (attrs: Record<string, any>) => ({ 'data-spacer-id': attrs.spacerId }),
            },
            height: {
                default: 100,
                parseHTML: (el: HTMLElement) => parseInt(el.getAttribute('data-height') || '100', 10),
                renderHTML: (attrs: Record<string, any>) => ({ 'data-height': attrs.height }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-drawing-spacer]' }]
    },

    renderHTML({ HTMLAttributes }) {
        const height = HTMLAttributes['data-height'] || 100
        return ['div', mergeAttributes(HTMLAttributes, {
            'data-drawing-spacer': '',
            class: 'drawing-spacer',
            style: `height: ${height}px`,
        })]
    },
})
