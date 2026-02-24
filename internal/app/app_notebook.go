package app

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/domain"
)

// ============================================================
// Notebooks
// ============================================================

func (a *App) ListNotebooks() ([]domain.Notebook, error) {
	return a.notebooks.ListNotebooks()
}

func (a *App) CreateNotebook(name string) (*domain.Notebook, error) {
	nb := &domain.Notebook{
		ID:   uuid.New().String(),
		Name: name,
		Icon: "📓",
	}
	if err := a.notebooks.CreateNotebook(nb); err != nil {
		return nil, fmt.Errorf("create notebook: %w", err)
	}

	dir := filepath.Join(a.db.DataDir(), nb.ID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create notebook dir: %w", err)
	}

	return nb, nil
}

func (a *App) RenameNotebook(id, name string) error {
	nb, err := a.notebooks.GetNotebook(id)
	if err != nil {
		return err
	}
	nb.Name = name
	return a.notebooks.UpdateNotebook(nb)
}

func (a *App) DeleteNotebook(id string) error {
	pages, _ := a.notebooks.ListPages(id)
	for _, p := range pages {
		a.conns.DeleteConnectionsByPage(p.ID)
		a.blocks.DeleteBlocksByPage(p.ID)
	}
	a.notebooks.DeletePagesByNotebook(id)

	dir := filepath.Join(a.db.DataDir(), id)
	os.RemoveAll(dir)

	return a.notebooks.DeleteNotebook(id)
}

// ============================================================
// Pages
// ============================================================

func (a *App) ListPages(notebookID string) ([]domain.Page, error) {
	return a.notebooks.ListPages(notebookID)
}

func (a *App) CreatePage(notebookID, name string) (*domain.Page, error) {
	p := &domain.Page{
		ID:           uuid.New().String(),
		NotebookID:   notebookID,
		Name:         name,
		ViewportZoom: 1.0,
	}
	if err := a.notebooks.CreatePage(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (a *App) GetPageState(pageID string) (*domain.PageState, error) {
	wailsRuntime.LogInfof(a.ctx, "[GetPageState] loading page: %s", pageID)
	page, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return nil, err
	}
	blocks, err := a.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}
	connections, err := a.conns.ListConnections(pageID)
	if err != nil {
		return nil, err
	}

	if blocks == nil {
		blocks = []domain.Block{}
	}
	if connections == nil {
		connections = []domain.Connection{}
	}

	return &domain.PageState{
		Page:        *page,
		Blocks:      blocks,
		Connections: connections,
	}, nil
}

func (a *App) RenamePage(id, name string) error {
	p, err := a.notebooks.GetPage(id)
	if err != nil {
		return err
	}
	p.Name = name
	return a.notebooks.UpdatePage(p)
}

func (a *App) UpdateViewport(pageID string, x, y, zoom float64) error {
	p, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return err
	}
	p.ViewportX = x
	p.ViewportY = y
	p.ViewportZoom = zoom
	return a.notebooks.UpdatePage(p)
}

func (a *App) UpdateDrawingData(pageID string, data string) error {
	p, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return err
	}
	p.DrawingData = data
	return a.notebooks.UpdatePage(p)
}

func (a *App) DeletePage(id string) error {
	a.conns.DeleteConnectionsByPage(id)
	a.blocks.DeleteBlocksByPage(id)
	return a.notebooks.DeletePage(id)
}
