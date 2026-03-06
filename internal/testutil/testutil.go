package testutil

import (
	"testing"

	"notes/internal/storage"
)

// NewTestDB creates an in-memory SQLite database for testing.
// It automatically closes the database when the test completes.
func NewTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.New(":memory:", t.TempDir())
	if err != nil {
		t.Fatalf("create test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
