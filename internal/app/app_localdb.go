package app

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"notes/internal/domain"
)

// ============================================================
// Local Database
// ============================================================

// CreateLocalDatabase creates a new local database tied to a block.
// It initializes with default columns (Title:text, Status:select).
func (a *App) CreateLocalDatabase(blockID, name string) (*domain.LocalDatabase, error) {
	defaultConfig := map[string]interface{}{
		"columns": []map[string]interface{}{
			{
				"id":    uuid.New().String(),
				"name":  "Title",
				"type":  "text",
				"width": 250,
			},
			{
				"id":      uuid.New().String(),
				"name":    "Status",
				"type":    "select",
				"width":   140,
				"options": []string{"backlog", "in progress", "review", "done"},
			},
		},
		"activeView": "table",
	}

	configBytes, _ := json.Marshal(defaultConfig)

	db := &domain.LocalDatabase{
		ID:         uuid.New().String(),
		BlockID:    blockID,
		Name:       name,
		ConfigJSON: string(configBytes),
	}

	if err := a.localDBStore.CreateDatabase(db); err != nil {
		return nil, fmt.Errorf("create local database: %w", err)
	}

	return db, nil
}

// GetLocalDatabase retrieves the local database associated with a block.
func (a *App) GetLocalDatabase(blockID string) (*domain.LocalDatabase, error) {
	return a.localDBStore.GetDatabaseByBlock(blockID)
}

// UpdateLocalDatabaseConfig updates the config (columns, views) of a local database.
func (a *App) UpdateLocalDatabaseConfig(dbID, configJSON string) error {
	db, err := a.localDBStore.GetDatabase(dbID)
	if err != nil {
		return err
	}
	db.ConfigJSON = configJSON
	return a.localDBStore.UpdateDatabase(db)
}

// RenameLocalDatabase updates the name of a local database.
func (a *App) RenameLocalDatabase(dbID, name string) error {
	db, err := a.localDBStore.GetDatabase(dbID)
	if err != nil {
		return err
	}
	db.Name = name
	return a.localDBStore.UpdateDatabase(db)
}

// DeleteLocalDatabase removes a local database and all its rows.
func (a *App) DeleteLocalDatabase(dbID string) error {
	return a.localDBStore.DeleteDatabase(dbID)
}

// ListLocalDatabases returns all local databases (for relation/chart pickers).
func (a *App) ListLocalDatabases() ([]domain.LocalDatabase, error) {
	return a.localDBStore.ListDatabases()
}

// ============================================================
// Local Database Rows
// ============================================================

// CreateLocalDBRow adds a new row to a local database.
func (a *App) CreateLocalDBRow(dbID, dataJSON string) (*domain.LocalDBRow, error) {
	row := &domain.LocalDBRow{
		ID:         uuid.New().String(),
		DatabaseID: dbID,
		DataJSON:   dataJSON,
	}

	if err := a.localDBStore.CreateRow(row); err != nil {
		return nil, fmt.Errorf("create row: %w", err)
	}

	return row, nil
}

// ListLocalDBRows returns all rows for a database, ordered by sort_order.
func (a *App) ListLocalDBRows(dbID string) ([]domain.LocalDBRow, error) {
	return a.localDBStore.ListRows(dbID)
}

// UpdateLocalDBRow updates a single row's data.
func (a *App) UpdateLocalDBRow(rowID, dataJSON string) error {
	row, err := a.localDBStore.GetRow(rowID)
	if err != nil {
		return err
	}
	row.DataJSON = dataJSON
	return a.localDBStore.UpdateRow(row)
}

// DeleteLocalDBRow removes a row.
func (a *App) DeleteLocalDBRow(rowID string) error {
	return a.localDBStore.DeleteRow(rowID)
}

// DuplicateLocalDBRow creates a copy of an existing row.
func (a *App) DuplicateLocalDBRow(rowID string) (*domain.LocalDBRow, error) {
	original, err := a.localDBStore.GetRow(rowID)
	if err != nil {
		return nil, err
	}

	dup := &domain.LocalDBRow{
		ID:         uuid.New().String(),
		DatabaseID: original.DatabaseID,
		DataJSON:   original.DataJSON,
		SortOrder:  original.SortOrder + 1,
	}

	if err := a.localDBStore.CreateRow(dup); err != nil {
		return nil, fmt.Errorf("duplicate row: %w", err)
	}

	return dup, nil
}

// ReorderLocalDBRows sets the sort order for all rows.
func (a *App) ReorderLocalDBRows(dbID string, rowIDs []string) error {
	return a.localDBStore.ReorderRows(dbID, rowIDs)
}

// BatchUpdateLocalDBRows applies multiple cell edits in a single call.
// mutations is a JSON array of {rowId, dataJson} objects.
func (a *App) BatchUpdateLocalDBRows(dbID, mutationsJSON string) error {
	var mutations []struct {
		RowID    string `json:"rowId"`
		DataJSON string `json:"dataJson"`
	}
	if err := json.Unmarshal([]byte(mutationsJSON), &mutations); err != nil {
		return fmt.Errorf("parse mutations: %w", err)
	}

	for _, m := range mutations {
		row, err := a.localDBStore.GetRow(m.RowID)
		if err != nil {
			return fmt.Errorf("get row %s: %w", m.RowID, err)
		}
		row.DataJSON = m.DataJSON
		if err := a.localDBStore.UpdateRow(row); err != nil {
			return fmt.Errorf("update row %s: %w", m.RowID, err)
		}
	}
	return nil
}

// GetLocalDatabaseStats returns stats for a local database (used by chart block).
type LocalDBStats struct {
	RowCount    int       `json:"rowCount"`
	LastUpdated time.Time `json:"lastUpdated"`
}

func (a *App) GetLocalDatabaseStats(dbID string) (*LocalDBStats, error) {
	count, lastUpdated, err := a.localDBStore.GetDatabaseStats(dbID)
	if err != nil {
		return nil, err
	}
	return &LocalDBStats{RowCount: count, LastUpdated: lastUpdated}, nil
}
