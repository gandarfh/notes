package storage

import (
	"fmt"
	"time"

	"notes/internal/domain"
)

// ConnectionStore implements domain.ConnectionStore using SQLite.
type ConnectionStore struct {
	db *DB
}

func NewConnectionStore(db *DB) *ConnectionStore {
	return &ConnectionStore{db: db}
}

func (s *ConnectionStore) CreateConnection(c *domain.Connection) error {
	now := time.Now()
	c.CreatedAt = now
	c.UpdatedAt = now
	_, err := s.db.conn.Exec(
		`INSERT INTO connections (id, page_id, from_block_id, to_block_id, label, color, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.PageID, c.FromBlockID, c.ToBlockID, c.Label, c.Color, c.Style, c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (s *ConnectionStore) GetConnection(id string) (*domain.Connection, error) {
	c := &domain.Connection{}
	err := s.db.conn.QueryRow(
		`SELECT id, page_id, from_block_id, to_block_id, label, color, style, created_at, updated_at FROM connections WHERE id = ?`, id,
	).Scan(&c.ID, &c.PageID, &c.FromBlockID, &c.ToBlockID, &c.Label, &c.Color, &c.Style, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get connection: %w", err)
	}
	return c, nil
}

func (s *ConnectionStore) ListConnections(pageID string) ([]domain.Connection, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, page_id, from_block_id, to_block_id, label, color, style, created_at, updated_at FROM connections WHERE page_id = ? ORDER BY created_at ASC`,
		pageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []domain.Connection
	for rows.Next() {
		var c domain.Connection
		if err := rows.Scan(&c.ID, &c.PageID, &c.FromBlockID, &c.ToBlockID, &c.Label, &c.Color, &c.Style, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		conns = append(conns, c)
	}
	return conns, rows.Err()
}

func (s *ConnectionStore) UpdateConnection(c *domain.Connection) error {
	c.UpdatedAt = time.Now()
	_, err := s.db.conn.Exec(
		`UPDATE connections SET from_block_id = ?, to_block_id = ?, label = ?, color = ?, style = ?, updated_at = ? WHERE id = ?`,
		c.FromBlockID, c.ToBlockID, c.Label, c.Color, c.Style, c.UpdatedAt, c.ID,
	)
	return err
}

func (s *ConnectionStore) DeleteConnection(id string) error {
	_, err := s.db.conn.Exec(`DELETE FROM connections WHERE id = ?`, id)
	return err
}

func (s *ConnectionStore) DeleteConnectionsByPage(pageID string) error {
	_, err := s.db.conn.Exec(`DELETE FROM connections WHERE page_id = ?`, pageID)
	return err
}

func (s *ConnectionStore) DeleteConnectionsByBlock(blockID string) error {
	_, err := s.db.conn.Exec(
		`DELETE FROM connections WHERE from_block_id = ? OR to_block_id = ?`,
		blockID, blockID,
	)
	return err
}
