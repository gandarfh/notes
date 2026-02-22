package dbclient

import (
	"fmt"

	"notes/internal/domain"

	_ "github.com/go-sql-driver/mysql"
)

// buildMySQLDSN constructs a MySQL DSN from a DatabaseConnection.
func buildMySQLDSN(conn *domain.DatabaseConnection, password string) string {
	port := conn.Port
	if port == 0 {
		port = 3306
	}
	// Format: user:password@tcp(host:port)/dbname?parseTime=true
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4",
		conn.Username, password, conn.Host, port, conn.Database,
	)
	if conn.SSLMode == "require" {
		dsn += "&tls=true"
	}
	return dsn
}
