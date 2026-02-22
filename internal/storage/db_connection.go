package storage

import (
	"database/sql"
	"fmt"
	"time"

	"notes/internal/domain"
)

// DBConnectionStore manages database connection records in SQLite.
type DBConnectionStore struct {
	db *DB
}

// NewDBConnectionStore creates a new DBConnectionStore.
func NewDBConnectionStore(db *DB) *DBConnectionStore {
	return &DBConnectionStore{db: db}
}

func (s *DBConnectionStore) CreateConnection(c *domain.DatabaseConnection) error {
	now := time.Now()
	c.CreatedAt = now
	c.UpdatedAt = now

	_, err := s.db.Conn().Exec(
		`INSERT INTO db_connections (id, name, driver, host, port, database_name, username, ssl_mode, extra_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.Driver, c.Host, c.Port, c.Database, c.Username, c.SSLMode, c.ExtraJSON, c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (s *DBConnectionStore) GetConnection(id string) (*domain.DatabaseConnection, error) {
	row := s.db.Conn().QueryRow(
		`SELECT id, name, driver, host, port, database_name, username, ssl_mode, extra_json, created_at, updated_at
		 FROM db_connections WHERE id = ?`, id,
	)

	c := &domain.DatabaseConnection{}
	err := row.Scan(&c.ID, &c.Name, &c.Driver, &c.Host, &c.Port, &c.Database, &c.Username, &c.SSLMode, &c.ExtraJSON, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("database connection not found: %s", id)
	}
	return c, err
}

func (s *DBConnectionStore) ListConnections() ([]domain.DatabaseConnection, error) {
	rows, err := s.db.Conn().Query(
		`SELECT id, name, driver, host, port, database_name, username, ssl_mode, extra_json, created_at, updated_at
		 FROM db_connections ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []domain.DatabaseConnection
	for rows.Next() {
		var c domain.DatabaseConnection
		if err := rows.Scan(&c.ID, &c.Name, &c.Driver, &c.Host, &c.Port, &c.Database, &c.Username, &c.SSLMode, &c.ExtraJSON, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		conns = append(conns, c)
	}
	return conns, rows.Err()
}

func (s *DBConnectionStore) UpdateConnection(c *domain.DatabaseConnection) error {
	c.UpdatedAt = time.Now()
	_, err := s.db.Conn().Exec(
		`UPDATE db_connections SET name=?, driver=?, host=?, port=?, database_name=?, username=?, ssl_mode=?, extra_json=?, updated_at=?
		 WHERE id=?`,
		c.Name, c.Driver, c.Host, c.Port, c.Database, c.Username, c.SSLMode, c.ExtraJSON, c.UpdatedAt, c.ID,
	)
	return err
}

func (s *DBConnectionStore) DeleteConnection(id string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM db_connections WHERE id = ?`, id)
	return err
}
