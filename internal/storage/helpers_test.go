package storage

import "testing"

// newTestDB creates an in-memory SQLite database for testing.
// This is equivalent to testutil.NewTestDB but lives in the storage package
// to avoid import cycles.
func newTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := New(":memory:", t.TempDir())
	if err != nil {
		t.Fatalf("create test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
