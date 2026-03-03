package storage

import (
	"testing"

	"notes/internal/domain"
)

func setupConnectionTest(t *testing.T) (*ConnectionStore, *BlockStore, string) {
	t.Helper()
	db := newTestDB(t)
	cs := NewConnectionStore(db)
	bs := NewBlockStore(db)
	ns := NewNotebookStore(db)

	pageID := createPageForBlocks(t, ns)

	// Create 2 blocks for connections
	for _, id := range []string{"b1", "b2"} {
		b := &domain.Block{ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
		if err := bs.CreateBlock(b); err != nil {
			t.Fatalf("create block %s: %v", id, err)
		}
	}

	return cs, bs, pageID
}

func TestConnectionStore_CreateAndGet(t *testing.T) {
	cs, _, pageID := setupConnectionTest(t)

	c := &domain.Connection{
		ID: "conn-1", PageID: pageID,
		FromBlockID: "b1", ToBlockID: "b2",
		Label: "depends on", Color: "#ff0000", Style: domain.ConnectionStyleDashed,
	}
	if err := cs.CreateConnection(c); err != nil {
		t.Fatalf("create: %v", err)
	}

	if c.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}

	got, err := cs.GetConnection("conn-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Label != "depends on" {
		t.Errorf("label = %q, want %q", got.Label, "depends on")
	}
	if got.Color != "#ff0000" {
		t.Errorf("color = %q, want #ff0000", got.Color)
	}
	if got.Style != domain.ConnectionStyleDashed {
		t.Errorf("style = %v, want dashed", got.Style)
	}
	if got.FromBlockID != "b1" || got.ToBlockID != "b2" {
		t.Errorf("endpoints = (%q, %q), want (b1, b2)", got.FromBlockID, got.ToBlockID)
	}
}

func TestConnectionStore_GetNotFound(t *testing.T) {
	db := newTestDB(t)
	cs := NewConnectionStore(db)
	_, err := cs.GetConnection("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent connection")
	}
}

func TestConnectionStore_ListConnections(t *testing.T) {
	cs, _, pageID := setupConnectionTest(t)

	for _, id := range []string{"c1", "c2"} {
		c := &domain.Connection{
			ID: id, PageID: pageID, FromBlockID: "b1", ToBlockID: "b2",
			Color: "#666", Style: domain.ConnectionStyleSolid,
		}
		if err := cs.CreateConnection(c); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}

	conns, err := cs.ListConnections(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(conns) != 2 {
		t.Fatalf("len = %d, want 2", len(conns))
	}
}

func TestConnectionStore_UpdateConnection(t *testing.T) {
	cs, _, pageID := setupConnectionTest(t)

	c := &domain.Connection{
		ID: "conn-1", PageID: pageID, FromBlockID: "b1", ToBlockID: "b2",
		Label: "old", Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(c)

	c.Label = "new"
	c.Color = "#fff"
	c.Style = domain.ConnectionStyleDotted
	if err := cs.UpdateConnection(c); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := cs.GetConnection("conn-1")
	if got.Label != "new" {
		t.Errorf("label = %q, want new", got.Label)
	}
	if got.Style != domain.ConnectionStyleDotted {
		t.Errorf("style = %v, want dotted", got.Style)
	}
}

func TestConnectionStore_DeleteConnection(t *testing.T) {
	cs, _, pageID := setupConnectionTest(t)

	c := &domain.Connection{
		ID: "conn-1", PageID: pageID, FromBlockID: "b1", ToBlockID: "b2",
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(c)

	if err := cs.DeleteConnection("conn-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := cs.GetConnection("conn-1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestConnectionStore_DeleteConnectionsByPage(t *testing.T) {
	cs, _, pageID := setupConnectionTest(t)

	for _, id := range []string{"c1", "c2"} {
		c := &domain.Connection{
			ID: id, PageID: pageID, FromBlockID: "b1", ToBlockID: "b2",
			Color: "#666", Style: domain.ConnectionStyleSolid,
		}
		cs.CreateConnection(c)
	}

	if err := cs.DeleteConnectionsByPage(pageID); err != nil {
		t.Fatalf("delete by page: %v", err)
	}

	conns, _ := cs.ListConnections(pageID)
	if len(conns) != 0 {
		t.Errorf("len = %d, want 0", len(conns))
	}
}

func TestConnectionStore_DeleteConnectionsByBlock(t *testing.T) {
	cs, _, pageID := setupConnectionTest(t)

	// b1 → b2
	c1 := &domain.Connection{
		ID: "c1", PageID: pageID, FromBlockID: "b1", ToBlockID: "b2",
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(c1)

	// b2 → b1 (reverse)
	c2 := &domain.Connection{
		ID: "c2", PageID: pageID, FromBlockID: "b2", ToBlockID: "b1",
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(c2)

	// Delete connections involving b1 (both from and to)
	if err := cs.DeleteConnectionsByBlock("b1"); err != nil {
		t.Fatalf("delete by block: %v", err)
	}

	conns, _ := cs.ListConnections(pageID)
	if len(conns) != 0 {
		t.Errorf("len = %d, want 0 (should delete both from and to connections)", len(conns))
	}
}
