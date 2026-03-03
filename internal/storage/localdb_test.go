package storage

import (
	"testing"

	"notes/internal/domain"
)

func newLocalDBStore(t *testing.T) *LocalDatabaseStore {
	t.Helper()
	return NewLocalDatabaseStore(newTestDB(t))
}

// ── Database Tests ──────────────────────────────────────────

func TestLocalDatabaseStore_CreateAndGet(t *testing.T) {
	s := newLocalDBStore(t)

	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Users", ConfigJSON: `{"cols":[]}`}
	if err := s.CreateDatabase(d); err != nil {
		t.Fatalf("create: %v", err)
	}

	if d.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}

	got, err := s.GetDatabase("db-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "Users" {
		t.Errorf("name = %q, want Users", got.Name)
	}
	if got.ConfigJSON != `{"cols":[]}` {
		t.Errorf("config = %q", got.ConfigJSON)
	}
}

func TestLocalDatabaseStore_GetNotFound(t *testing.T) {
	s := newLocalDBStore(t)
	_, err := s.GetDatabase("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestLocalDatabaseStore_GetDatabaseByBlock(t *testing.T) {
	s := newLocalDBStore(t)

	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Users", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	got, err := s.GetDatabaseByBlock("block-1")
	if err != nil {
		t.Fatalf("get by block: %v", err)
	}
	if got.ID != "db-1" {
		t.Errorf("id = %q, want db-1", got.ID)
	}
}

func TestLocalDatabaseStore_GetDatabaseByBlock_NotFound(t *testing.T) {
	s := newLocalDBStore(t)
	_, err := s.GetDatabaseByBlock("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestLocalDatabaseStore_UpdateDatabase(t *testing.T) {
	s := newLocalDBStore(t)

	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Old", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	d.Name = "New"
	d.ConfigJSON = `{"cols":[{"id":"c1"}]}`
	if err := s.UpdateDatabase(d); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetDatabase("db-1")
	if got.Name != "New" {
		t.Errorf("name = %q, want New", got.Name)
	}
}

func TestLocalDatabaseStore_DeleteDatabase_CascadesRows(t *testing.T) {
	s := newLocalDBStore(t)

	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	// Add rows
	for _, id := range []string{"r1", "r2"} {
		r := &domain.LocalDBRow{ID: id, DatabaseID: "db-1", DataJSON: "{}"}
		s.CreateRow(r)
	}

	if err := s.DeleteDatabase("db-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := s.GetDatabase("db-1")
	if err == nil {
		t.Fatal("database should be deleted")
	}

	rows, _ := s.ListRows("db-1")
	if len(rows) != 0 {
		t.Errorf("rows len = %d, want 0 (cascade delete)", len(rows))
	}
}

func TestLocalDatabaseStore_ListDatabases(t *testing.T) {
	s := newLocalDBStore(t)

	for _, id := range []string{"db-1", "db-2"} {
		d := &domain.LocalDatabase{ID: id, BlockID: "block-" + id, Name: id, ConfigJSON: "{}"}
		s.CreateDatabase(d)
	}

	list, err := s.ListDatabases()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
}

func TestLocalDatabaseStore_UniqueBlockConstraint(t *testing.T) {
	s := newLocalDBStore(t)

	d1 := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "First", ConfigJSON: "{}"}
	if err := s.CreateDatabase(d1); err != nil {
		t.Fatalf("create first: %v", err)
	}

	d2 := &domain.LocalDatabase{ID: "db-2", BlockID: "block-1", Name: "Second", ConfigJSON: "{}"}
	err := s.CreateDatabase(d2)
	if err == nil {
		t.Fatal("expected unique constraint error for duplicate block_id")
	}
}

// ── Row Tests ───────────────────────────────────────────────

func TestLocalDatabaseStore_CreateRow_AutoSortOrder(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	r1 := &domain.LocalDBRow{ID: "r1", DatabaseID: "db-1", DataJSON: `{"name":"a"}`}
	s.CreateRow(r1)

	r2 := &domain.LocalDBRow{ID: "r2", DatabaseID: "db-1", DataJSON: `{"name":"b"}`}
	s.CreateRow(r2)

	if r1.SortOrder != 1 {
		t.Errorf("r1 sort_order = %d, want 1", r1.SortOrder)
	}
	if r2.SortOrder != 2 {
		t.Errorf("r2 sort_order = %d, want 2", r2.SortOrder)
	}
}

func TestLocalDatabaseStore_CreateRow_ExplicitSortOrder(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	r := &domain.LocalDBRow{ID: "r1", DatabaseID: "db-1", DataJSON: "{}", SortOrder: 42}
	s.CreateRow(r)

	if r.SortOrder != 42 {
		t.Errorf("sort_order = %d, want 42", r.SortOrder)
	}
}

func TestLocalDatabaseStore_GetRow(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	r := &domain.LocalDBRow{ID: "r1", DatabaseID: "db-1", DataJSON: `{"x":1}`}
	s.CreateRow(r)

	got, err := s.GetRow("r1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.DataJSON != `{"x":1}` {
		t.Errorf("data = %q", got.DataJSON)
	}
}

func TestLocalDatabaseStore_GetRow_NotFound(t *testing.T) {
	s := newLocalDBStore(t)
	_, err := s.GetRow("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestLocalDatabaseStore_ListRows_OrderedBySortOrder(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	for _, id := range []string{"r1", "r2", "r3"} {
		r := &domain.LocalDBRow{ID: id, DatabaseID: "db-1", DataJSON: "{}"}
		s.CreateRow(r)
	}

	rows, err := s.ListRows("db-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("len = %d, want 3", len(rows))
	}
	for i, r := range rows {
		if r.SortOrder != i+1 {
			t.Errorf("rows[%d].SortOrder = %d, want %d", i, r.SortOrder, i+1)
		}
	}
}

func TestLocalDatabaseStore_UpdateRow(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	r := &domain.LocalDBRow{ID: "r1", DatabaseID: "db-1", DataJSON: `{"old":true}`}
	s.CreateRow(r)

	r.DataJSON = `{"new":true}`
	if err := s.UpdateRow(r); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetRow("r1")
	if got.DataJSON != `{"new":true}` {
		t.Errorf("data = %q", got.DataJSON)
	}
}

func TestLocalDatabaseStore_DeleteRow(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	r := &domain.LocalDBRow{ID: "r1", DatabaseID: "db-1", DataJSON: "{}"}
	s.CreateRow(r)

	if err := s.DeleteRow("r1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := s.GetRow("r1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestLocalDatabaseStore_DeleteRowsByDatabase(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	for _, id := range []string{"r1", "r2"} {
		r := &domain.LocalDBRow{ID: id, DatabaseID: "db-1", DataJSON: "{}"}
		s.CreateRow(r)
	}

	if err := s.DeleteRowsByDatabase("db-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	rows, _ := s.ListRows("db-1")
	if len(rows) != 0 {
		t.Errorf("len = %d, want 0", len(rows))
	}
}

func TestLocalDatabaseStore_ReorderRows(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	for _, id := range []string{"r1", "r2", "r3"} {
		r := &domain.LocalDBRow{ID: id, DatabaseID: "db-1", DataJSON: "{}"}
		s.CreateRow(r)
	}

	// Reorder: r3, r1, r2
	if err := s.ReorderRows("db-1", []string{"r3", "r1", "r2"}); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	rows, _ := s.ListRows("db-1")
	if len(rows) != 3 {
		t.Fatalf("len = %d, want 3", len(rows))
	}
	expected := []string{"r3", "r1", "r2"}
	for i, r := range rows {
		if r.ID != expected[i] {
			t.Errorf("rows[%d].ID = %q, want %q", i, r.ID, expected[i])
		}
	}
}

func TestLocalDatabaseStore_GetDatabaseStats(t *testing.T) {
	s := newLocalDBStore(t)
	d := &domain.LocalDatabase{ID: "db-1", BlockID: "block-1", Name: "Test", ConfigJSON: "{}"}
	s.CreateDatabase(d)

	// Empty database
	count, _, err := s.GetDatabaseStats("db-1")
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}

	// Add rows
	for _, id := range []string{"r1", "r2"} {
		r := &domain.LocalDBRow{ID: id, DatabaseID: "db-1", DataJSON: "{}"}
		s.CreateRow(r)
	}

	count, lastUpdated, err := s.GetDatabaseStats("db-1")
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if count != 2 {
		t.Errorf("count = %d, want 2", count)
	}
	if lastUpdated.IsZero() {
		t.Error("lastUpdated should not be zero")
	}
}
