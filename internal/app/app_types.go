package app

// DBConnView is the frontend-safe view of a database connection (no password).
type DBConnView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	SSLMode  string `json:"sslMode"`
}

// CreateDBConnInput is the input for creating/updating a database connection.
type CreateDBConnInput struct {
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"sslMode"`
}

// QueryResultView is the frontend view of a query result.
type QueryResultView struct {
	Columns      []string `json:"columns"`
	Rows         [][]any  `json:"rows"`
	TotalRows    int      `json:"totalRows"`
	HasMore      bool     `json:"hasMore"`
	DurationMs   int      `json:"durationMs"`
	Error        string   `json:"error"`
	IsWrite      bool     `json:"isWrite"`
	AffectedRows int      `json:"affectedRows"`
	Query        string   `json:"query"`
	PrimaryKeys  []string `json:"primaryKeys,omitempty"`
}
