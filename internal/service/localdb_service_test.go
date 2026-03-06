package service

import (
	"testing"

	"notes/internal/storage"
	"notes/internal/testutil"
)

func newLocalDBService(t *testing.T) *LocalDBService {
	t.Helper()
	db := testutil.NewTestDB(t)
	store := storage.NewLocalDatabaseStore(db)
	return NewLocalDBService(store)
}

func TestLocalDBService_CreateDatabase(t *testing.T) {
	svc := newLocalDBService(t)

	db, err := svc.CreateDatabase("block-1", "Users")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if db.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if db.BlockID != "block-1" {
		t.Errorf("blockID = %q", db.BlockID)
	}
	if db.Name != "Users" {
		t.Errorf("name = %q", db.Name)
	}
	if db.ConfigJSON != "{}" {
		t.Errorf("config = %q, want {}", db.ConfigJSON)
	}
}

func TestLocalDBService_GetDatabase(t *testing.T) {
	svc := newLocalDBService(t)

	created, _ := svc.CreateDatabase("block-1", "Users")

	// GetDatabase uses GetDatabaseByBlock
	got, err := svc.GetDatabase("block-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("id = %q, want %q", got.ID, created.ID)
	}
}

func TestLocalDBService_UpdateConfig(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")

	config := `{"columns":[{"id":"c1","type":"text"}]}`
	if err := svc.UpdateConfig(db.ID, config); err != nil {
		t.Fatalf("update config: %v", err)
	}

	got, _ := svc.GetDatabase("block-1")
	if got.ConfigJSON != config {
		t.Errorf("config = %q", got.ConfigJSON)
	}
}

func TestLocalDBService_RenameDatabase(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Old")

	if err := svc.RenameDatabase(db.ID, "New"); err != nil {
		t.Fatalf("rename: %v", err)
	}

	got, _ := svc.GetDatabase("block-1")
	if got.Name != "New" {
		t.Errorf("name = %q", got.Name)
	}
}

func TestLocalDBService_DeleteDatabase(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")

	if err := svc.DeleteDatabase(db.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := svc.GetDatabase("block-1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestLocalDBService_ListDatabases(t *testing.T) {
	svc := newLocalDBService(t)

	svc.CreateDatabase("block-1", "A")
	svc.CreateDatabase("block-2", "B")

	list, err := svc.ListDatabases()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
}

func TestLocalDBService_GetDatabaseStats(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")

	stats, err := svc.GetDatabaseStats(db.ID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.RowCount != 0 {
		t.Errorf("rowCount = %d, want 0", stats.RowCount)
	}

	svc.CreateRow(db.ID, `{"name":"alice"}`)
	svc.CreateRow(db.ID, `{"name":"bob"}`)

	stats, _ = svc.GetDatabaseStats(db.ID)
	if stats.RowCount != 2 {
		t.Errorf("rowCount = %d, want 2", stats.RowCount)
	}
}

// ── Row Tests ───────────────────────────────────────────────

func TestLocalDBService_CreateAndListRows(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")

	row, err := svc.CreateRow(db.ID, `{"name":"alice"}`)
	if err != nil {
		t.Fatalf("create row: %v", err)
	}
	if row.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if row.DataJSON != `{"name":"alice"}` {
		t.Errorf("data = %q", row.DataJSON)
	}

	rows, _ := svc.ListRows(db.ID)
	if len(rows) != 1 {
		t.Fatalf("len = %d, want 1", len(rows))
	}
}

func TestLocalDBService_UpdateRow(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")
	row, _ := svc.CreateRow(db.ID, `{"name":"old"}`)

	if err := svc.UpdateRow(row.ID, `{"name":"new"}`); err != nil {
		t.Fatalf("update: %v", err)
	}

	rows, _ := svc.ListRows(db.ID)
	if rows[0].DataJSON != `{"name":"new"}` {
		t.Errorf("data = %q", rows[0].DataJSON)
	}
}

func TestLocalDBService_DeleteRow(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")
	row, _ := svc.CreateRow(db.ID, `{}`)

	if err := svc.DeleteRow(row.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	rows, _ := svc.ListRows(db.ID)
	if len(rows) != 0 {
		t.Errorf("len = %d, want 0", len(rows))
	}
}

func TestLocalDBService_DuplicateRow(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")
	original, _ := svc.CreateRow(db.ID, `{"name":"alice"}`)

	dup, err := svc.DuplicateRow(original.ID)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}

	if dup.ID == original.ID {
		t.Error("duplicate should have different ID")
	}
	if dup.DataJSON != original.DataJSON {
		t.Errorf("data = %q, want %q", dup.DataJSON, original.DataJSON)
	}
	if dup.DatabaseID != original.DatabaseID {
		t.Errorf("databaseID = %q", dup.DatabaseID)
	}

	rows, _ := svc.ListRows(db.ID)
	if len(rows) != 2 {
		t.Fatalf("len = %d, want 2", len(rows))
	}
}

func TestLocalDBService_ReorderRows(t *testing.T) {
	svc := newLocalDBService(t)

	db, _ := svc.CreateDatabase("block-1", "Users")
	r1, _ := svc.CreateRow(db.ID, `{"name":"a"}`)
	r2, _ := svc.CreateRow(db.ID, `{"name":"b"}`)
	r3, _ := svc.CreateRow(db.ID, `{"name":"c"}`)

	// Reverse order
	if err := svc.ReorderRows(db.ID, []string{r3.ID, r2.ID, r1.ID}); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	rows, _ := svc.ListRows(db.ID)
	if rows[0].ID != r3.ID {
		t.Errorf("first row = %q, want %q", rows[0].ID, r3.ID)
	}
}

func TestLocalDBService_BatchUpdateRows_Noop(t *testing.T) {
	svc := newLocalDBService(t)
	err := svc.BatchUpdateRows("db-1", `[{"rowId":"r1","data":{}}]`)
	if err != nil {
		t.Errorf("BatchUpdateRows noop returned error: %v", err)
	}
}
