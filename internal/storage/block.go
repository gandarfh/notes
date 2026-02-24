package storage

import (
	"fmt"
	"time"

	"notes/internal/domain"
)

// BlockStore implements domain.BlockStore using SQLite.
type BlockStore struct {
	db *DB
}

func NewBlockStore(db *DB) *BlockStore {
	return &BlockStore{db: db}
}

func (s *BlockStore) CreateBlock(b *domain.Block) error {
	now := time.Now()
	b.CreatedAt = now
	b.UpdatedAt = now
	_, err := s.db.Conn().Exec(
		`INSERT INTO blocks (id, page_id, type, x, y, width, height, content, file_path, style_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.PageID, b.Type, b.X, b.Y, b.Width, b.Height, b.Content, b.FilePath, b.StyleJSON, b.CreatedAt, b.UpdatedAt,
	)
	return err
}

func (s *BlockStore) GetBlock(id string) (*domain.Block, error) {
	b := &domain.Block{}
	err := s.db.Conn().QueryRow(
		`SELECT id, page_id, type, x, y, width, height, content, file_path, style_json, created_at, updated_at FROM blocks WHERE id = ?`, id,
	).Scan(&b.ID, &b.PageID, &b.Type, &b.X, &b.Y, &b.Width, &b.Height, &b.Content, &b.FilePath, &b.StyleJSON, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get block: %w", err)
	}
	return b, nil
}

func (s *BlockStore) ListBlocks(pageID string) ([]domain.Block, error) {
	rows, err := s.db.Conn().Query(
		`SELECT id, page_id, type, x, y, width, height, content, file_path, style_json, created_at, updated_at FROM blocks WHERE page_id = ? ORDER BY created_at ASC`,
		pageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []domain.Block
	for rows.Next() {
		var b domain.Block
		if err := rows.Scan(&b.ID, &b.PageID, &b.Type, &b.X, &b.Y, &b.Width, &b.Height, &b.Content, &b.FilePath, &b.StyleJSON, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, rows.Err()
}

func (s *BlockStore) UpdateBlock(b *domain.Block) error {
	b.UpdatedAt = time.Now()
	_, err := s.db.Conn().Exec(
		`UPDATE blocks SET type = ?, x = ?, y = ?, width = ?, height = ?, content = ?, file_path = ?, style_json = ?, updated_at = ? WHERE id = ?`,
		b.Type, b.X, b.Y, b.Width, b.Height, b.Content, b.FilePath, b.StyleJSON, b.UpdatedAt, b.ID,
	)
	return err
}

func (s *BlockStore) DeleteBlock(id string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM blocks WHERE id = ?`, id)
	return err
}

func (s *BlockStore) DeleteBlocksByPage(pageID string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM blocks WHERE page_id = ?`, pageID)
	return err
}

// ReplacePageBlocks atomically replaces all blocks for a page.
// Used by undo/redo to fully sync DB with a snapshot.
func (s *BlockStore) ReplacePageBlocks(pageID string, blocks []domain.Block) error {
	tx, err := s.db.Conn().Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete all existing blocks for this page
	if _, err := tx.Exec(`DELETE FROM blocks WHERE page_id = ?`, pageID); err != nil {
		return fmt.Errorf("delete blocks: %w", err)
	}

	// Delete connections for this page (they reference blocks)
	if _, err := tx.Exec(`DELETE FROM connections WHERE page_id = ?`, pageID); err != nil {
		return fmt.Errorf("delete connections: %w", err)
	}

	// Re-insert all blocks from snapshot
	now := time.Now()
	for _, b := range blocks {
		_, err := tx.Exec(
			`INSERT INTO blocks (id, page_id, type, x, y, width, height, content, file_path, style_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			b.ID, pageID, b.Type, b.X, b.Y, b.Width, b.Height, b.Content, b.FilePath, b.StyleJSON, now, now,
		)
		if err != nil {
			return fmt.Errorf("insert block %s: %w", b.ID, err)
		}
	}

	return tx.Commit()
}
