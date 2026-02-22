package storage

import (
	"fmt"
	"time"

	"notes/internal/domain"
)

// NotebookStore implements domain.NotebookStore using SQLite.
type NotebookStore struct {
	db *DB
}

func NewNotebookStore(db *DB) *NotebookStore {
	return &NotebookStore{db: db}
}

func (s *NotebookStore) CreateNotebook(nb *domain.Notebook) error {
	now := time.Now()
	nb.CreatedAt = now
	nb.UpdatedAt = now
	_, err := s.db.conn.Exec(
		`INSERT INTO notebooks (id, name, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		nb.ID, nb.Name, nb.Icon, nb.CreatedAt, nb.UpdatedAt,
	)
	return err
}

func (s *NotebookStore) GetNotebook(id string) (*domain.Notebook, error) {
	nb := &domain.Notebook{}
	err := s.db.conn.QueryRow(
		`SELECT id, name, icon, created_at, updated_at FROM notebooks WHERE id = ?`, id,
	).Scan(&nb.ID, &nb.Name, &nb.Icon, &nb.CreatedAt, &nb.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get notebook: %w", err)
	}
	return nb, nil
}

func (s *NotebookStore) ListNotebooks() ([]domain.Notebook, error) {
	rows, err := s.db.conn.Query(`SELECT id, name, icon, created_at, updated_at FROM notebooks ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notebooks []domain.Notebook
	for rows.Next() {
		var nb domain.Notebook
		if err := rows.Scan(&nb.ID, &nb.Name, &nb.Icon, &nb.CreatedAt, &nb.UpdatedAt); err != nil {
			return nil, err
		}
		notebooks = append(notebooks, nb)
	}
	return notebooks, rows.Err()
}

func (s *NotebookStore) UpdateNotebook(nb *domain.Notebook) error {
	nb.UpdatedAt = time.Now()
	_, err := s.db.conn.Exec(
		`UPDATE notebooks SET name = ?, icon = ?, updated_at = ? WHERE id = ?`,
		nb.Name, nb.Icon, nb.UpdatedAt, nb.ID,
	)
	return err
}

func (s *NotebookStore) DeleteNotebook(id string) error {
	_, err := s.db.conn.Exec(`DELETE FROM notebooks WHERE id = ?`, id)
	return err
}

func (s *NotebookStore) CreatePage(p *domain.Page) error {
	now := time.Now()
	p.CreatedAt = now
	p.UpdatedAt = now
	_, err := s.db.conn.Exec(
		`INSERT INTO pages (id, notebook_id, name, sort_order, viewport_x, viewport_y, viewport_zoom, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.NotebookID, p.Name, p.Order, p.ViewportX, p.ViewportY, p.ViewportZoom, p.CreatedAt, p.UpdatedAt,
	)
	return err
}

func (s *NotebookStore) GetPage(id string) (*domain.Page, error) {
	p := &domain.Page{}
	err := s.db.conn.QueryRow(
		`SELECT id, notebook_id, name, sort_order, viewport_x, viewport_y, viewport_zoom, COALESCE(drawing_data, '') as drawing_data, created_at, updated_at FROM pages WHERE id = ?`, id,
	).Scan(&p.ID, &p.NotebookID, &p.Name, &p.Order, &p.ViewportX, &p.ViewportY, &p.ViewportZoom, &p.DrawingData, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get page: %w", err)
	}
	return p, nil
}

func (s *NotebookStore) ListPages(notebookID string) ([]domain.Page, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, notebook_id, name, sort_order, viewport_x, viewport_y, viewport_zoom, created_at, updated_at FROM pages WHERE notebook_id = ? ORDER BY sort_order ASC`,
		notebookID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pages []domain.Page
	for rows.Next() {
		var p domain.Page
		if err := rows.Scan(&p.ID, &p.NotebookID, &p.Name, &p.Order, &p.ViewportX, &p.ViewportY, &p.ViewportZoom, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

func (s *NotebookStore) UpdatePage(p *domain.Page) error {
	p.UpdatedAt = time.Now()
	_, err := s.db.conn.Exec(
		`UPDATE pages SET name = ?, sort_order = ?, viewport_x = ?, viewport_y = ?, viewport_zoom = ?, drawing_data = ?, updated_at = ? WHERE id = ?`,
		p.Name, p.Order, p.ViewportX, p.ViewportY, p.ViewportZoom, p.DrawingData, p.UpdatedAt, p.ID,
	)
	return err
}

func (s *NotebookStore) DeletePage(id string) error {
	_, err := s.db.conn.Exec(`DELETE FROM pages WHERE id = ?`, id)
	return err
}

func (s *NotebookStore) DeletePagesByNotebook(notebookID string) error {
	_, err := s.db.conn.Exec(`DELETE FROM pages WHERE notebook_id = ?`, notebookID)
	return err
}
