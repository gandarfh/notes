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

	conn, err := sql.Open("sqlite", dbPath+"?_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite only supports one writer — limit to single connection to prevent SQLITE_BUSY
	conn.SetMaxOpenConns(1)

	// Enable WAL mode for cross-process read/write (MCP standalone ↔ Wails app)
	if _, err := conn.Exec("PRAGMA journal_mode=WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable WAL mode: %w", err)
	}

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
		// ETL sync jobs
		`CREATE TABLE IF NOT EXISTS etl_jobs (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			source_type TEXT NOT NULL,
			source_config TEXT NOT NULL DEFAULT '{}',
			transforms TEXT NOT NULL DEFAULT '[]',
			target_db_id TEXT NOT NULL,
			sync_mode TEXT NOT NULL DEFAULT 'replace',
			dedupe_key TEXT NOT NULL DEFAULT '',
			trigger_type TEXT NOT NULL DEFAULT 'manual',
			trigger_config TEXT NOT NULL DEFAULT '',
			enabled INTEGER NOT NULL DEFAULT 1,
			last_run_at DATETIME NOT NULL DEFAULT '0001-01-01 00:00:00',
			last_status TEXT NOT NULL DEFAULT '',
			last_error TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS etl_run_logs (
			id TEXT PRIMARY KEY,
			job_id TEXT NOT NULL REFERENCES etl_jobs(id),
			started_at DATETIME NOT NULL,
			finished_at DATETIME NOT NULL,
			status TEXT NOT NULL,
			rows_read INTEGER NOT NULL DEFAULT 0,
			rows_written INTEGER NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_etl_run_logs_job ON etl_run_logs(job_id)`,
		// MCP cross-process approval queue (standalone ↔ Wails IPC)
		`CREATE TABLE IF NOT EXISTS mcp_approvals (
			id TEXT PRIMARY KEY,
			tool TEXT NOT NULL,
			description TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			metadata TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			resolved_at DATETIME
		)`,
		// Board page columns
		`ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'canvas'`,
		`ALTER TABLE pages ADD COLUMN board_content TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE pages ADD COLUMN board_layout TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE pages ADD COLUMN board_mode TEXT NOT NULL DEFAULT 'document'`,
		// Add metadata column if missing (migration safety)
		`ALTER TABLE mcp_approvals ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'`,
		// MCP cross-process signals (standalone → Wails IPC)
		`CREATE TABLE IF NOT EXISTS mcp_signals (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		// Unified canvas entities table (blocks + drawing elements)
		`CREATE TABLE IF NOT EXISTS canvas_entities (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL REFERENCES pages(id),
			type TEXT NOT NULL,
			render_mode TEXT NOT NULL DEFAULT 'canvas',
			z_index INTEGER NOT NULL DEFAULT 0,
			x REAL NOT NULL DEFAULT 0,
			y REAL NOT NULL DEFAULT 0,
			width REAL NOT NULL DEFAULT 0,
			height REAL NOT NULL DEFAULT 0,
			content TEXT NOT NULL DEFAULT '',
			file_path TEXT NOT NULL DEFAULT '',
			canvas_props TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_canvas_entities_page ON canvas_entities(page_id)`,
		// Unified canvas connections (replaces connections table for cross-type arrows)
		`CREATE TABLE IF NOT EXISTS canvas_connections (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL REFERENCES pages(id),
			from_entity_id TEXT NOT NULL,
			to_entity_id TEXT NOT NULL,
			from_side TEXT NOT NULL DEFAULT '',
			from_t REAL NOT NULL DEFAULT 0.5,
			to_side TEXT NOT NULL DEFAULT '',
			to_t REAL NOT NULL DEFAULT 0.5,
			label TEXT NOT NULL DEFAULT '',
			color TEXT NOT NULL DEFAULT '#666666',
			style TEXT NOT NULL DEFAULT 'solid',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_canvas_connections_page ON canvas_connections(page_id)`,
		// Block view mode isolation (document vs dashboard)
		`ALTER TABLE blocks ADD COLUMN view_mode TEXT NOT NULL DEFAULT 'dashboard'`,
		// Meeting Capture
		`CREATE TABLE IF NOT EXISTS meetings (
			id TEXT PRIMARY KEY,
			page_id TEXT,
			notebook_id TEXT,
			title TEXT NOT NULL,
			date DATETIME NOT NULL,
			duration TEXT,
			participants_json TEXT DEFAULT '[]',
			audio_path TEXT,
			transcript_json TEXT,
			analysis_json TEXT,
			refinement_chat_json TEXT DEFAULT '[]',
			status TEXT NOT NULL DEFAULT 'recording',
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date)`,
		`CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status)`,
		`CREATE INDEX IF NOT EXISTS idx_meetings_page ON meetings(page_id)`,
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
