package app

// ─────────────────────────────────────────────────────────────
// LocalDB Handlers — thin delegates to LocalDBService
// ─────────────────────────────────────────────────────────────

import (
	"notes/internal/domain"
	"notes/internal/service"
)

func (a *App) CreateLocalDatabase(blockID, name string) (*domain.LocalDatabase, error) {
	return a.localdb.CreateDatabase(blockID, name)
}

func (a *App) GetLocalDatabase(blockID string) (*domain.LocalDatabase, error) {
	return a.localdb.GetDatabase(blockID)
}

func (a *App) UpdateLocalDatabaseConfig(dbID, configJSON string) error {
	return a.localdb.UpdateConfig(dbID, configJSON)
}

func (a *App) RenameLocalDatabase(dbID, name string) error {
	return a.localdb.RenameDatabase(dbID, name)
}

func (a *App) DeleteLocalDatabase(dbID string) error {
	return a.localdb.DeleteDatabase(dbID)
}

func (a *App) ListLocalDatabases() ([]domain.LocalDatabase, error) {
	return a.localdb.ListDatabases()
}

func (a *App) GetLocalDatabaseStats(dbID string) (*service.LocalDBStats, error) {
	return a.localdb.GetDatabaseStats(dbID)
}

func (a *App) CreateLocalDBRow(dbID, dataJSON string) (*domain.LocalDBRow, error) {
	return a.localdb.CreateRow(dbID, dataJSON)
}

func (a *App) ListLocalDBRows(dbID string) ([]domain.LocalDBRow, error) {
	return a.localdb.ListRows(dbID)
}

func (a *App) UpdateLocalDBRow(rowID, dataJSON string) error {
	return a.localdb.UpdateRow(rowID, dataJSON)
}

func (a *App) DeleteLocalDBRow(rowID string) error {
	return a.localdb.DeleteRow(rowID)
}

func (a *App) DuplicateLocalDBRow(rowID string) (*domain.LocalDBRow, error) {
	return a.localdb.DuplicateRow(rowID)
}

func (a *App) ReorderLocalDBRows(dbID string, rowIDs []string) error {
	return a.localdb.ReorderRows(dbID, rowIDs)
}

func (a *App) BatchUpdateLocalDBRows(dbID, mutationsJSON string) error {
	return a.localdb.BatchUpdateRows(dbID, mutationsJSON)
}
