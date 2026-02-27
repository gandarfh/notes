package service_test

import (
	"testing"
	"time"

	"notes/internal/service"
)

// ─────────────────────────────────────────────────────────────
// LocalDBService unit tests
// Only tests paths that don't require a real SQLite store.
// ─────────────────────────────────────────────────────────────

func TestLocalDBService_NewLocalDBService(t *testing.T) {
	svc := service.NewLocalDBService(nil)
	if svc == nil {
		t.Fatal("expected non-nil LocalDBService")
	}
}

func TestLocalDBService_GetDatabaseStats_MethodExists(t *testing.T) {
	svc := service.NewLocalDBService(nil)
	// Compile-time check: method must exist with correct signature
	_ = svc.GetDatabaseStats
}

func TestLocalDBService_BatchUpdateRows_Noop(t *testing.T) {
	// BatchUpdateRows is a no-op placeholder — should not error
	svc := service.NewLocalDBService(nil)
	err := svc.BatchUpdateRows("db-1", `[{"rowId":"r1","data":{}}]`)
	if err != nil {
		t.Errorf("BatchUpdateRows no-op returned unexpected error: %v", err)
	}
}

func TestLocalDBService_LocalDBStats_Fields(t *testing.T) {
	// Verify LocalDBStats struct has the expected fields (compile-time check)
	stats := &service.LocalDBStats{
		RowCount:    10,
		LastUpdated: time.Now(),
	}
	if stats.RowCount != 10 {
		t.Errorf("expected RowCount=10, got %d", stats.RowCount)
	}
}

func TestLocalDBService_MethodsExist(t *testing.T) {
	svc := service.NewLocalDBService(nil)
	// Compile-time checks for all exported methods
	_ = svc.CreateDatabase
	_ = svc.GetDatabase
	_ = svc.UpdateConfig
	_ = svc.RenameDatabase
	_ = svc.DeleteDatabase
	_ = svc.ListDatabases
	_ = svc.GetDatabaseStats
	_ = svc.CreateRow
	_ = svc.ListRows
	_ = svc.UpdateRow
	_ = svc.DeleteRow
	_ = svc.DuplicateRow
	_ = svc.ReorderRows
	_ = svc.BatchUpdateRows
}
