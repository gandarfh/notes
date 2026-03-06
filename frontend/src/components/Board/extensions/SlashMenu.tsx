import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { createRoot, type Root } from 'react-dom/client'
import { BlockRegistry } from '../../../plugins/registry'
import { api } from '../../../bridge/wails'
import {
    IconAlignLeft,
    IconH1,
    IconH2,
    IconH3,
    IconList,
    IconListNumbers,
    IconBlockquote,
    IconMinus,
    IconCode,
    IconListCheck,
    IconInfoCircle,
    IconAlertTriangle,
    IconCircleCheck,
    IconCircleX,
    IconChevronRight,
    IconTable,
    IconPhoto,
    IconFileImport,
} from '@tabler/icons-react'
import type { ComponentType } from 'react'

export interface SlashCommandItem {
    id: string
    label: string
    icon: ComponentType<{ size?: number }>
    section: 'Basic' | 'Blocks'
    command: (props: { editor: any; range: any }) => void
}

const basicCommands: SlashCommandItem[] = [
    {
        id: 'text',
        label: 'Text',
        icon: IconAlignLeft,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setParagraph().run()
        },
    },
    {
        id: 'heading1',
        label: 'Heading 1',
        icon: IconH1,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
        },
    },
    {
        id: 'heading2',
        label: 'Heading 2',
        icon: IconH2,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
        },
    },
    {
        id: 'heading3',
        label: 'Heading 3',
        icon: IconH3,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
        },
    },
    {
        id: 'bullet-list',
        label: 'Bullet List',
        icon: IconList,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBulletList().run()
        },
    },
    {
        id: 'numbered-list',
        label: 'Numbered List',
        icon: IconListNumbers,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleOrderedList().run()
        },
    },
    {
        id: 'quote',
        label: 'Quote',
        icon: IconBlockquote,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBlockquote().run()
        },
    },
    {
        id: 'divider',
        label: 'Divider',
        icon: IconMinus,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHorizontalRule().run()
        },
    },
    {
        id: 'code-block',
        label: 'Code Block',
        icon: IconCode,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
        },
    },
    {
        id: 'task-list',
        label: 'Task List',
        icon: IconListCheck,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleTaskList().run()
        },
    },
    {
        id: 'callout-info',
        label: 'Callout (Info)',
        icon: IconInfoCircle,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({
                type: 'callout',
                attrs: { type: 'info' },
                content: [{ type: 'paragraph' }],
            }).run()
        },
    },
    {
        id: 'callout-warning',
        label: 'Callout (Warning)',
        icon: IconAlertTriangle,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({
                type: 'callout',
                attrs: { type: 'warning' },
                content: [{ type: 'paragraph' }],
            }).run()
        },
    },
    {
        id: 'callout-success',
        label: 'Callout (Success)',
        icon: IconCircleCheck,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({
                type: 'callout',
                attrs: { type: 'success' },
                content: [{ type: 'paragraph' }],
            }).run()
        },
    },
    {
        id: 'callout-error',
        label: 'Callout (Error)',
        icon: IconCircleX,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({
                type: 'callout',
                attrs: { type: 'error' },
                content: [{ type: 'paragraph' }],
            }).run()
        },
    },
    {
        id: 'toggle',
        label: 'Toggle',
        icon: IconChevronRight,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({
                type: 'toggle',
                content: [{ type: 'paragraph' }],
            }).run()
        },
    },
    {
        id: 'table',
        label: 'Table',
        icon: IconTable,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        },
    },
    {
        id: 'image',
        label: 'Image',
        icon: IconPhoto,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            const url = prompt('Image URL:')
            if (url) {
                editor.chain().focus().setImage({ src: url }).run()
            }
        },
    },
    {
        id: 'import-markdown',
        label: 'Import Markdown',
        icon: IconFileImport,
        section: 'Basic',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            api.pickMarkdownFileContent().then((content) => {
                if (content) {
                    editor.chain().selectAll().deleteSelection().run()
                    const parsed = editor.storage.markdown?.parser?.parse(content)
                    if (parsed) {
                        editor.commands.insertContent(parsed)
                        setTimeout(() => {
                            editor.commands.setTextSelection(0)
                            // Walk up DOM to find the actual scrolling container
                            let el: HTMLElement | null = editor.view.dom
                            while (el) {
                                if (el.scrollHeight > el.clientHeight) {
                                    el.scrollTop = 0
                                    break
                                }
                                el = el.parentElement
                            }
                        }, 100)
                    }
                }
            })
        },
    },
]

function getItems(query: string): SlashCommandItem[] {
    const q = query.toLowerCase()

    const filteredBasic = basicCommands.filter(c => c.label.toLowerCase().includes(q))

    const plugins = BlockRegistry.getCreatable()
    const blockItems: SlashCommandItem[] = plugins
        .filter(p => p.label.toLowerCase().includes(q))
        .map(plugin => ({
            id: `block-${plugin.type}`,
            label: plugin.label,
            icon: plugin.Icon,
            section: 'Blocks' as const,
            command: ({ editor, range }: { editor: any; range: any }) => {
                editor.chain().focus().deleteRange(range).run()
                const event = new CustomEvent('board:insert-block', {
                    detail: { blockType: plugin.type, editor },
                })
                window.dispatchEvent(event)
            },
        }))

    return [...filteredBasic, ...blockItems]
}

// ── Popup Component ─────────────────────────────────────────

interface SlashMenuPopupProps {
    items: SlashCommandItem[]
    onSelect: (item: SlashCommandItem) => void
}

export interface SlashMenuPopupHandle {
    onKeyDown: (event: KeyboardEvent) => boolean
    updateItems: (items: SlashCommandItem[]) => void
    updateCommand: (command: (item: SlashCommandItem) => void) => void
}

const SlashMenuPopup = forwardRef<SlashMenuPopupHandle, SlashMenuPopupProps>(
    function SlashMenuPopup({ items: initialItems, onSelect: initialOnSelect }, ref) {
        const [items, setItems] = useState(initialItems)
        const [selectedIndex, setSelectedIndex] = useState(0)
        const commandRef = useRef(initialOnSelect)
        // Refs mirror state so onKeyDown always reads fresh values (no stale closures)
        const itemsRef = useRef(initialItems)
        const selectedIndexRef = useRef(0)
        const containerRef = useRef<HTMLDivElement>(null)

        // Keep refs in sync with state
        itemsRef.current = items
        selectedIndexRef.current = selectedIndex

        // Scroll selected item into view
        useEffect(() => {
            const container = containerRef.current
            if (!container) return
            const selected = container.querySelector('.slash-menu-item.selected') as HTMLElement
            if (selected) {
                selected.scrollIntoView({ block: 'nearest' })
            }
        }, [selectedIndex])

        useImperativeHandle(ref, () => ({
            onKeyDown(event: KeyboardEvent) {
                const curItems = itemsRef.current
                const curIdx = selectedIndexRef.current

                if (event.key === 'ArrowUp') {
                    const next = (curIdx - 1 + curItems.length) % curItems.length
                    setSelectedIndex(next)
                    return true
                }
                if (event.key === 'ArrowDown') {
                    const next = (curIdx + 1) % curItems.length
                    setSelectedIndex(next)
                    return true
                }
                if (event.key === 'Enter') {
                    const item = curItems[curIdx]
                    if (item) commandRef.current(item)
                    return true
                }
                return false
            },
            updateItems(newItems: SlashCommandItem[]) {
                setItems(newItems)
                setSelectedIndex(0)
            },
            updateCommand(command: (item: SlashCommandItem) => void) {
                commandRef.current = command
            },
        }), [])

        if (items.length === 0) {
            return (
                <div className="slash-menu">
                    <div className="slash-menu-empty">No results</div>
                </div>
            )
        }

        // Group items by section, preserving order
        const sections: { name: string; items: SlashCommandItem[] }[] = []
        let currentSection = ''
        for (const item of items) {
            if (item.section !== currentSection) {
                currentSection = item.section
                sections.push({ name: currentSection, items: [] })
            }
            sections[sections.length - 1].items.push(item)
        }

        // Build flat index for keyboard navigation
        let flatIndex = 0

        return (
            <div className="slash-menu" ref={containerRef}>
                {sections.map(section => (
                    <div key={section.name}>
                        <div className="slash-menu-section">{section.name}</div>
                        {section.items.map(item => {
                            const idx = flatIndex++
                            return (
                                <button
                                    key={item.id}
                                    className={`slash-menu-item ${idx === selectedIndex ? 'selected' : ''}`}
                                    onClick={() => commandRef.current(item)}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                >
                                    <item.icon size={16} />
                                    <span>{item.label}</span>
                                </button>
                            )
                        })}
                    </div>
                ))}
            </div>
        )
    }
)

// ── Suggestion render lifecycle ─────────────────────────────

function createSuggestionRenderer() {
    let popup: HTMLDivElement | null = null
    let root: Root | null = null
    let menuRef: SlashMenuPopupHandle | null = null

    return {
        onStart(props: SuggestionProps) {
            popup = document.createElement('div')
            popup.className = 'slash-menu-portal'
            document.body.appendChild(popup)

            const rect = props.clientRect?.()
            if (rect && popup) {
                popup.style.position = 'fixed'
                popup.style.left = `${rect.left}px`
                popup.style.top = `${rect.bottom + 4}px`
                popup.style.zIndex = '9999'
            }

            root = createRoot(popup)
            root.render(
                <SlashMenuPopup
                    ref={(handle) => { menuRef = handle }}
                    items={getItems(props.query)}
                    onSelect={(item) => item.command(props as any)}
                />
            )
        },

        onUpdate(props: SuggestionProps) {
            const rect = props.clientRect?.()
            if (rect && popup) {
                popup.style.left = `${rect.left}px`
                popup.style.top = `${rect.bottom + 4}px`
            }
            menuRef?.updateItems(getItems(props.query))
            menuRef?.updateCommand((item) => item.command(props as any))
        },

        onKeyDown({ event }: { event: KeyboardEvent }) {
            if (event.key === 'Escape') {
                cleanup()
                return true
            }
            return menuRef?.onKeyDown(event) ?? false
        },

        onExit() {
            cleanup()
        },
    }

    function cleanup() {
        root?.unmount()
        popup?.remove()
        popup = null
        root = null
        menuRef = null
    }
}

// ── Extension ───────────────────────────────────────────────

export const SlashMenuExtension = Extension.create({
    name: 'slashMenu',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                startOfLine: false,
                items: ({ query }: { query: string }) => getItems(query),
                render: createSuggestionRenderer,
                command: ({ editor, range, props }: any) => {
                    props.command({ editor, range })
                },
            } satisfies Partial<SuggestionOptions>,
        }
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ]
    },
})
