package storage

import (
	"testing"

	"notes/internal/domain"
)

func newBlockStore(t *testing.T) (*BlockStore, *NotebookStore) {
	t.Helper()
	db := newTestDB(t)
	return NewBlockStore(db), NewNotebookStore(db)
}

// createPageForBlocks is a helper that creates a notebook and page, returning the page ID.
func createPageForBlocks(t *testing.T, ns *NotebookStore) string {
	t.Helper()
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	if err := ns.CreateNotebook(nb); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	p := &domain.Page{ID: "page-1", NotebookID: "nb-1", Name: "Page 1", ViewportZoom: 1.0}
	if err := ns.CreatePage(p); err != nil {
		t.Fatalf("create page: %v", err)
	}
	return p.ID
}

func TestBlockStore_CreateAndGet(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	b := &domain.Block{
		ID: "block-1", PageID: pageID, Type: domain.BlockTypeMarkdown,
		X: 10, Y: 20, Width: 300, Height: 200,
		Content: "hello", FilePath: "/tmp/f.md", StyleJSON: "{}",
	}
	if err := bs.CreateBlock(b); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Timestamps should be set
	if b.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}
	if b.UpdatedAt.IsZero() {
		t.Error("UpdatedAt not set")
	}

	got, err := bs.GetBlock("block-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Content != "hello" {
		t.Errorf("content = %q, want %q", got.Content, "hello")
	}
	if got.X != 10 || got.Y != 20 {
		t.Errorf("position = (%v, %v), want (10, 20)", got.X, got.Y)
	}
	if got.Type != domain.BlockTypeMarkdown {
		t.Errorf("type = %v, want markdown", got.Type)
	}
}

func TestBlockStore_GetNotFound(t *testing.T) {
	bs, _ := newBlockStore(t)
	_, err := bs.GetBlock("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent block")
	}
}

func TestBlockStore_ListBlocks(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	// Create 3 blocks
	for i, id := range []string{"b1", "b2", "b3"} {
		b := &domain.Block{
			ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown,
			X: float64(i * 100), Y: 0, Width: 300, Height: 200,
			Content: id, StyleJSON: "{}",
		}
		if err := bs.CreateBlock(b); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}

	blocks, err := bs.ListBlocks(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(blocks) != 3 {
		t.Fatalf("len = %d, want 3", len(blocks))
	}

	// Should be ordered by created_at ASC
	if blocks[0].ID != "b1" || blocks[1].ID != "b2" || blocks[2].ID != "b3" {
		t.Error("blocks not ordered by created_at ASC")
	}
}

func TestBlockStore_ListBlocks_EmptyPage(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	blocks, err := bs.ListBlocks(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if blocks != nil {
		t.Errorf("expected nil for empty page, got %v", blocks)
	}
}

func TestBlockStore_UpdateBlock(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	b := &domain.Block{
		ID: "block-1", PageID: pageID, Type: domain.BlockTypeMarkdown,
		X: 10, Y: 20, Width: 300, Height: 200, Content: "old", StyleJSON: "{}",
	}
	if err := bs.CreateBlock(b); err != nil {
		t.Fatalf("create: %v", err)
	}

	b.Content = "new"
	b.X = 50
	if err := bs.UpdateBlock(b); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err := bs.GetBlock("block-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Content != "new" {
		t.Errorf("content = %q, want %q", got.Content, "new")
	}
	if got.X != 50 {
		t.Errorf("x = %v, want 50", got.X)
	}
	if !got.UpdatedAt.After(got.CreatedAt) {
		t.Error("UpdatedAt should be after CreatedAt")
	}
}

func TestBlockStore_DeleteBlock(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	b := &domain.Block{ID: "block-1", PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
	if err := bs.CreateBlock(b); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := bs.DeleteBlock("block-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := bs.GetBlock("block-1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestBlockStore_DeleteBlocksByPage(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	for _, id := range []string{"b1", "b2"} {
		b := &domain.Block{ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
		if err := bs.CreateBlock(b); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	if err := bs.DeleteBlocksByPage(pageID); err != nil {
		t.Fatalf("delete by page: %v", err)
	}

	blocks, err := bs.ListBlocks(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(blocks) != 0 {
		t.Errorf("len = %d, want 0", len(blocks))
	}
}

func TestBlockStore_ReplacePageBlocks(t *testing.T) {
	bs, ns := newBlockStore(t)
	db := newTestDB(t)
	_ = db
	pageID := createPageForBlocks(t, ns)

	// Create initial blocks
	for _, id := range []string{"b1", "b2"} {
		b := &domain.Block{ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown, Content: "old", StyleJSON: "{}"}
		if err := bs.CreateBlock(b); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	// Replace with new set
	newBlocks := []domain.Block{
		{ID: "b3", Type: domain.BlockTypeCode, Content: "new", Width: 400, Height: 300, StyleJSON: "{}"},
	}
	if err := bs.ReplacePageBlocks(pageID, newBlocks); err != nil {
		t.Fatalf("replace: %v", err)
	}

	blocks, err := bs.ListBlocks(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(blocks) != 1 {
		t.Fatalf("len = %d, want 1", len(blocks))
	}
	if blocks[0].ID != "b3" {
		t.Errorf("id = %q, want b3", blocks[0].ID)
	}
	if blocks[0].Content != "new" {
		t.Errorf("content = %q, want new", blocks[0].Content)
	}
}

func TestBlockStore_ReplacePageBlocks_AlsoDeletesConnections(t *testing.T) {
	db := newTestDB(t)
	bs := NewBlockStore(db)
	ns := NewNotebookStore(db)
	cs := NewConnectionStore(db)

	pageID := createPageForBlocks(t, ns)

	// Create 2 blocks
	for _, id := range []string{"b1", "b2"} {
		b := &domain.Block{ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
		if err := bs.CreateBlock(b); err != nil {
			t.Fatalf("create block: %v", err)
		}
	}

	// Create a connection between them
	c := &domain.Connection{
		ID: "conn-1", PageID: pageID,
		FromBlockID: "b1", ToBlockID: "b2",
		Label: "test", Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	if err := cs.CreateConnection(c); err != nil {
		t.Fatalf("create connection: %v", err)
	}

	// Replace blocks - should also delete connections
	if err := bs.ReplacePageBlocks(pageID, nil); err != nil {
		t.Fatalf("replace: %v", err)
	}

	conns, err := cs.ListConnections(pageID)
	if err != nil {
		t.Fatalf("list connections: %v", err)
	}
	if len(conns) != 0 {
		t.Errorf("connections len = %d, want 0 (ReplacePageBlocks should delete connections)", len(conns))
	}
}

func TestBlockStore_ReplacePageBlocks_EmptySlice(t *testing.T) {
	bs, ns := newBlockStore(t)
	pageID := createPageForBlocks(t, ns)

	b := &domain.Block{ID: "b1", PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
	if err := bs.CreateBlock(b); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := bs.ReplacePageBlocks(pageID, nil); err != nil {
		t.Fatalf("replace with nil: %v", err)
	}

	blocks, err := bs.ListBlocks(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(blocks) != 0 {
		t.Errorf("len = %d, want 0", len(blocks))
	}
}
