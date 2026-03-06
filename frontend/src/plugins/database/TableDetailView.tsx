import type { TableInfo } from './types'

interface TableDetailViewProps {
    table: TableInfo
    onBack: () => void
    onQueryTable: (query: string) => void
}

export function TableDetailView({ table, onBack, onQueryTable }: TableDetailViewProps) {
    const handleQuery = () => {
        onQueryTable(`SELECT * FROM ${table.name} LIMIT 100`)
    }

    return (
        <div className="db-table-detail">
            <div className="db-table-detail-header">
                <button className="db-table-detail-back" onClick={onBack}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                </button>
                <span className="db-table-detail-name">{table.name}</span>
            </div>

            <div className="db-table-detail-columns">
                <table className="db-table-detail-table">
                    <thead>
                        <tr>
                            <th>Column</th>
                            <th>Type</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(table.columns ?? []).map(col => (
                            <tr key={col.name}>
                                <td className="db-col-name">{col.name}</td>
                                <td><span className="db-col-type">{col.type}</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="db-table-detail-actions">
                <button className="db-query-table-btn" onClick={handleQuery}>
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <path d="M3 1.5l9 5.5-9 5.5V1.5z" fill="currentColor" />
                    </svg>
                    SELECT * FROM {table.name}
                </button>
            </div>
        </div>
    )
}
