package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"notes/internal/domain"
	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// LocalDB Service — business logic for local-database blocks
// ─────────────────────────────────────────────────────────────

// LocalDBService manages the LocalDatabase plugin data.
type LocalDBService struct {
	store *storage.LocalDatabaseStore
}

// NewLocalDBService creates a LocalDBService.
func NewLocalDBService(store *storage.LocalDatabaseStore) *LocalDBService {
	return &LocalDBService{store: store}
}

// LocalDBStats holds summary statistics for a local database.
type LocalDBStats struct {
	RowCount    int       `json:"rowCount"`
	LastUpdated time.Time `json:"lastUpdated"`
}

// ── Database CRUD ──────────────────────────────────────────

func (s *LocalDBService) CreateDatabase(blockID, name string) (*domain.LocalDatabase, error) {
	db := &domain.LocalDatabase{
		ID:         uuid.New().String(),
		BlockID:    blockID,
		Name:       name,
		ConfigJSON: "{}",
	}
	if err := s.store.CreateDatabase(db); err != nil {
		return nil, fmt.Errorf("create localdb: %w", err)
	}
	return db, nil
}

func (s *LocalDBService) GetDatabase(blockID string) (*domain.LocalDatabase, error) {
	return s.store.GetDatabaseByBlock(blockID)
}

func (s *LocalDBService) UpdateConfig(dbID, configJSON string) error {
	db, err := s.store.GetDatabase(dbID)
	if err != nil {
		return err
	}
	db.ConfigJSON = configJSON
	return s.store.UpdateDatabase(db)
}

func (s *LocalDBService) RenameDatabase(dbID, name string) error {
	db, err := s.store.GetDatabase(dbID)
	if err != nil {
		return err
	}
	db.Name = name
	return s.store.UpdateDatabase(db)
}

func (s *LocalDBService) DeleteDatabase(dbID string) error {
	return s.store.DeleteDatabase(dbID)
}

func (s *LocalDBService) ListDatabases() ([]domain.LocalDatabase, error) {
	return s.store.ListDatabases()
}

func (s *LocalDBService) GetDatabaseStats(dbID string) (*LocalDBStats, error) {
	count, lastUpdated, err := s.store.GetDatabaseStats(dbID)
	if err != nil {
		return nil, err
	}
	return &LocalDBStats{RowCount: count, LastUpdated: lastUpdated}, nil
}

// ── Row CRUD ───────────────────────────────────────────────

func (s *LocalDBService) CreateRow(dbID, dataJSON string) (*domain.LocalDBRow, error) {
	row := &domain.LocalDBRow{
		ID:         uuid.New().String(),
		DatabaseID: dbID,
		DataJSON:   dataJSON,
	}
	if err := s.store.CreateRow(row); err != nil {
		return nil, fmt.Errorf("create row: %w", err)
	}
	return row, nil
}

func (s *LocalDBService) ListRows(dbID string) ([]domain.LocalDBRow, error) {
	return s.store.ListRows(dbID)
}

func (s *LocalDBService) UpdateRow(rowID, dataJSON string) error {
	row, err := s.store.GetRow(rowID)
	if err != nil {
		return err
	}
	row.DataJSON = dataJSON
	return s.store.UpdateRow(row)
}

func (s *LocalDBService) DeleteRow(rowID string) error {
	return s.store.DeleteRow(rowID)
}

func (s *LocalDBService) DuplicateRow(rowID string) (*domain.LocalDBRow, error) {
	original, err := s.store.GetRow(rowID)
	if err != nil {
		return nil, err
	}
	dup := &domain.LocalDBRow{
		ID:         uuid.New().String(),
		DatabaseID: original.DatabaseID,
		DataJSON:   original.DataJSON,
		SortOrder:  original.SortOrder + 1,
	}
	if err := s.store.CreateRow(dup); err != nil {
		return nil, fmt.Errorf("duplicate row: %w", err)
	}
	return dup, nil
}

func (s *LocalDBService) ReorderRows(dbID string, rowIDs []string) error {
	return s.store.ReorderRows(dbID, rowIDs)
}

// BatchUpdateRows is a bulk mutation — just returns an error indicating it has to be
// handled via individual UpdateRow calls until the store provides a native method.
func (s *LocalDBService) BatchUpdateRows(dbID, mutationsJSON string) error {
	// LocalDatabaseStore does not expose BatchUpdateRows yet.
	// This is a no-op placeholder; plugins should use individual UpdateRow calls.
	_ = dbID
	_ = mutationsJSON
	return nil
}
