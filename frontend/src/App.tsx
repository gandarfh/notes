import { useEffect, useCallback, useState, useRef } from 'react'
import { Breadcrumb } from './components/Breadcrumb/Breadcrumb'
import { CommandPalette } from './components/CommandPalette/CommandPalette'
import { Toolbar } from './components/Toolbar/Toolbar'
import { Canvas } from './components/Canvas/Canvas'
import { UndoPanel } from './components/UndoPanel/UndoPanel'
import { ToastContainer } from './components/Toast/Toast'
import { ApprovalModal } from './components/MCP/ApprovalModal'
import { MCPIndicator } from './components/MCP/MCPIndicator'
import { useAppStore } from './store'
import { useUndoTree } from './store/useUndoTree'
import { restoreSnapshot } from './store/helpers'
import { useTerminal } from './hooks/useTerminal'
import { bindGlobalKeydown, initLayer0, initLayer4 } from './input'
import { setCloseEditor } from './input/drawingBridge'
import { api } from './bridge/wails'
import type { Block, Connection } from './bridge/wails'
import logoSvg from './assets/images/logo.svg'

export function App() {
    const activePageId = useAppStore(s => s.activePageId)
    const initializing = useAppStore(s => s.initializing)
    const loadNotebooks = useAppStore(s => s.loadNotebooks)
    const initEventListeners = useAppStore(s => s.initEventListeners)
    const terminal = useTerminal()
    const terminalRef = useRef(terminal)
    terminalRef.current = terminal
    const [showUndoPanel, setShowUndoPanel] = useState(false)
    const [showPalette, setShowPalette] = useState(false)

    const editBlock = useCallback((blockId: string, lineNumber: number) => {
        useAppStore.getState().setEditing(blockId)

        const mount = () => {
            const el = document.querySelector(`[data-terminal-container][data-block-id="${blockId}"]`) as HTMLElement
            if (!el) {
                requestAnimationFrame(() => {
                    const el2 = document.querySelector(`[data-terminal-container][data-block-id="${blockId}"]`) as HTMLElement
                    if (el2) terminal.open(el2, blockId, lineNumber)
                })
                return
            }
            terminal.open(el, blockId, lineNumber)
        }
        setTimeout(mount, 0)
    }, [terminal])

    // ── Initialize InputManager layers ──
    useEffect(() => {
        const applySnapshot = (snapshot: { blocks: Block[]; drawingData: string; connections: Connection[] }) => {
            restoreSnapshot(useAppStore.setState, snapshot)

            // Persist full block state to backend (atomic replace)
            const { activePageId } = useAppStore.getState()
            if (!activePageId) return
            api.restorePageBlocks(activePageId, snapshot.blocks)
            api.updateDrawingData(activePageId, snapshot.drawingData)
        }

        initLayer0({
            togglePalette: () => setShowPalette(p => !p),
            undo: () => {
                const { activePageId } = useAppStore.getState()
                if (!activePageId) return
                const snapshot = useUndoTree.getState().undo(activePageId)
                if (snapshot) applySnapshot(snapshot)
            },
            redo: () => {
                const { activePageId } = useAppStore.getState()
                if (!activePageId) return
                const snapshot = useUndoTree.getState().redo(activePageId)
                if (snapshot) applySnapshot(snapshot)
            },
        })

        initLayer4({ onEditBlock: editBlock })

        // Register terminal close so Canvas can close editor on outside click
        setCloseEditor(() => terminalRef.current.close())

        const unbind = bindGlobalKeydown()
        return () => {
            unbind()
            setCloseEditor(null)
        }
    }, [editBlock])

    useEffect(() => {
        loadNotebooks()
        const cleanup = initEventListeners()
        return cleanup
    }, [])

    return (
        <div className="w-full h-full relative">
            <header className="app-header">
                <div className="header-left">
                    <Breadcrumb />
                </div>
                <Toolbar
                    showUndoPanel={showUndoPanel}
                    onToggleUndoPanel={() => setShowUndoPanel(p => !p)}
                    onOpenPalette={() => setShowPalette(true)}
                />
            </header>
            <CommandPalette isOpen={showPalette} onClose={() => setShowPalette(false)} />

            <main className="w-full h-full flex flex-col relative overflow-hidden pt-[72px]">
                <div className="flex-1 flex relative overflow-hidden">
                    <Canvas onEditBlock={editBlock} />
                    {showUndoPanel && <UndoPanel />}
                </div>

                {/* Empty State */}
                {!activePageId && !initializing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted z-1 pointer-events-none">
                        <div className="mb-6 opacity-80"><img src={logoSvg} alt="Notes" width={96} height={96} /></div>
                        <h2 className="text-lg font-semibold text-text-secondary mb-2">Welcome to Notes</h2>
                        <p className="text-sm max-w-[300px] text-center leading-relaxed">
                            Press <kbd className="px-1.5 py-0.5 bg-elevated rounded text-text-secondary text-xs font-mono border border-border-subtle">⌘</kbd> <kbd className="px-1.5 py-0.5 bg-elevated rounded text-text-secondary text-xs font-mono border border-border-subtle">k</kbd> to get started.
                        </p>
                    </div>
                )}
            </main>
            <ToastContainer />
            <ApprovalModal />
            <MCPIndicator />
        </div>
    )
}
