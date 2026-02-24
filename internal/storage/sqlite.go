package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite database connection.
type DB struct {
	conn    *sql.DB
	dataDir string // root directory for notebook files
}

// New creates a new DB, opening (or creating) the SQLite file at dbPath.
// dataDir is the root directory where markdown files are stored.
func New(dbPath, dataDir string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite only supports one writer — limit to single connection to prevent SQLITE_BUSY
	conn.SetMaxOpenConns(1)

	db := &DB{conn: conn, dataDir: dataDir}
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

// Close closes the database connection.
func (db *DB) Close() error {
	return db.conn.Close()
}

// DataDir returns the root data directory.
func (db *DB) DataDir() string {
	return db.dataDir
}

// Conn returns the underlying database connection.
func (db *DB) Conn() *sql.DB {
	return db.conn
}

func (db *DB) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS notebooks (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT NOT NULL DEFAULT '📓',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS pages (
			id TEXT PRIMARY KEY,
			notebook_id TEXT NOT NULL REFERENCES notebooks(id),
			name TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			viewport_x REAL NOT NULL DEFAULT 0,
			viewport_y REAL NOT NULL DEFAULT 0,
			viewport_zoom REAL NOT NULL DEFAULT 1.0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS blocks (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL REFERENCES pages(id),
			type TEXT NOT NULL DEFAULT 'markdown',
			x REAL NOT NULL DEFAULT 0,
			y REAL NOT NULL DEFAULT 0,
			width REAL NOT NULL DEFAULT 300,
			height REAL NOT NULL DEFAULT 200,
			content TEXT NOT NULL DEFAULT '',
			file_path TEXT NOT NULL DEFAULT '',
			style_json TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS connections (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL REFERENCES pages(id),
			from_block_id TEXT NOT NULL REFERENCES blocks(id),
			to_block_id TEXT NOT NULL REFERENCES blocks(id),
			label TEXT NOT NULL DEFAULT '',
			color TEXT NOT NULL DEFAULT '#666666',
			style TEXT NOT NULL DEFAULT 'solid',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pages_notebook ON pages(notebook_id)`,
		`CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id)`,
		`CREATE INDEX IF NOT EXISTS idx_connections_page ON connections(page_id)`,
		// Add drawing_data column if missing
		`ALTER TABLE pages ADD COLUMN drawing_data TEXT NOT NULL DEFAULT ''`,
		// Undo tree persistence per page (legacy — kept for migration safety)
		`CREATE TABLE IF NOT EXISTS undo_trees (
			page_id TEXT PRIMARY KEY REFERENCES pages(id),
			tree_json TEXT NOT NULL DEFAULT '{}'
		)`,
		// Undo nodes — individual records per undo state
		`CREATE TABLE IF NOT EXISTS undo_nodes (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL REFERENCES pages(id),
			parent_id TEXT,
			label TEXT NOT NULL,
			snapshot_json TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_undo_nodes_page ON undo_nodes(page_id)`,
		// Undo state — current position pointer per page
		`CREATE TABLE IF NOT EXISTS undo_state (
			page_id TEXT PRIMARY KEY REFERENCES pages(id),
			current_node_id TEXT NOT NULL REFERENCES undo_nodes(id)
		)`,
		// Database plugin: external database connections
		`CREATE TABLE IF NOT EXISTS db_connections (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			driver TEXT NOT NULL,
			host TEXT NOT NULL DEFAULT '',
			port INTEGER NOT NULL DEFAULT 0,
			database_name TEXT NOT NULL DEFAULT '',
			username TEXT NOT NULL DEFAULT '',
			ssl_mode TEXT NOT NULL DEFAULT 'disable',
			extra_json TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		// Database plugin: cached query results
		`CREATE TABLE IF NOT EXISTS query_results (
			id TEXT PRIMARY KEY,
			block_id TEXT NOT NULL,
			query TEXT NOT NULL,
			columns_json TEXT NOT NULL DEFAULT '[]',
			rows_json TEXT NOT NULL DEFAULT '[]',
			total_rows INTEGER NOT NULL DEFAULT 0,
			has_more INTEGER NOT NULL DEFAULT 0,
			executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT '',
			is_write INTEGER NOT NULL DEFAULT 0,
			affected_rows INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_query_results_block ON query_results(block_id)`,
		// Local Database plugin: user-created structured tables
		`CREATE TABLE IF NOT EXISTS local_databases (
			id TEXT PRIMARY KEY,
			block_id TEXT NOT NULL,
			name TEXT NOT NULL DEFAULT 'Untitled',
			config_json TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_local_databases_block ON local_databases(block_id)`,
		`CREATE TABLE IF NOT EXISTS local_db_rows (
			id TEXT PRIMARY KEY,
			database_id TEXT NOT NULL REFERENCES local_databases(id),
			data_json TEXT NOT NULL DEFAULT '{}',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_local_db_rows_database ON local_db_rows(database_id)`,
	}

	for _, m := range migrations {
		if _, err := db.conn.Exec(m); err != nil {
			// ALTER TABLE fails if column already exists — safe to ignore
			if strings.Contains(m, "ALTER TABLE") && strings.Contains(err.Error(), "duplicate column") {
				continue
			}
			return fmt.Errorf("migration failed: %s: %w", m[:40], err)
		}
	}

	return nil
}
