// ── View Switcher ──────────────────────────────────────────
// Compact tab bar for switching between database views.

export type ViewType = 'table' | 'kanban' | 'calendar'

interface ViewSwitcherProps {
    activeView: ViewType
    onViewChange: (view: ViewType) => void
}

const VIEWS: { id: ViewType; label: string; icon: string }[] = [
    { id: 'table', label: 'Table', icon: '⊞' },
    { id: 'kanban', label: 'Kanban', icon: '▦' },
    { id: 'calendar', label: 'Calendar', icon: '📅' },
]

export function ViewSwitcher({ activeView, onViewChange }: ViewSwitcherProps) {
    return (
        <div className="ldb-view-switcher">
            {VIEWS.map(v => (
                <button
                    key={v.id}
                    className={`ldb-view-tab ${activeView === v.id ? 'active' : ''}`}
                    onClick={() => onViewChange(v.id)}
                    title={v.label}
                >
                    <span className="ldb-view-tab-icon">{v.icon}</span>
                    <span className="ldb-view-tab-label">{v.label}</span>
                </button>
            ))}
        </div>
    )
}
