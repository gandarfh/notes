import { useAppStore } from '../../store'
import type { DrawingSubTool } from '../../store/types'

const tools: { id: DrawingSubTool | 'block'; icon: React.ReactNode; title: string; key: string }[] = [
    {
        id: 'draw-select', title: 'Select (1)', key: '1',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 2l11 8-5.5 1.5L9 17z" stroke="currentColor" strokeWidth="1.3" fill="currentColor" opacity="0.08" /></svg>,
    },
    { id: 'rectangle' as DrawingSubTool, title: 'Rectangle (2)', key: '2', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" /></svg> },
    { id: 'ellipse' as DrawingSubTool, title: 'Ellipse (3)', key: '3', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><ellipse cx="10" cy="10" rx="7" ry="5.5" stroke="currentColor" strokeWidth="1.3" /></svg> },
    { id: 'diamond' as DrawingSubTool, title: 'Diamond (4)', key: '4', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2l8 8-8 8-8-8z" stroke="currentColor" strokeWidth="1.3" /></svg> },
    { id: 'ortho-arrow' as DrawingSubTool, title: 'Arrow (5)', key: '5', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 16h7V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 7l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg> },
    { id: 'freedraw' as DrawingSubTool, title: 'Free Draw (6)', key: '6', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 17c2-4 4-7 6-9s5-3 7-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="16" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.3" /></svg> },
    { id: 'text' as DrawingSubTool, title: 'Text (T)', key: 't', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><text x="5.5" y="16" fontSize="15" fontWeight="700" fill="currentColor">T</text></svg> },
    {
        id: 'block', title: 'Note Block (M)', key: 'm',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M6 13V7l2.5 3L11 7v6M14 10l-1.5 1.5M14 10l-1.5-1.5M14 10h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
        id: 'db-block', title: 'Database Block (D)', key: 'd',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><ellipse cx="10" cy="6" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4 6v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V6" stroke="currentColor" strokeWidth="1.3" /><path d="M4 10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" strokeWidth="1.3" /></svg>,
    },
]

// Groups
const GROUP_1 = ['draw-select']
const GROUP_2 = ['rectangle', 'ellipse', 'diamond', 'ortho-arrow']
const GROUP_3 = ['freedraw', 'text']
const GROUP_4 = ['block', 'db-block']

// Tiny component — only re-renders when zoom changes, not the whole toolbar
function ZoomDisplay() {
    const zoom = useAppStore(s => s.viewport.zoom)
    return <span className="toolbar-zoom">{Math.round(zoom * 100)}%</span>
}

export function Toolbar({ showUndoPanel, onToggleUndoPanel }: {
    showUndoPanel: boolean
    onToggleUndoPanel: () => void
}) {
    const drawingSubTool = useAppStore(s => s.drawingSubTool)
    const setDrawingSubTool = useAppStore(s => s.setDrawingSubTool)
    const boardStyle = useAppStore(s => s.boardStyle)
    const setBoardStyle = useAppStore(s => s.setBoardStyle)

    const renderGroup = (ids: string[]) =>
        tools.filter(t => ids.includes(t.id)).map(tool => (
            <button
                key={tool.id}
                className={`toolbar-btn ${drawingSubTool === tool.id ? 'active' : ''}`}
                title={tool.title}
                onClick={() => setDrawingSubTool(tool.id as DrawingSubTool)}
            >
                {tool.icon}
                <span className="toolbar-key">{tool.key.toUpperCase()}</span>
            </button>
        ))

    return (
        <div className="toolbar-container">
            <div className="toolbar-pill">
                {renderGroup(GROUP_1)}
                <div className="toolbar-divider" />
                {renderGroup(GROUP_2)}
                <div className="toolbar-divider" />
                {renderGroup(GROUP_3)}
                <div className="toolbar-divider" />
                {renderGroup(GROUP_4)}
            </div>

            <div className="toolbar-right">
                <button
                    className={`toolbar-btn ${boardStyle === 'sketchy' ? 'active' : ''}`}
                    title={boardStyle === 'sketchy' ? 'Switch to Clean' : 'Switch to Sketchy'}
                    onClick={() => setBoardStyle(boardStyle === 'sketchy' ? 'clean' : 'sketchy')}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3 17l2-6L14 2l3 3L8 14z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={boardStyle === 'sketchy' ? 'currentColor' : 'none'} opacity={boardStyle === 'sketchy' ? 0.15 : 1} />
                        <path d="M5 11l4 4" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                </button>
                <button
                    className={`toolbar-btn ${showUndoPanel ? 'active' : ''}`}
                    title="History (Undo Tree)"
                    onClick={onToggleUndoPanel}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10a7 7 0 1 1 2 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <path d="M4 6v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
                <ZoomDisplay />
            </div>
        </div>
    )
}
