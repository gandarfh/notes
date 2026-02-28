package app

// ─────────────────────────────────────────────────────────────
// Notebook + Page Handlers — thin delegates to NotebookService
// ─────────────────────────────────────────────────────────────

import (
	"notes/internal/domain"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ── Notebooks ──────────────────────────────────────────────

func (a *App) ListNotebooks() ([]domain.Notebook, error) {
	return a.notebooks.ListNotebooks()
}

func (a *App) CreateNotebook(name string) (*domain.Notebook, error) {
	return a.notebooks.CreateNotebook(name)
}

func (a *App) RenameNotebook(id, name string) error {
	return a.notebooks.RenameNotebook(id, name)
}

func (a *App) DeleteNotebook(id string) error {
	return a.notebooks.DeleteNotebook(id)
}

// ── Pages ──────────────────────────────────────────────────

func (a *App) ListPages(notebookID string) ([]domain.Page, error) {
	return a.notebooks.ListPages(notebookID)
}

func (a *App) CreatePage(notebookID, name string) (*domain.Page, error) {
	return a.notebooks.CreatePage(notebookID, name)
}

func (a *App) GetPageState(pageID string) (*domain.PageState, error) {
	wailsRuntime.LogInfof(a.ctx, "[GetPageState] loading page: %s", pageID)
	// Track active page so the watcher can detect external changes
	if a.watcher != nil {
		// Resolve notebook ID for page list tracking
		notebookID := ""
		ps, err := a.notebooks.GetPageState(pageID)
		if err == nil && ps != nil {
			notebookID = ps.Page.NotebookID
			a.watcher.SetPage(pageID, notebookID)
			return ps, nil
		}
		a.watcher.SetPage(pageID, notebookID)
		return ps, err
	}
	return a.notebooks.GetPageState(pageID)
}

func (a *App) RenamePage(id, name string) error {
	return a.notebooks.RenamePage(id, name)
}

func (a *App) UpdateViewport(pageID string, x, y, zoom float64) error {
	return a.notebooks.UpdateViewport(pageID, x, y, zoom)
}

func (a *App) UpdateDrawingData(pageID string, data string) error {
	return a.notebooks.UpdateDrawingData(pageID, data)
}

func (a *App) DeletePage(id string) error {
	return a.notebooks.DeletePage(id)
}
