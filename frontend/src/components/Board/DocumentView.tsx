import { useEffect, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import { BlockEmbedExtension } from './extensions/BlockEmbedExtension'
import { SlashMenuExtension } from './extensions/SlashMenu'
import './DocumentView.css'

interface Props {
    pageId: string
}

export function DocumentView({ pageId }: Props) {
    const initialContent = useAppStore(s => s.activeBoardContent)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const editorRef = useRef<any>(null)

    const saveContent = useCallback((markdown: string) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            api.updateBoardContent(pageId, markdown)
            useAppStore.setState({ activeBoardContent: markdown })
        }, 500)
    }, [pageId])

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            Placeholder.configure({
                placeholder: 'Type / for commands...',
            }),
            Markdown.configure({
                html: true,
                transformPastedText: true,
                transformCopiedText: true,
            }),
            BlockEmbedExtension,
            SlashMenuExtension,
        ],
        content: initialContent || '',
        editorProps: {
            attributes: {
                class: 'document-editor',
                spellcheck: 'false',
            },
        },
        onUpdate({ editor }: any) {
            const md = (editor.storage as any).markdown?.getMarkdown?.() ?? ''
            saveContent(md)
        },
    } as any)

    editorRef.current = editor

    // Handle block insertion from slash menu
    useEffect(() => {
        const handler = async (e: Event) => {
            const { blockType } = (e as CustomEvent).detail
            const currentEditor = editorRef.current
            if (!currentEditor) return

            // Create block via backend
            const block = await useAppStore.getState().createBlock(blockType, 0, 0, 400, 300, 'document')
            if (!block) return

            // Insert embed node
            currentEditor.commands.insertBlockEmbed({
                blockId: block.id,
                blockType: block.type,
            })
        }

        window.addEventListener('board:insert-block', handler)
        return () => window.removeEventListener('board:insert-block', handler)
    }, [])

    // Cleanup save timer
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        }
    }, [])

    return (
        <div className="document-view">
            <EditorContent editor={editor} />
        </div>
    )
}
