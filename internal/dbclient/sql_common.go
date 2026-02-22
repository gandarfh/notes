package dbclient

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"
)

// sqlConnector is the shared implementation for MySQL, Postgres, and SQLite.
type sqlConnector struct {
	driverName string
	db         *sql.DB

	mu         sync.Mutex
	activeRows *sql.Rows
	lastAccess time.Time
	columns    []string
	fetched    int
	lastTable  string   // table name from the last read query
	lastPKs    []string // PKs detected before cursor open
}

// newSQLConnector creates a generic SQL connector.
func newSQLConnector(driverName, dsn string) (*sqlConnector, error) {
	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", driverName, err)
	}
	// Sensible pool settings for a desktop app
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(10 * time.Minute)

	return &sqlConnector{driverName: driverName, db: db}, nil
}

func (c *sqlConnector) TestConnection(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.db.PingContext(ctx)
}

// isReadQuery detects if a query is a read (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN, PRAGMA).
func isReadQuery(query string) bool {
	q := strings.TrimSpace(query)
	q = strings.ToUpper(q)
	for _, prefix := range []string{"SELECT", "WITH", "SHOW", "DESCRIBE", "EXPLAIN", "PRAGMA"} {
		if strings.HasPrefix(q, prefix) {
			return true
		}
	}
	return false
}

func (c *sqlConnector) Execute(ctx context.Context, query string, fetchSize int) (*QueryPage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Close any previously open cursor
	c.closeCursorLocked()

	if fetchSize <= 0 {
		fetchSize = 50
	}

	if !isReadQuery(query) {
		return c.execWrite(ctx, query)
	}
	c.lastTable = extractTableName(query)
	// Detect PKs BEFORE opening the cursor (avoids SQLite connection contention)
	c.lastPKs = c.detectPrimaryKeys(c.lastTable)
	return c.execRead(ctx, query, fetchSize)
}

func (c *sqlConnector) execWrite(ctx context.Context, query string) (*QueryPage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result, err := c.db.ExecContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("exec: %w", err)
	}
	affected, _ := result.RowsAffected()
	return &QueryPage{
		IsWrite:      true,
		AffectedRows: int(affected),
	}, nil
}

func (c *sqlConnector) execRead(ctx context.Context, query string, fetchSize int) (*QueryPage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := c.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}

	cols, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, fmt.Errorf("columns: %w", err)
	}

	c.activeRows = rows
	c.columns = cols
	c.fetched = 0
	c.lastAccess = time.Now()

	return c.fetchBatchLocked(fetchSize)
}

func (c *sqlConnector) FetchMore(ctx context.Context, fetchSize int) (*QueryPage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.activeRows == nil {
		return nil, fmt.Errorf("no active cursor — execute a query first")
	}
	if fetchSize <= 0 {
		fetchSize = 50
	}
	c.lastAccess = time.Now()
	return c.fetchBatchLocked(fetchSize)
}

// fetchBatchLocked reads up to fetchSize rows from the active cursor.
// Must be called while holding c.mu.
func (c *sqlConnector) fetchBatchLocked(fetchSize int) (*QueryPage, error) {
	var resultRows [][]any
	numCols := len(c.columns)

	for i := 0; i < fetchSize; i++ {
		if !c.activeRows.Next() {
			break
		}
		// Create scan targets
		values := make([]any, numCols)
		ptrs := make([]any, numCols)
		for j := range values {
			ptrs[j] = &values[j]
		}
		if err := c.activeRows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}

		// Convert values to strings for JSON serialization
		row := make([]any, numCols)
		for j, v := range values {
			row[j] = formatValue(v)
		}
		resultRows = append(resultRows, row)
	}

	c.fetched += len(resultRows)

	// Check if there are more rows
	hasMore := true
	if len(resultRows) < fetchSize {
		hasMore = false
		c.closeCursorLocked()
	}

	// Check for iteration errors
	if c.activeRows != nil {
		if err := c.activeRows.Err(); err != nil {
			c.closeCursorLocked()
			return nil, fmt.Errorf("iterate: %w", err)
		}
	}

	return &QueryPage{
		Columns:      c.columns,
		Rows:         resultRows,
		TotalFetched: c.fetched,
		HasMore:      hasMore,
		PrimaryKeys:  c.lastPKs,
	}, nil
}

// extractTableName extracts the table name from a SELECT query (best-effort).
func extractTableName(query string) string {
	q := strings.TrimSpace(query)
	upper := strings.ToUpper(q)
	idx := strings.Index(upper, "FROM ")
	if idx == -1 {
		return ""
	}
	rest := strings.TrimSpace(q[idx+5:])
	// Take first word (table name)
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return ""
	}
	// Remove quotes/backticks
	name := strings.Trim(fields[0], "`\"'")
	return name
}

// detectPrimaryKeys returns the primary key columns for a table.
// Called outside cursor lock to avoid SQLite connection contention.
func (c *sqlConnector) detectPrimaryKeys(table string) []string {
	if table == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch c.driverName {
	case "sqlite":
		return c.getSQLitePKs(ctx, table)
	default:
		return c.getInfoSchemaPKs(ctx, table)
	}
}

func (c *sqlConnector) getSQLitePKs(ctx context.Context, table string) []string {
	rows, err := c.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info('%s')", table))
	if err != nil {
		return []string{"rowid"}
	}
	defer rows.Close()

	var pks []string
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dfltValue sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			continue
		}
		if pk > 0 {
			pks = append(pks, name)
		}
	}
	if len(pks) == 0 {
		return []string{"rowid"}
	}
	return pks
}

func (c *sqlConnector) getInfoSchemaPKs(ctx context.Context, table string) []string {
	rows, err := c.db.QueryContext(ctx,
		`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
		 WHERE TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
		 ORDER BY ORDINAL_POSITION`, table)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var pks []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		pks = append(pks, name)
	}
	return pks
}

// formatValue converts a database value to a displayable string.
func formatValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case []byte:
		return string(val)
	case time.Time:
		return val.Format(time.RFC3339)
	default:
		return val
	}
}

func (c *sqlConnector) Introspect(ctx context.Context) (*SchemaInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	switch c.driverName {
	case "sqlite":
		return c.introspectSQLite(ctx)
	default:
		return c.introspectInfoSchema(ctx)
	}
}

// introspectInfoSchema works for MySQL and Postgres via INFORMATION_SCHEMA.
func (c *sqlConnector) introspectInfoSchema(ctx context.Context) (*SchemaInfo, error) {
	// Get tables
	rows, err := c.db.QueryContext(ctx,
		`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = DATABASE() OR TABLE_SCHEMA = CURRENT_SCHEMA()
		 ORDER BY TABLE_NAME`)
	if err != nil {
		// Fallback: try without schema filter
		rows, err = c.db.QueryContext(ctx,
			`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME`)
		if err != nil {
			return nil, fmt.Errorf("list tables: %w", err)
		}
	}
	defer rows.Close()

	var tableNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		tableNames = append(tableNames, name)
	}

	schema := &SchemaInfo{}
	for _, tbl := range tableNames {
		colRows, err := c.db.QueryContext(ctx,
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, tbl)
		if err != nil {
			schema.Tables = append(schema.Tables, TableInfo{Name: tbl})
			continue
		}

		var cols []ColumnInfo
		for colRows.Next() {
			var ci ColumnInfo
			if err := colRows.Scan(&ci.Name, &ci.Type); err != nil {
				continue
			}
			cols = append(cols, ci)
		}
		colRows.Close()

		schema.Tables = append(schema.Tables, TableInfo{Name: tbl, Columns: cols})
	}

	return schema, nil
}

// introspectSQLite uses sqlite_master + PRAGMA table_info.
func (c *sqlConnector) introspectSQLite(ctx context.Context) (*SchemaInfo, error) {
	rows, err := c.db.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list tables: %w", err)
	}
	defer rows.Close()

	var tableNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		tableNames = append(tableNames, name)
	}

	schema := &SchemaInfo{}
	for _, tbl := range tableNames {
		pragmaRows, err := c.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info('%s')", tbl))
		if err != nil {
			schema.Tables = append(schema.Tables, TableInfo{Name: tbl})
			continue
		}

		var cols []ColumnInfo
		for pragmaRows.Next() {
			var cid int
			var name, colType string
			var notNull, pk int
			var dfltValue sql.NullString
			if err := pragmaRows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
				continue
			}
			cols = append(cols, ColumnInfo{Name: name, Type: colType})
		}
		pragmaRows.Close()

		schema.Tables = append(schema.Tables, TableInfo{Name: tbl, Columns: cols})
	}

	return schema, nil
}

func (c *sqlConnector) ApplyMutations(ctx context.Context, table string, mutations []Mutation) (*MutationResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	result := &MutationResult{}
	for _, m := range mutations {
		var execErr error
		switch m.Type {
		case "update":
			execErr = c.applyUpdate(ctx, tx, table, m)
		case "delete":
			execErr = c.applyDelete(ctx, tx, table, m)
		default:
			execErr = fmt.Errorf("unknown mutation type: %s", m.Type)
		}
		if execErr != nil {
			result.Errors = append(result.Errors, execErr.Error())
		} else {
			result.Applied++
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return result, nil
}

func (c *sqlConnector) applyUpdate(ctx context.Context, tx *sql.Tx, table string, m Mutation) error {
	if len(m.Changes) == 0 {
		return nil
	}
	setClauses := make([]string, 0, len(m.Changes))
	args := make([]any, 0, len(m.Changes)+len(m.RowKey))
	for col, val := range m.Changes {
		setClauses = append(setClauses, fmt.Sprintf("%s = ?", col))
		args = append(args, val)
	}
	whereClauses := make([]string, 0, len(m.RowKey))
	for col, val := range m.RowKey {
		whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", col))
		args = append(args, val)
	}
	query := fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		table, strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND "))
	_, err := tx.ExecContext(ctx, query, args...)
	return err
}

func (c *sqlConnector) applyDelete(ctx context.Context, tx *sql.Tx, table string, m Mutation) error {
	whereClauses := make([]string, 0, len(m.RowKey))
	args := make([]any, 0, len(m.RowKey))
	for col, val := range m.RowKey {
		whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", col))
		args = append(args, val)
	}
	query := fmt.Sprintf("DELETE FROM %s WHERE %s", table, strings.Join(whereClauses, " AND "))
	_, err := tx.ExecContext(ctx, query, args...)
	return err
}

func (c *sqlConnector) Close() error {
	c.mu.Lock()
	c.closeCursorLocked()
	c.mu.Unlock()
	return c.db.Close()
}

func (c *sqlConnector) closeCursorLocked() {
	if c.activeRows != nil {
		c.activeRows.Close()
		c.activeRows = nil
	}
}
