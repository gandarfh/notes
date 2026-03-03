package service

import (
	"testing"

	"notes/internal/domain"
	"notes/internal/storage"
	"notes/internal/testutil"
)

func newNotebookService(t *testing.T) (*NotebookService, *BlockService) {
	t.Helper()
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)
	return notebookSvc, blockSvc
}

// ── Notebook Tests ──────────────────────────────────────────

func TestNotebookService_CreateNotebook(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, err := svc.CreateNotebook("My Notebook")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if nb.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if nb.Name != "My Notebook" {
		t.Errorf("name = %q", nb.Name)
	}
	if nb.Icon != "📓" {
		t.Errorf("icon = %q, want default 📓", nb.Icon)
	}
}

func TestNotebookService_ListNotebooks(t *testing.T) {
	svc, _ := newNotebookService(t)

	svc.CreateNotebook("A")
	svc.CreateNotebook("B")

	list, err := svc.ListNotebooks()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
}

func TestNotebookService_RenameNotebook(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Old")
	if err := svc.RenameNotebook(nb.ID, "New"); err != nil {
		t.Fatalf("rename: %v", err)
	}

	list, _ := svc.ListNotebooks()
	if list[0].Name != "New" {
		t.Errorf("name = %q, want New", list[0].Name)
	}
}

func TestNotebookService_DeleteNotebook_CascadesEverything(t *testing.T) {
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)

	nb, _ := notebookSvc.CreateNotebook("Test")
	page, _ := notebookSvc.CreatePage(nb.ID, "Page 1")

	// Create blocks on the page
	b1, _ := blockSvc.CreateBlock(page.ID, "markdown", 0, 0, 300, 200)
	b2, _ := blockSvc.CreateBlock(page.ID, "code", 400, 0, 300, 200)

	// Create a connection
	conn := &domain.Connection{
		ID: "conn-1", PageID: page.ID,
		FromBlockID: b1.ID, ToBlockID: b2.ID,
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(conn)

	// Delete notebook — should cascade everything
	if err := notebookSvc.DeleteNotebook(nb.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// Verify everything is gone
	notebooks, _ := notebookSvc.ListNotebooks()
	if len(notebooks) != 0 {
		t.Errorf("notebooks = %d, want 0", len(notebooks))
	}

	pages, _ := notebookSvc.ListPages(nb.ID)
	if len(pages) != 0 {
		t.Errorf("pages = %d, want 0", len(pages))
	}

	blocks, _ := blockSvc.ListBlocks(page.ID)
	if len(blocks) != 0 {
		t.Errorf("blocks = %d, want 0", len(blocks))
	}

	conns, _ := cs.ListConnections(page.ID)
	if len(conns) != 0 {
		t.Errorf("connections = %d, want 0", len(conns))
	}
}

// ── Page Tests ──────────────────────────────────────────────

func TestNotebookService_CreatePage(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Test")
	page, err := svc.CreatePage(nb.ID, "Page 1")
	if err != nil {
		t.Fatalf("create page: %v", err)
	}

	if page.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if page.Name != "Page 1" {
		t.Errorf("name = %q", page.Name)
	}
	if page.ViewportZoom != 1.0 {
		t.Errorf("zoom = %v, want 1.0", page.ViewportZoom)
	}
	if page.NotebookID != nb.ID {
		t.Errorf("notebookID = %q", page.NotebookID)
	}
}

func TestNotebookService_ListPages(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Test")
	svc.CreatePage(nb.ID, "A")
	svc.CreatePage(nb.ID, "B")

	pages, err := svc.ListPages(nb.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(pages) != 2 {
		t.Fatalf("len = %d, want 2", len(pages))
	}
}

func TestNotebookService_GetPageState(t *testing.T) {
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)

	nb, _ := notebookSvc.CreateNotebook("Test")
	page, _ := notebookSvc.CreatePage(nb.ID, "Page")

	b1, _ := blockSvc.CreateBlock(page.ID, "markdown", 0, 0, 300, 200)
	b2, _ := blockSvc.CreateBlock(page.ID, "code", 400, 0, 300, 200)

	conn := &domain.Connection{
		ID: "c1", PageID: page.ID,
		FromBlockID: b1.ID, ToBlockID: b2.ID,
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(conn)

	state, err := notebookSvc.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}

	if state.Page.ID != page.ID {
		t.Errorf("page id = %q", state.Page.ID)
	}
	if len(state.Blocks) != 2 {
		t.Errorf("blocks len = %d, want 2", len(state.Blocks))
	}
	if len(state.Connections) != 1 {
		t.Errorf("connections len = %d, want 1", len(state.Connections))
	}
}

func TestNotebookService_GetPageState_EmptyPage(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Test")
	page, _ := svc.CreatePage(nb.ID, "Empty")

	state, err := svc.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	// Should return empty slices, not nil
	if state.Blocks == nil {
		t.Error("Blocks should be empty slice, not nil")
	}
	if state.Connections == nil {
		t.Error("Connections should be empty slice, not nil")
	}
	if len(state.Blocks) != 0 {
		t.Errorf("blocks = %d", len(state.Blocks))
	}
}

func TestNotebookService_RenamePage(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Test")
	page, _ := svc.CreatePage(nb.ID, "Old")

	if err := svc.RenamePage(page.ID, "New"); err != nil {
		t.Fatalf("rename: %v", err)
	}

	state, _ := svc.GetPageState(page.ID)
	if state.Page.Name != "New" {
		t.Errorf("name = %q", state.Page.Name)
	}
}

func TestNotebookService_UpdateViewport(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Test")
	page, _ := svc.CreatePage(nb.ID, "Page")

	if err := svc.UpdateViewport(page.ID, 500, 600, 2.0); err != nil {
		t.Fatalf("update viewport: %v", err)
	}

	state, _ := svc.GetPageState(page.ID)
	if state.Page.ViewportX != 500 || state.Page.ViewportY != 600 {
		t.Errorf("viewport = (%v, %v)", state.Page.ViewportX, state.Page.ViewportY)
	}
	if state.Page.ViewportZoom != 2.0 {
		t.Errorf("zoom = %v", state.Page.ViewportZoom)
	}
}

func TestNotebookService_UpdateDrawingData(t *testing.T) {
	svc, _ := newNotebookService(t)

	nb, _ := svc.CreateNotebook("Test")
	page, _ := svc.CreatePage(nb.ID, "Page")

	data := `{"shapes":[{"type":"rect"}]}`
	if err := svc.UpdateDrawingData(page.ID, data); err != nil {
		t.Fatalf("update drawing: %v", err)
	}

	state, _ := svc.GetPageState(page.ID)
	if state.Page.DrawingData != data {
		t.Errorf("drawing = %q", state.Page.DrawingData)
	}
}

func TestNotebookService_DeletePage_CascadesBlocksAndConnections(t *testing.T) {
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)

	nb, _ := notebookSvc.CreateNotebook("Test")
	page, _ := notebookSvc.CreatePage(nb.ID, "Page")

	b1, _ := blockSvc.CreateBlock(page.ID, "markdown", 0, 0, 300, 200)
	b2, _ := blockSvc.CreateBlock(page.ID, "code", 400, 0, 300, 200)

	conn := &domain.Connection{
		ID: "c1", PageID: page.ID,
		FromBlockID: b1.ID, ToBlockID: b2.ID,
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateConnection(conn)

	if err := notebookSvc.DeletePage(page.ID); err != nil {
		t.Fatalf("delete page: %v", err)
	}

	blocks, _ := blockSvc.ListBlocks(page.ID)
	if len(blocks) != 0 {
		t.Errorf("blocks = %d, want 0", len(blocks))
	}

	conns, _ := cs.ListConnections(page.ID)
	if len(conns) != 0 {
		t.Errorf("connections = %d, want 0", len(conns))
	}
}
