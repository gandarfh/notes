package storage

import (
	"database/sql"
	"fmt"
	"time"

	"notes/internal/domain"
)

// LocalDatabaseStore implements domain.LocalDatabaseStore using SQLite.
type LocalDatabaseStore struct {
	db *DB
}

// NewLocalDatabaseStore creates a new LocalDatabaseStore.
func NewLocalDatabaseStore(db *DB) *LocalDatabaseStore {
	return &LocalDatabaseStore{db: db}
}

// ── Database CRUD ──────────────────────────────────────────

func (s *LocalDatabaseStore) CreateDatabase(d *domain.LocalDatabase) error {
	now := time.Now()
	d.CreatedAt = now
	d.UpdatedAt = now
	_, err := s.db.conn.Exec(
		`INSERT INTO local_databases (id, block_id, name, config_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		d.ID, d.BlockID, d.Name, d.ConfigJSON, d.CreatedAt, d.UpdatedAt,
	)
	return err
}

func (s *LocalDatabaseStore) GetDatabase(id string) (*domain.LocalDatabase, error) {
	d := &domain.LocalDatabase{}
	err := s.db.conn.QueryRow(
		`SELECT id, block_id, name, config_json, created_at, updated_at
		 FROM local_databases WHERE id = ?`, id,
	).Scan(&d.ID, &d.BlockID, &d.Name, &d.ConfigJSON, &d.CreatedAt, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("local database not found: %s", id)
	}
	return d, err
}

func (s *LocalDatabaseStore) GetDatabaseByBlock(blockID string) (*domain.LocalDatabase, error) {
	d := &domain.LocalDatabase{}
	err := s.db.conn.QueryRow(
		`SELECT id, block_id, name, config_json, created_at, updated_at
		 FROM local_databases WHERE block_id = ?`, blockID,
	).Scan(&d.ID, &d.BlockID, &d.Name, &d.ConfigJSON, &d.CreatedAt, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("local database not found for block: %s", blockID)
	}
	return d, err
}

func (s *LocalDatabaseStore) UpdateDatabase(d *domain.LocalDatabase) error {
	d.UpdatedAt = time.Now()
	_, err := s.db.conn.Exec(
		`UPDATE local_databases SET name = ?, config_json = ?, updated_at = ?
		 WHERE id = ?`,
		d.Name, d.ConfigJSON, d.UpdatedAt, d.ID,
	)
	return err
}

func (s *LocalDatabaseStore) DeleteDatabase(id string) error {
	// Delete all rows first, then the database
	if _, err := s.db.conn.Exec(`DELETE FROM local_db_rows WHERE database_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.conn.Exec(`DELETE FROM local_databases WHERE id = ?`, id)
	return err
}

// ── Row CRUD ───────────────────────────────────────────────

func (s *LocalDatabaseStore) CreateRow(r *domain.LocalDBRow) error {
	now := time.Now()
	r.CreatedAt = now
	r.UpdatedAt = now

	// Auto-assign sort_order to end
	if r.SortOrder == 0 {
		var maxOrder sql.NullInt64
		s.db.conn.QueryRow(
			`SELECT MAX(sort_order) FROM local_db_rows WHERE database_id = ?`, r.DatabaseID,
		).Scan(&maxOrder)
		if maxOrder.Valid {
			r.SortOrder = int(maxOrder.Int64) + 1
		} else {
			r.SortOrder = 1
		}
	}

	_, err := s.db.conn.Exec(
		`INSERT INTO local_db_rows (id, database_id, data_json, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		r.ID, r.DatabaseID, r.DataJSON, r.SortOrder, r.CreatedAt, r.UpdatedAt,
	)
	return err
}

func (s *LocalDatabaseStore) GetRow(id string) (*domain.LocalDBRow, error) {
	r := &domain.LocalDBRow{}
	err := s.db.conn.QueryRow(
		`SELECT id, database_id, data_json, sort_order, created_at, updated_at
		 FROM local_db_rows WHERE id = ?`, id,
	).Scan(&r.ID, &r.DatabaseID, &r.DataJSON, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("row not found: %s", id)
	}
	return r, err
}

func (s *LocalDatabaseStore) ListRows(databaseID string) ([]domain.LocalDBRow, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, database_id, data_json, sort_order, created_at, updated_at
		 FROM local_db_rows WHERE database_id = ? ORDER BY sort_order ASC`, databaseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []domain.LocalDBRow
	for rows.Next() {
		r := domain.LocalDBRow{}
		if err := rows.Scan(&r.ID, &r.DatabaseID, &r.DataJSON, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

func (s *LocalDatabaseStore) UpdateRow(r *domain.LocalDBRow) error {
	r.UpdatedAt = time.Now()
	_, err := s.db.conn.Exec(
		`UPDATE local_db_rows SET data_json = ?, sort_order = ?, updated_at = ?
		 WHERE id = ?`,
		r.DataJSON, r.SortOrder, r.UpdatedAt, r.ID,
	)
	return err
}

func (s *LocalDatabaseStore) DeleteRow(id string) error {
	_, err := s.db.conn.Exec(`DELETE FROM local_db_rows WHERE id = ?`, id)
	return err
}

func (s *LocalDatabaseStore) DeleteRowsByDatabase(databaseID string) error {
	_, err := s.db.conn.Exec(`DELETE FROM local_db_rows WHERE database_id = ?`, databaseID)
	return err
}

func (s *LocalDatabaseStore) ReorderRows(databaseID string, rowIDs []string) error {
	tx, err := s.db.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE local_db_rows SET sort_order = ? WHERE id = ? AND database_id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, id := range rowIDs {
		if _, err := stmt.Exec(i+1, id, databaseID); err != nil {
			return fmt.Errorf("reorder row %s: %w", id, err)
		}
	}

	return tx.Commit()
}

// ListDatabases returns all local databases (used by chart/ETL blocks to pick a source).
func (s *LocalDatabaseStore) ListDatabases() ([]domain.LocalDatabase, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, block_id, name, config_json, created_at, updated_at
		 FROM local_databases ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []domain.LocalDatabase
	for rows.Next() {
		d := domain.LocalDatabase{}
		if err := rows.Scan(&d.ID, &d.BlockID, &d.Name, &d.ConfigJSON, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

// GetDatabaseStats returns row count and last update time for a database.
func (s *LocalDatabaseStore) GetDatabaseStats(databaseID string) (int, time.Time, error) {
	var count int
	var lastUpdated sql.NullTime

	err := s.db.conn.QueryRow(
		`SELECT COUNT(*), MAX(updated_at) FROM local_db_rows WHERE database_id = ?`, databaseID,
	).Scan(&count, &lastUpdated)
	if err != nil {
		return 0, time.Time{}, err
	}

	t := time.Time{}
	if lastUpdated.Valid {
		t = lastUpdated.Time
	}
	return count, t, nil
}

// Ensure we satisfy the compile-time check (not the interface directly since we add extra methods).
var _ interface {
	CreateDatabase(*domain.LocalDatabase) error
	GetDatabase(string) (*domain.LocalDatabase, error)
	GetDatabaseByBlock(string) (*domain.LocalDatabase, error)
	UpdateDatabase(*domain.LocalDatabase) error
	DeleteDatabase(string) error
	CreateRow(*domain.LocalDBRow) error
	GetRow(string) (*domain.LocalDBRow, error)
	ListRows(string) ([]domain.LocalDBRow, error)
	UpdateRow(*domain.LocalDBRow) error
	DeleteRow(string) error
	DeleteRowsByDatabase(string) error
	ReorderRows(string, []string) error
} = (*LocalDatabaseStore)(nil)
