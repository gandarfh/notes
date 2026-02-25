import { useAppStore } from '../../store'
import type { DrawingSubTool } from '../../store/types'
import { useTheme } from '../../hooks/useTheme'

const tools: { id: DrawingSubTool | 'block'; icon: React.ReactNode; title: string; key: string }[] = [
    {
        id: 'draw-select', title: 'Select (1)', key: '1',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 2l12 9.5-5 .8-2.8 4.7L4 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8.2 12.3l3 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
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
    {
        id: 'code-block' as DrawingSubTool, title: 'Code Block (C)', key: 'c',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7 6L3 10l4 4M13 6l4 4-4 4M11.5 4l-3 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
        id: 'localdb-block' as DrawingSubTool, title: 'Local DB (L)', key: 'l',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" /><line x1="3" y1="7.5" x2="17" y2="7.5" stroke="currentColor" strokeWidth="1" /><line x1="3" y1="11.5" x2="17" y2="11.5" stroke="currentColor" strokeWidth="1" /><line x1="8" y1="3" x2="8" y2="17" stroke="currentColor" strokeWidth="1" /></svg>,
    },
    {
        id: 'chart-block' as DrawingSubTool, title: 'Chart Block', key: '',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="11" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5" /><rect x="7" y="7" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7" /><rect x="11" y="9" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.6" /><rect x="15" y="4" width="3" height="13" rx="0.5" fill="currentColor" opacity="0.8" /></svg>,
    },
    {
        id: 'etl-block' as DrawingSubTool, title: 'ETL Sync Block', key: '',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4h4v4H4zM12 12h4v4h-4z" stroke="currentColor" strokeWidth="1.3" /><path d="M8 6h4M12 6l-2 3M10 9l2 3M8 14h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
    },
    {
        id: 'http-block' as DrawingSubTool, title: 'HTTP Request', key: '',
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3" /><path d="M3 10h14M10 3c-2 3-2 11 0 14M10 3c2 3 2 11 0 14" stroke="currentColor" strokeWidth="1" opacity="0.6" /></svg>,
    },
]

// Groups
const GROUP_1 = ['draw-select']
const GROUP_2 = ['rectangle', 'ellipse', 'diamond', 'ortho-arrow']
const GROUP_3 = ['freedraw', 'text']
const GROUP_4 = ['block', 'db-block', 'code-block', 'localdb-block', 'chart-block', 'etl-block', 'http-block']

// Tiny component — only re-renders when zoom changes, not the whole toolbar
function ZoomDisplay() {
    const zoom = useAppStore(s => s.viewport.zoom)
    return <span className="toolbar-zoom">{Math.round(zoom * 100)}%</span>
}

export function Toolbar({ showUndoPanel, onToggleUndoPanel, onOpenPalette }: {
    showUndoPanel: boolean
    onToggleUndoPanel: () => void
    onOpenPalette: () => void
}) {
    const drawingSubTool = useAppStore(s => s.drawingSubTool)
    const setDrawingSubTool = useAppStore(s => s.setDrawingSubTool)
    const boardStyle = useAppStore(s => s.boardStyle)
    const setBoardStyle = useAppStore(s => s.setBoardStyle)
    const { theme, toggleTheme } = useTheme()

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
        <>
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
                    className="toolbar-btn"
                    title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    onClick={toggleTheme}
                >
                    {theme === 'dark' ? (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.3" />
                            <path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.66 4.34l-1.42 1.42M5.76 14.24l-1.42 1.42M15.66 15.66l-1.42-1.42M5.76 5.76L4.34 4.34" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M17.39 13.35A7.5 7.5 0 0 1 6.65 2.61a7.5 7.5 0 1 0 10.74 10.74z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                        </svg>
                    )}
                </button>
                <button
                    className="toolbar-btn"
                    title="Search & Navigate (⌘K)"
                    onClick={onOpenPalette}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <span className="toolbar-key">⌘K</span>
                </button>
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
        </>
    )
}
