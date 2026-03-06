package storage

import (
	"fmt"
	"time"

	"notes/internal/domain"
)

// CanvasEntityStore implements domain.CanvasEntityStore using SQLite.
type CanvasEntityStore struct {
	db *DB
}

func NewCanvasEntityStore(db *DB) *CanvasEntityStore {
	return &CanvasEntityStore{db: db}
}

func (s *CanvasEntityStore) CreateCanvasEntity(e *domain.CanvasEntity) error {
	now := time.Now()
	e.CreatedAt = now
	e.UpdatedAt = now
	if e.RenderMode == "" {
		e.RenderMode = domain.RenderModeForType(e.Type)
	}
	_, err := s.db.Conn().Exec(
		`INSERT INTO canvas_entities (id, page_id, type, render_mode, z_index, x, y, width, height, content, file_path, canvas_props, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.PageID, e.Type, e.RenderMode, e.ZIndex, e.X, e.Y, e.Width, e.Height,
		e.Content, e.FilePath, e.CanvasProps, e.CreatedAt, e.UpdatedAt,
	)
	return err
}

func (s *CanvasEntityStore) GetCanvasEntity(id string) (*domain.CanvasEntity, error) {
	e := &domain.CanvasEntity{}
	err := s.db.Conn().QueryRow(
		`SELECT id, page_id, type, render_mode, z_index, x, y, width, height, content, file_path, canvas_props, created_at, updated_at
		 FROM canvas_entities WHERE id = ?`, id,
	).Scan(&e.ID, &e.PageID, &e.Type, &e.RenderMode, &e.ZIndex, &e.X, &e.Y, &e.Width, &e.Height,
		&e.Content, &e.FilePath, &e.CanvasProps, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get canvas entity: %w", err)
	}
	return e, nil
}

func (s *CanvasEntityStore) ListCanvasEntities(pageID string) ([]domain.CanvasEntity, error) {
	rows, err := s.db.Conn().Query(
		`SELECT id, page_id, type, render_mode, z_index, x, y, width, height, content, file_path, canvas_props, created_at, updated_at
		 FROM canvas_entities WHERE page_id = ? ORDER BY z_index ASC, created_at ASC`,
		pageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entities []domain.CanvasEntity
	for rows.Next() {
		var e domain.CanvasEntity
		if err := rows.Scan(&e.ID, &e.PageID, &e.Type, &e.RenderMode, &e.ZIndex, &e.X, &e.Y, &e.Width, &e.Height,
			&e.Content, &e.FilePath, &e.CanvasProps, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		entities = append(entities, e)
	}
	return entities, rows.Err()
}

func (s *CanvasEntityStore) UpdateCanvasEntity(e *domain.CanvasEntity) error {
	e.UpdatedAt = time.Now()
	_, err := s.db.Conn().Exec(
		`UPDATE canvas_entities SET type = ?, render_mode = ?, z_index = ?, x = ?, y = ?, width = ?, height = ?,
		 content = ?, file_path = ?, canvas_props = ?, updated_at = ? WHERE id = ?`,
		e.Type, e.RenderMode, e.ZIndex, e.X, e.Y, e.Width, e.Height,
		e.Content, e.FilePath, e.CanvasProps, e.UpdatedAt, e.ID,
	)
	return err
}

func (s *CanvasEntityStore) DeleteCanvasEntity(id string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM canvas_entities WHERE id = ?`, id)
	return err
}

func (s *CanvasEntityStore) DeleteCanvasEntitiesByPage(pageID string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM canvas_entities WHERE page_id = ?`, pageID)
	return err
}

func (s *CanvasEntityStore) BatchUpdateCanvasEntities(entities []domain.CanvasEntity) error {
	tx, err := s.db.Conn().Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	now := time.Now()
	for _, e := range entities {
		_, err := tx.Exec(
			`UPDATE canvas_entities SET type = ?, render_mode = ?, z_index = ?, x = ?, y = ?, width = ?, height = ?,
			 content = ?, file_path = ?, canvas_props = ?, updated_at = ? WHERE id = ?`,
			e.Type, e.RenderMode, e.ZIndex, e.X, e.Y, e.Width, e.Height,
			e.Content, e.FilePath, e.CanvasProps, now, e.ID,
		)
		if err != nil {
			return fmt.Errorf("update entity %s: %w", e.ID, err)
		}
	}
	return tx.Commit()
}

func (s *CanvasEntityStore) UpdateEntityZOrder(pageID string, orderedIDs []string) error {
	tx, err := s.db.Conn().Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	now := time.Now()
	for i, id := range orderedIDs {
		_, err := tx.Exec(
			`UPDATE canvas_entities SET z_index = ?, updated_at = ? WHERE id = ? AND page_id = ?`,
			i, now, id, pageID,
		)
		if err != nil {
			return fmt.Errorf("update z-order for %s: %w", id, err)
		}
	}
	return tx.Commit()
}

// CanvasConnectionStore implements domain.CanvasConnectionStore using SQLite.
type CanvasConnectionStore struct {
	db *DB
}

func NewCanvasConnectionStore(db *DB) *CanvasConnectionStore {
	return &CanvasConnectionStore{db: db}
}

func (s *CanvasConnectionStore) CreateCanvasConnection(c *domain.CanvasConnection) error {
	now := time.Now()
	c.CreatedAt = now
	c.UpdatedAt = now
	_, err := s.db.Conn().Exec(
		`INSERT INTO canvas_connections (id, page_id, from_entity_id, to_entity_id, from_side, from_t, to_side, to_t, label, color, style, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.PageID, c.FromEntityID, c.ToEntityID, c.FromSide, c.FromT, c.ToSide, c.ToT,
		c.Label, c.Color, c.Style, c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (s *CanvasConnectionStore) GetCanvasConnection(id string) (*domain.CanvasConnection, error) {
	c := &domain.CanvasConnection{}
	err := s.db.Conn().QueryRow(
		`SELECT id, page_id, from_entity_id, to_entity_id, from_side, from_t, to_side, to_t, label, color, style, created_at, updated_at
		 FROM canvas_connections WHERE id = ?`, id,
	).Scan(&c.ID, &c.PageID, &c.FromEntityID, &c.ToEntityID, &c.FromSide, &c.FromT, &c.ToSide, &c.ToT,
		&c.Label, &c.Color, &c.Style, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get canvas connection: %w", err)
	}
	return c, nil
}

func (s *CanvasConnectionStore) ListCanvasConnections(pageID string) ([]domain.CanvasConnection, error) {
	rows, err := s.db.Conn().Query(
		`SELECT id, page_id, from_entity_id, to_entity_id, from_side, from_t, to_side, to_t, label, color, style, created_at, updated_at
		 FROM canvas_connections WHERE page_id = ? ORDER BY created_at ASC`,
		pageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []domain.CanvasConnection
	for rows.Next() {
		var c domain.CanvasConnection
		if err := rows.Scan(&c.ID, &c.PageID, &c.FromEntityID, &c.ToEntityID, &c.FromSide, &c.FromT, &c.ToSide, &c.ToT,
			&c.Label, &c.Color, &c.Style, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		conns = append(conns, c)
	}
	return conns, rows.Err()
}

func (s *CanvasConnectionStore) UpdateCanvasConnection(c *domain.CanvasConnection) error {
	c.UpdatedAt = time.Now()
	_, err := s.db.Conn().Exec(
		`UPDATE canvas_connections SET from_entity_id = ?, to_entity_id = ?, from_side = ?, from_t = ?,
		 to_side = ?, to_t = ?, label = ?, color = ?, style = ?, updated_at = ? WHERE id = ?`,
		c.FromEntityID, c.ToEntityID, c.FromSide, c.FromT, c.ToSide, c.ToT,
		c.Label, c.Color, c.Style, c.UpdatedAt, c.ID,
	)
	return err
}

func (s *CanvasConnectionStore) DeleteCanvasConnection(id string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM canvas_connections WHERE id = ?`, id)
	return err
}

func (s *CanvasConnectionStore) DeleteCanvasConnectionsByPage(pageID string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM canvas_connections WHERE page_id = ?`, pageID)
	return err
}

func (s *CanvasConnectionStore) DeleteCanvasConnectionsByEntity(entityID string) error {
	_, err := s.db.Conn().Exec(
		`DELETE FROM canvas_connections WHERE from_entity_id = ? OR to_entity_id = ?`,
		entityID, entityID,
	)
	return err
}
