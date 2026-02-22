package dbclient

import (
	"context"
	"fmt"

	"notes/internal/domain"
)

// QueryPage is a batch of rows fetched from a query cursor.
type QueryPage struct {
	Columns      []string `json:"columns"`
	Rows         [][]any  `json:"rows"`
	TotalFetched int      `json:"totalFetched"` // total rows fetched so far
	HasMore      bool     `json:"hasMore"`      // cursor has more rows
	IsWrite      bool     `json:"isWrite"`
	AffectedRows int      `json:"affectedRows"`
	PrimaryKeys  []string `json:"primaryKeys,omitempty"` // PK columns for edit/delete
}

// SchemaInfo contains the database schema for autocomplete.
type SchemaInfo struct {
	Tables []TableInfo `json:"tables"`
}

// TableInfo describes a table/collection.
type TableInfo struct {
	Name    string       `json:"name"`
	Columns []ColumnInfo `json:"columns"`
}

// ColumnInfo describes a column/field.
type ColumnInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Mutation describes a single row-level change (update or delete).
type Mutation struct {
	Type    string         `json:"type"`    // "update" | "delete"
	RowKey  map[string]any `json:"rowKey"`  // PK column → value
	Changes map[string]any `json:"changes"` // column → new value (update only)
}

// MutationResult summarizes the outcome of a batch of mutations.
type MutationResult struct {
	Applied int      `json:"applied"`
	Errors  []string `json:"errors,omitempty"`
}

// Connector abstracts interaction with an external database.
type Connector interface {
	// TestConnection verifies connectivity.
	TestConnection(ctx context.Context) error

	// Execute runs a query and returns the first batch of rows.
	// For reads: opens a cursor and fetches fetchSize rows.
	// For writes: executes and returns affected rows count.
	Execute(ctx context.Context, query string, fetchSize int) (*QueryPage, error)

	// FetchMore continues reading from the open cursor.
	FetchMore(ctx context.Context, fetchSize int) (*QueryPage, error)

	// Introspect returns the database schema for autocomplete.
	Introspect(ctx context.Context) (*SchemaInfo, error)

	// ApplyMutations executes a batch of row-level updates/deletes.
	ApplyMutations(ctx context.Context, table string, mutations []Mutation) (*MutationResult, error)

	// Close closes the connection and any open cursors.
	Close() error
}

// NewConnector creates a Connector for the given database connection.
// The password must be provided separately (from SecretStore).
func NewConnector(conn *domain.DatabaseConnection, password string) (Connector, error) {
	switch conn.Driver {
	case domain.DatabaseDriverSQLite:
		return newSQLiteConnector(conn)
	case domain.DatabaseDriverMySQL:
		return newSQLConnector("mysql", buildMySQLDSN(conn, password))
	case domain.DatabaseDriverPostgres:
		return newSQLConnector("postgres", buildPostgresDSN(conn, password))
	case domain.DatabaseDriverMongoDB:
		return newMongoConnector(conn, password)
	default:
		return nil, fmt.Errorf("unsupported driver: %s", conn.Driver)
	}
}
