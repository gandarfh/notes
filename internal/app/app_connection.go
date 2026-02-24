package app

import (
	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/domain"
)

// ============================================================
// Connections
// ============================================================

func (a *App) CreateConnection(pageID, fromBlockID, toBlockID string) (*domain.Connection, error) {
	c := &domain.Connection{
		ID:          uuid.New().String(),
		PageID:      pageID,
		FromBlockID: fromBlockID,
		ToBlockID:   toBlockID,
		Color:       "#666666",
		Style:       domain.ConnectionStyleSolid,
	}
	if err := a.conns.CreateConnection(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (a *App) UpdateConnection(id, label, color, style string) error {
	c, err := a.conns.GetConnection(id)
	if err != nil {
		return err
	}
	c.Label = label
	c.Color = color
	c.Style = domain.ConnectionStyle(style)
	return a.conns.UpdateConnection(c)
}

func (a *App) DeleteConnection(id string) error {
	return a.conns.DeleteConnection(id)
}

// PickDatabaseFile opens a native file picker for selecting a database file.
func (a *App) PickDatabaseFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Database File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Database Files", Pattern: "*.db;*.sqlite;*.sqlite3;*.s3db"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	return path, err
}
