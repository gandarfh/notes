import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import type { BoardMode } from '../../bridge/wails'
import { DocumentView } from './DocumentView'
import { Canvas } from '../Canvas/Canvas'
import { MeetingChat } from '../MeetingChat/MeetingChat'
import './BoardPage.css'

const MIN_PANEL_WIDTH = 200

interface BoardPageProps {
    onEditBlock: (blockId: string, lineNumber: number) => void
}

export function BoardPage({ onEditBlock }: BoardPageProps) {
    const pageId = useAppStore(s => s.activePageId)
    const mode = useAppStore(s => s.activeBoardMode)
    const [splitRatio, setSplitRatio] = useState(0.5)
    const splitRef = useRef<HTMLDivElement>(null)

    const setMode = useCallback(async (newMode: BoardMode) => {
        if (!pageId || newMode === mode) return
        useAppStore.setState({ activeBoardMode: newMode })
        await api.updateBoardMode(pageId, newMode)
    }, [pageId, mode])

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        const container = splitRef.current
        if (!container) return

        const onMouseMove = (ev: MouseEvent) => {
            const rect = container.getBoundingClientRect()
            const totalWidth = rect.width
            const x = ev.clientX - rect.left
            const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(x, totalWidth - MIN_PANEL_WIDTH))
            setSplitRatio(clamped / totalWidth)
        }

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
    }, [])

    if (!pageId) return null

    return (
        <div className="board-page">
            <div className="board-header">
                <div className="board-mode-toggle">
                    <button
                        className={mode === 'document' ? 'active' : ''}
                        onClick={() => setMode('document')}
                    >
                        Document
                    </button>
                    <button
                        className={mode === 'dashboard' ? 'active' : ''}
                        onClick={() => setMode('dashboard')}
                    >
                        Dashboard
                    </button>
                    <button
                        className={mode === 'split' ? 'active' : ''}
                        onClick={() => setMode('split')}
                    >
                        Split
                    </button>
                </div>
            </div>
            {mode === 'split' ? (
                <div className="board-split" ref={splitRef}>
                    <div
                        className="board-split-panel"
                        style={{ width: `${splitRatio * 100}%` }}
                    >
                        <DocumentView pageId={pageId} />
                    </div>
                    <div
                        className="board-split-divider"
                        onMouseDown={handleDividerMouseDown}
                    />
                    <div className="board-split-panel board-split-canvas" style={{ flex: 1 }}>
                        <Canvas onEditBlock={onEditBlock} />
                    </div>
                </div>
            ) : (
                <div className="board-content">
                    {mode === 'document' ? (
                        <DocumentView pageId={pageId} />
                    ) : (
                        <Canvas onEditBlock={onEditBlock} />
                    )}
                </div>
            )}
            <MeetingChat />
        </div>
    )
}
