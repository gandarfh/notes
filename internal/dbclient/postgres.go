package dbclient

import (
	"encoding/json"
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
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		conn.Host, port, conn.Username, password, conn.Database, sslMode,
	)

	// Append certificate paths from ExtraJSON if present.
	if conn.ExtraJSON != "" && conn.ExtraJSON != "{}" {
		var extras map[string]string
		if json.Unmarshal([]byte(conn.ExtraJSON), &extras) == nil {
			if v := extras["sslRootCert"]; v != "" {
				dsn += fmt.Sprintf(" sslrootcert=%s", v)
			}
			if v := extras["sslCert"]; v != "" {
				dsn += fmt.Sprintf(" sslcert=%s", v)
			}
			if v := extras["sslKey"]; v != "" {
				dsn += fmt.Sprintf(" sslkey=%s", v)
			}
		}
	}

	return dsn
}
