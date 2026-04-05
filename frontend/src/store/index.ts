import { create } from 'zustand'
import { api, onEvent } from '../bridge/wails'
import type { Block, CanvasEntity } from '../bridge/wails'
import type { AppState } from './types'
import { useUndoTree } from './useUndoTree'
import { captureSnapshot, mergeBlocks } from './helpers'
import { createNotebookSlice } from './notebookSlice'
import { createCanvasSlice, createBlockSlice } from './canvasSlice'
import { createDrawingSlice } from './drawingSlice'
import { createConnectionSlice } from './connectionSlice'
import { createEntitySlice } from './entitySlice'
import { createSelectionSlice } from './selectionSlice'
import { createRecordingSlice } from './recordingSlice'
import { pluginBus } from '../plugins/sdk/runtime/eventBus'
import useToastStore from './toastSlice'

// Reload page state from DB and push an undo snapshot (for MCP changes)
async function reloadWithUndo(get: () => AppState, pageId: string, label: string) {
    try {
        const ps = await api.getPageState(pageId)
        const incoming = new Map<string, Block>()
            ; (ps.blocks || []).forEach(b => incoming.set(b.id, b))

        const store = get() as any
        const set = useAppStore.setState
        const current = get().blocks
        const selectedId = get().selectedBlockId
        const editingId = get().editingBlockId

        const merged = mergeBlocks(incoming, current, new Set([selectedId, editingId]))

        set({
            blocks: merged,
            connections: ps.connections || [],
            drawingData: ps.page.drawingData || '',
            activeBoardContent: ps.page.boardContent || '',
        })

        // Push undo snapshot so MCP changes can be undone
        await useUndoTree.getState().pushState(pageId, label, captureSnapshot(get))

        // Show toast notification
        useToastStore.getState().addToast(`🤖 ${label}`, 'info', 3000)
    } catch (e) {
        console.error('reloadWithUndo failed:', e)
    }
}

export const useAppStore = create<AppState>((...a) => ({
    ...createNotebookSlice(...a),
    ...createCanvasSlice(...a),
    ...createBlockSlice(...a),
    ...createDrawingSlice(...a),
    ...createConnectionSlice(...a),
    ...createEntitySlice(...a),
    ...createSelectionSlice(...a),
    ...createRecordingSlice(...a),

    // ── Cross-slice actions ────────────────────────────────

    loadPageState: async (pageId) => {
        const [set, get] = [a[0], a[1]]

        try {
            const ps = await api.getPageState(pageId)

            const blocks = new Map<string, Block>()
                ; (ps.blocks || []).forEach(b => blocks.set(b.id, b))

            const entities = new Map<string, CanvasEntity>()
                ; (ps.entities || []).forEach(e => entities.set(e.id, e))

            // Single atomic set — avoids blank-screen flash from clearing first
            set({
                viewport: { x: ps.page.viewportX, y: ps.page.viewportY, zoom: ps.page.viewportZoom || 1 },
                blocks,
                connections: ps.connections || [],
                entities,
                canvasConnections: ps.canvasConnections || [],
                drawingData: ps.page.drawingData || '',
                activePageType: ps.page.pageType || 'canvas',
                activeBoardMode: ps.page.boardMode || 'document',
                activeBoardContent: ps.page.boardContent || '',
                activeBoardLayout: ps.page.boardLayout || '[]',
                selectedIds: new Set(),
                selectedBlockId: null,
                editingBlockId: null,
            })

            // Load undo tree in background — don't block page rendering
            useUndoTree.getState().loadTree(pageId).then(() => {
                if (useUndoTree.getState().nodes.size === 0) {
                    useUndoTree.getState().pushState(pageId, 'Page loaded', captureSnapshot(get))
                }
            })
        } catch (e) {
            console.error('Failed to load page:', e)
        }
    },

    initEventListeners: () => {
        const [, get] = [a[0], a[1]]
        const unsubs: (() => void)[] = []

        // Neovim updated block content
        unsubs.push(onEvent('block:content-updated', (data: { blockId: string; content: string }) => {
            get().updateBlock(data.blockId, { content: data.content })
        }))

        // ETL sync completed — relay to plugins so LocalDB/Chart blocks refresh
        unsubs.push(onEvent('db:updated', (data: { databaseId: string; jobId: string }) => {
            pluginBus.emit('localdb:changed', { databaseId: data.databaseId })
            // Also reload blocks so the localdb block structure refreshes
            const activePageId = get().activePageId
            if (activePageId) {
                reloadWithUndo(get, activePageId, 'db:updated')
            }
        }))

        // MCP: blocks changed — reload page state and push undo snapshot
        unsubs.push(onEvent('mcp:blocks-changed', (data: { pageId: string }) => {
            const activePageId = get().activePageId
            if (activePageId && data.pageId === activePageId) {
                reloadWithUndo(get, activePageId, 'MCP: blocks changed')
                // Also notify LocalDB/Chart plugins to refresh data (ETL may have changed rows)
                pluginBus.emit('localdb:changed', {})
            }
        }))

        // MCP: board content changed — update Tiptap document content
        unsubs.push(onEvent('mcp:board-content-changed', (data: { pageId: string; content: string }) => {
            const activePageId = get().activePageId
            if (activePageId && data.pageId === activePageId) {
                useAppStore.setState({ activeBoardContent: data.content })
            }
        }))

        // MCP: drawing changed — reload drawing data and push undo snapshot
        unsubs.push(onEvent('mcp:drawing-changed', (data: { pageId: string }) => {
            const activePageId = get().activePageId
            if (activePageId && data.pageId === activePageId) {
                reloadWithUndo(get, activePageId, 'MCP: drawing changed')
            }
        }))

        // MCP: pages changed — refresh sidebar page list
        unsubs.push(onEvent('mcp:pages-changed', (data: { notebookId: string }) => {
            const activeNotebookId = get().activeNotebookId
            if (activeNotebookId && data.notebookId === activeNotebookId) {
                get().loadPages(activeNotebookId)
            }
        }))

        // MCP: navigate to page — auto-switch active page + notebook context
        unsubs.push(onEvent('mcp:navigate-page', async (data: { pageId: string }) => {
            if (!data.pageId || data.pageId === get().activePageId) return
            // Find which notebook this page belongs to, and switch context
            const notebooks = get().notebooks
            for (const nb of notebooks) {
                const pages = await api.listPages(nb.id)
                if (pages?.find((p: any) => p.id === data.pageId)) {
                    const [set] = a
                    set({
                        activeNotebookId: nb.id,
                        pages: pages || [],
                        expandedNotebooks: new Set([...get().expandedNotebooks, nb.id]),
                    })
                    await get().selectPage(data.pageId)
                    return
                }
            }
        }))

        // MCP: activity pulse — emit to plugin bus for indicator + toast
        unsubs.push(onEvent('mcp:activity', (data: { changes: number; pageId: string }) => {
            pluginBus.emit('mcp:activity', data)
        }))

        // MCP: approval required — relay to plugin bus for ApprovalModal
        unsubs.push(onEvent('mcp:approval-required', (data: any) => {
            pluginBus.emit('mcp:approval-required', data)
        }))

        // MCP: approval dismissed (timeout)
        unsubs.push(onEvent('mcp:approval-dismissed', (data: any) => {
            pluginBus.emit('mcp:approval-dismissed', data)
        }))

        // Meeting: recording started
        unsubs.push(onEvent('meeting:recording', (data: { meetingId: string; title: string }) => {
            useAppStore.setState({
                recordingActive: true,
                recordingMeetingId: data.meetingId,
                recordingTitle: data.title,
                recordingStartedAt: new Date().toISOString(),
                recordingError: null,
            })
        }))

        // Meeting: recording stopped — pipeline begins
        unsubs.push(onEvent('meeting:stopped', (data: { meetingId: string; title: string; status: string }) => {
            useAppStore.setState({
                recordingActive: false,
                recordingMeetingId: null,
                recordingTitle: null,
                recordingStartedAt: null,
                recordingFileSizeMb: 0,
                recordingAudioLevel: 0,
                // Pipeline starts, show processing state
                processingStatus: 'transcribing' as const,
                processingTitle: data.title,
                processingMeetingId: data.meetingId,
                processingError: null,
            })
        }))

        // Meeting: pipeline status update (transcribing → analyzing)
        unsubs.push(onEvent('meeting:status', (data: { meetingId: string; status: string; title: string; error?: string }) => {
            if (data.status === 'error') {
                useAppStore.setState({
                    processingStatus: null,
                    processingTitle: null,
                    processingMeetingId: null,
                    processingError: data.error || 'Erro no processamento',
                    recordingError: data.error || 'Erro no processamento',
                })
            } else {
                useAppStore.setState({
                    processingStatus: data.status as 'transcribing' | 'analyzing' | 'generating',
                    processingTitle: data.title,
                    processingMeetingId: data.meetingId,
                })
            }
        }))

        // Meeting: pipeline complete
        unsubs.push(onEvent('meeting:ready', (data: { meetingId: string; title: string; actionItemCount?: number }) => {
            const count = data.actionItemCount || 0
            useAppStore.setState({
                processingStatus: null,
                processingTitle: null,
                processingMeetingId: null,
                recordingCompletedTitle: data.title,
                recordingCompletedMeetingId: data.meetingId,
            })
            useToastStore.getState().addToast(
                `Reunião "${data.title}" processada. ${count} action item${count !== 1 ? 's' : ''}.`,
                'success', 8000,
            )
        }))

        return () => unsubs.forEach(fn => fn())
    },
}))

// Restore global font based on persisted boardStyle on app startup
try {
    const boardStyle = localStorage.getItem('boardStyle')
    if (boardStyle === 'sketchy') {
        document.documentElement.style.setProperty('--font-sans', "'Caveat', cursive")
        document.documentElement.style.fontSize = '17px'
    }
} catch { /* ignore localStorage errors in SSR/tests */ }
