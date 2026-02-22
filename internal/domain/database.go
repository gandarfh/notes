package domain

import "time"

// DatabaseDriver represents the type of database engine.
type DatabaseDriver string

const (
	DatabaseDriverMySQL    DatabaseDriver = "mysql"
	DatabaseDriverPostgres DatabaseDriver = "postgres"
	DatabaseDriverMongoDB  DatabaseDriver = "mongodb"
	DatabaseDriverSQLite   DatabaseDriver = "sqlite"
)

// DatabaseConnection holds the metadata for connecting to an external database.
// The password is stored separately in the SecretStore (e.g. macOS Keychain).
type DatabaseConnection struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Driver    DatabaseDriver `json:"driver"`
	Host      string         `json:"host"`     // hostname or file path (sqlite)
	Port      int            `json:"port"`     // 0 for sqlite
	Database  string         `json:"database"` // db name or empty for sqlite
	Username  string         `json:"username"`
	SSLMode   string         `json:"sslMode"`
	ExtraJSON string         `json:"extraJson"` // driver-specific options
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

// DatabaseConnectionStore manages CRUD operations for database connections.
type DatabaseConnectionStore interface {
	CreateConnection(c *DatabaseConnection) error
	GetConnection(id string) (*DatabaseConnection, error)
	ListConnections() ([]DatabaseConnection, error)
	UpdateConnection(c *DatabaseConnection) error
	DeleteConnection(id string) error
}

// QueryResult is the cached result of a query execution for a canvas block.
type QueryResult struct {
	ID           string    `json:"id"`
	BlockID      string    `json:"blockId"`
	Query        string    `json:"query"`
	ColumnsJSON  string    `json:"columnsJson"` // JSON array of column names
	RowsJSON     string    `json:"rowsJson"`    // JSON array of row arrays
	TotalRows    int       `json:"totalRows"`   // total rows fetched so far
	HasMore      bool      `json:"hasMore"`     // cursor has more rows?
	ExecutedAt   time.Time `json:"executedAt"`
	DurationMs   int       `json:"durationMs"`
	Error        string    `json:"error"`
	IsWrite      bool      `json:"isWrite"`
	AffectedRows int       `json:"affectedRows"`
}

// QueryResultStore manages cached query results.
type QueryResultStore interface {
	UpsertResult(r *QueryResult) error
	GetResultByBlock(blockID string) (*QueryResult, error)
	DeleteResultsByBlock(blockID string) error
}
