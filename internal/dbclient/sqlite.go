package dbclient

import (
	"notes/internal/domain"

	_ "modernc.org/sqlite"
)

// newSQLiteConnector creates a connector for an external SQLite file.
// Opens in WAL mode with busy timeout for concurrent access.
func newSQLiteConnector(conn *domain.DatabaseConnection) (*sqlConnector, error) {
	dsn := conn.Host + "?_journal_mode=WAL&_busy_timeout=5000"
	return newSQLConnector("sqlite", dsn)
}
