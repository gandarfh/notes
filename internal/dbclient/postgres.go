package dbclient

import (
	"fmt"

	"notes/internal/domain"

	_ "github.com/lib/pq"
)

// buildPostgresDSN constructs a Postgres connection string from a DatabaseConnection.
func buildPostgresDSN(conn *domain.DatabaseConnection, password string) string {
	port := conn.Port
	if port == 0 {
		port = 5432
	}
	sslMode := conn.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		conn.Host, port, conn.Username, password, conn.Database, sslMode,
	)
}
