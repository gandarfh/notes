package plugins

import (
	"testing"

	"notes/internal/service"
	"notes/internal/storage"
	"notes/internal/testutil"
)

func newLocalDBService(t *testing.T) *service.LocalDBService {
	t.Helper()
	db := testutil.NewTestDB(t)
	store := storage.NewLocalDatabaseStore(db)
	return service.NewLocalDBService(store)
}

// ── LocalDB Plugin ──

func TestLocalDBPlugin_BlockType(t *testing.T) {
	svc := newLocalDBService(t)
	p := NewLocalDBPlugin(svc)
	if p.BlockType() != "localdb" {
		t.Errorf("BlockType = %q, want localdb", p.BlockType())
	}
}

func TestLocalDBPlugin_OnCreate(t *testing.T) {
	svc := newLocalDBService(t)
	p := NewLocalDBPlugin(svc)

	if err := p.OnCreate("block-1", "page-1"); err != nil {
		t.Fatalf("OnCreate: %v", err)
	}

	// Database should now exist for this block
	db, err := svc.GetDatabase("block-1")
	if err != nil {
		t.Fatalf("GetDatabase: %v", err)
	}
	if db.BlockID != "block-1" {
		t.Errorf("blockID = %q", db.BlockID)
	}
	if db.Name != "New Database" {
		t.Errorf("name = %q, want 'New Database'", db.Name)
	}
}

func TestLocalDBPlugin_OnCreate_DuplicateBlock(t *testing.T) {
	svc := newLocalDBService(t)
	p := NewLocalDBPlugin(svc)

	if err := p.OnCreate("block-1", "page-1"); err != nil {
		t.Fatalf("first OnCreate: %v", err)
	}

	// Second create for same block should fail (unique constraint on block_id)
	err := p.OnCreate("block-1", "page-1")
	if err == nil {
		t.Error("expected error on duplicate block")
	}
}

func TestLocalDBPlugin_OnDelete(t *testing.T) {
	svc := newLocalDBService(t)
	p := NewLocalDBPlugin(svc)

	// Create first
	p.OnCreate("block-1", "page-1")

	// Delete
	if err := p.OnDelete("block-1"); err != nil {
		t.Fatalf("OnDelete: %v", err)
	}

	// Database should no longer exist
	_, err := svc.GetDatabase("block-1")
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestLocalDBPlugin_OnDelete_NonExistent(t *testing.T) {
	svc := newLocalDBService(t)
	p := NewLocalDBPlugin(svc)

	// Deleting a non-existent block should not error
	if err := p.OnDelete("nonexistent"); err != nil {
		t.Fatalf("OnDelete non-existent: %v", err)
	}
}

func TestLocalDBPlugin_FullLifecycle(t *testing.T) {
	svc := newLocalDBService(t)
	p := NewLocalDBPlugin(svc)

	// Create multiple databases
	for _, id := range []string{"block-a", "block-b", "block-c"} {
		if err := p.OnCreate(id, "page-1"); err != nil {
			t.Fatalf("OnCreate %s: %v", id, err)
		}
	}

	// Verify all exist
	for _, id := range []string{"block-a", "block-b", "block-c"} {
		if _, err := svc.GetDatabase(id); err != nil {
			t.Errorf("GetDatabase %s: %v", id, err)
		}
	}

	// Delete middle one
	if err := p.OnDelete("block-b"); err != nil {
		t.Fatalf("OnDelete block-b: %v", err)
	}

	// block-b should be gone, others should remain
	if _, err := svc.GetDatabase("block-b"); err == nil {
		t.Error("block-b should be deleted")
	}
	if _, err := svc.GetDatabase("block-a"); err != nil {
		t.Errorf("block-a should still exist: %v", err)
	}
	if _, err := svc.GetDatabase("block-c"); err != nil {
		t.Errorf("block-c should still exist: %v", err)
	}
}

// ── HTTP Plugin ──

func TestHTTPPlugin_BlockType(t *testing.T) {
	db := testutil.NewTestDB(t)
	blockStore := storage.NewBlockStore(db)
	p := NewHTTPPlugin(blockStore)

	if p.BlockType() != "http" {
		t.Errorf("BlockType = %q, want http", p.BlockType())
	}
}

func TestHTTPPlugin_OnCreate_Noop(t *testing.T) {
	db := testutil.NewTestDB(t)
	blockStore := storage.NewBlockStore(db)
	p := NewHTTPPlugin(blockStore)

	if err := p.OnCreate("block-1", "page-1"); err != nil {
		t.Fatalf("OnCreate: %v", err)
	}
}

func TestHTTPPlugin_OnDelete_Noop(t *testing.T) {
	db := testutil.NewTestDB(t)
	blockStore := storage.NewBlockStore(db)
	p := NewHTTPPlugin(blockStore)

	if err := p.OnDelete("block-1"); err != nil {
		t.Fatalf("OnDelete: %v", err)
	}
}

// ── Plugin Registry Integration ──

func TestPluginRegistry_WithRealPlugins(t *testing.T) {
	db := testutil.NewTestDB(t)
	localDBSvc := service.NewLocalDBService(storage.NewLocalDatabaseStore(db))
	blockStore := storage.NewBlockStore(db)

	registry := service.NewGoPluginRegistry()
	registry.Register(NewLocalDBPlugin(localDBSvc))
	registry.Register(NewHTTPPlugin(blockStore))

	// OnCreate for localdb should create a database
	if err := registry.OnCreate("block-1", "page-1", "localdb"); err != nil {
		t.Fatalf("registry OnCreate localdb: %v", err)
	}

	dbRecord, err := localDBSvc.GetDatabase("block-1")
	if err != nil {
		t.Fatalf("database should exist: %v", err)
	}
	if dbRecord.Name != "New Database" {
		t.Errorf("name = %q", dbRecord.Name)
	}

	// OnCreate for http should succeed (noop)
	if err := registry.OnCreate("block-2", "page-1", "http"); err != nil {
		t.Fatalf("registry OnCreate http: %v", err)
	}

	// OnCreate for unknown type should succeed (no plugin registered)
	if err := registry.OnCreate("block-3", "page-1", "markdown"); err != nil {
		t.Fatalf("registry OnCreate unknown: %v", err)
	}

	// OnDelete for localdb should remove the database
	if err := registry.OnDelete("block-1", "localdb"); err != nil {
		t.Fatalf("registry OnDelete localdb: %v", err)
	}
	if _, err := localDBSvc.GetDatabase("block-1"); err == nil {
		t.Error("database should be deleted after OnDelete")
	}
}
