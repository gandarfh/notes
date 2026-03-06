package service

import (
	"testing"

	"notes/internal/domain"
	"notes/internal/storage"
	"notes/internal/testutil"
)

func newCanvasEntityService(t *testing.T) (*CanvasEntityService, *storage.NotebookStore) {
	t.Helper()
	db := testutil.NewTestDB(t)
	es := storage.NewCanvasEntityStore(db)
	cs := storage.NewCanvasConnectionStore(db)
	ns := storage.NewNotebookStore(db)
	emitter := &MockEmitter{}
	svc := NewCanvasEntityService(es, cs, emitter)
	return svc, ns
}

func createCanvasTestPage(t *testing.T, ns *storage.NotebookStore) string {
	t.Helper()
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	if err := ns.CreateNotebook(nb); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	p := &domain.Page{ID: "page-1", NotebookID: "nb-1", Name: "Page", ViewportZoom: 1.0}
	if err := ns.CreatePage(p); err != nil {
		t.Fatalf("create page: %v", err)
	}
	return p.ID
}

// ── Entity CRUD ─────────────────────────────────────────────

func TestCanvasEntityService_CreateEntity_Canvas(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e, err := svc.CreateEntity(pageID, "rectangle", 10, 20, 100, 50)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if e.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if e.RenderMode != domain.RenderCanvas {
		t.Errorf("renderMode = %q, want canvas", e.RenderMode)
	}
	if e.X != 10 || e.Y != 20 {
		t.Errorf("position = (%v, %v)", e.X, e.Y)
	}
}

func TestCanvasEntityService_CreateEntity_DOM(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e, err := svc.CreateEntity(pageID, "markdown", 0, 0, 300, 200)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if e.RenderMode != domain.RenderDOM {
		t.Errorf("renderMode = %q, want dom", e.RenderMode)
	}
}

func TestCanvasEntityService_GetEntity(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	created, _ := svc.CreateEntity(pageID, "ellipse", 0, 0, 100, 100)

	got, err := svc.GetEntity(created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Type != "ellipse" {
		t.Errorf("type = %q, want ellipse", got.Type)
	}
}

func TestCanvasEntityService_ListEntities(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	svc.CreateEntity(pageID, "markdown", 200, 0, 300, 200)

	entities, err := svc.ListEntities(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entities) != 2 {
		t.Fatalf("len = %d, want 2", len(entities))
	}
}

func TestCanvasEntityService_UpdateEntity(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)

	newX := 500.0
	newContent := "hello"
	patch := domain.CanvasEntityPatch{
		X:       &newX,
		Content: &newContent,
	}
	if err := svc.UpdateEntity(e.ID, patch); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := svc.GetEntity(e.ID)
	if got.X != 500 {
		t.Errorf("x = %v, want 500", got.X)
	}
	if got.Content != "hello" {
		t.Errorf("content = %q, want hello", got.Content)
	}
}

func TestCanvasEntityService_DeleteEntity(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)

	if err := svc.DeleteEntity(e.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := svc.GetEntity(e.ID)
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestCanvasEntityService_DeleteEntity_CascadesConnections(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 200, 0, 100, 100)
	svc.CreateConnection(pageID, e1.ID, e2.ID)

	if err := svc.DeleteEntity(e1.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	conns, _ := svc.ListConnections(pageID)
	if len(conns) != 0 {
		t.Errorf("connections len = %d, want 0 (cascade delete)", len(conns))
	}
}

func TestCanvasEntityService_BatchUpdate(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 0, 0, 100, 100)

	newX1, newX2 := 100.0, 200.0
	patches := []domain.CanvasEntityPatchWithID{
		{ID: e1.ID, Patch: domain.CanvasEntityPatch{X: &newX1}},
		{ID: e2.ID, Patch: domain.CanvasEntityPatch{X: &newX2}},
	}
	if err := svc.BatchUpdateEntities(patches); err != nil {
		t.Fatalf("batch update: %v", err)
	}

	got1, _ := svc.GetEntity(e1.ID)
	got2, _ := svc.GetEntity(e2.ID)
	if got1.X != 100 {
		t.Errorf("e1.x = %v, want 100", got1.X)
	}
	if got2.X != 200 {
		t.Errorf("e2.x = %v, want 200", got2.X)
	}
}

func TestCanvasEntityService_UpdateZOrder(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 0, 0, 100, 100)
	e3, _ := svc.CreateEntity(pageID, "diamond", 0, 0, 100, 100)

	// Reverse order
	if err := svc.UpdateZOrder(pageID, []string{e3.ID, e2.ID, e1.ID}); err != nil {
		t.Fatalf("update z-order: %v", err)
	}

	entities, _ := svc.ListEntities(pageID)
	if entities[0].ID != e3.ID {
		t.Errorf("first = %q, want %q", entities[0].ID, e3.ID)
	}
	if entities[2].ID != e1.ID {
		t.Errorf("last = %q, want %q", entities[2].ID, e1.ID)
	}
}

// ── Connection CRUD ─────────────────────────────────────────

func TestCanvasEntityService_CreateConnection(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 200, 0, 100, 100)

	c, err := svc.CreateConnection(pageID, e1.ID, e2.ID)
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}

	if c.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if c.FromEntityID != e1.ID || c.ToEntityID != e2.ID {
		t.Errorf("endpoints = (%q, %q)", c.FromEntityID, c.ToEntityID)
	}
	if c.Color != "#666666" {
		t.Errorf("default color = %q", c.Color)
	}
}

func TestCanvasEntityService_ListConnections(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 200, 0, 100, 100)

	svc.CreateConnection(pageID, e1.ID, e2.ID)
	svc.CreateConnection(pageID, e2.ID, e1.ID)

	conns, err := svc.ListConnections(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(conns) != 2 {
		t.Fatalf("len = %d, want 2", len(conns))
	}
}

func TestCanvasEntityService_UpdateConnection(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 200, 0, 100, 100)

	c, _ := svc.CreateConnection(pageID, e1.ID, e2.ID)

	c.Label = "updated"
	c.Color = "#ff0000"
	c.Style = domain.ConnectionStyleDashed
	if err := svc.UpdateConnection(c); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := svc.GetConnection(c.ID)
	if got.Label != "updated" {
		t.Errorf("label = %q, want updated", got.Label)
	}
	if got.Color != "#ff0000" {
		t.Errorf("color = %q", got.Color)
	}
}

func TestCanvasEntityService_DeleteConnection(t *testing.T) {
	svc, ns := newCanvasEntityService(t)
	pageID := createCanvasTestPage(t, ns)

	e1, _ := svc.CreateEntity(pageID, "rectangle", 0, 0, 100, 100)
	e2, _ := svc.CreateEntity(pageID, "ellipse", 200, 0, 100, 100)

	c, _ := svc.CreateConnection(pageID, e1.ID, e2.ID)

	if err := svc.DeleteConnection(c.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := svc.GetConnection(c.ID)
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

// ── PageState integration ───────────────────────────────────

func TestGetPageState_IncludesEntities(t *testing.T) {
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	es := storage.NewCanvasEntityStore(db)
	cc := storage.NewCanvasConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)
	notebookSvc.SetCanvasStores(es, cc)

	nb, _ := notebookSvc.CreateNotebook("Test")
	page, _ := notebookSvc.CreatePage(nb.ID, "Page")

	// Create a canvas entity
	entitySvc := NewCanvasEntityService(es, cc, emitter)
	e1, _ := entitySvc.CreateEntity(page.ID, "rectangle", 10, 20, 100, 50)
	e2, _ := entitySvc.CreateEntity(page.ID, "markdown", 200, 0, 300, 200)
	entitySvc.CreateConnection(page.ID, e1.ID, e2.ID)

	state, err := notebookSvc.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}

	if len(state.Entities) != 2 {
		t.Errorf("entities len = %d, want 2", len(state.Entities))
	}
	if len(state.CanvasConnections) != 1 {
		t.Errorf("canvas connections len = %d, want 1", len(state.CanvasConnections))
	}
}

func TestGetPageState_EntitiesEmptySlice(t *testing.T) {
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	es := storage.NewCanvasEntityStore(db)
	cc := storage.NewCanvasConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)
	notebookSvc.SetCanvasStores(es, cc)

	nb, _ := notebookSvc.CreateNotebook("Test")
	page, _ := notebookSvc.CreatePage(nb.ID, "Page")

	state, err := notebookSvc.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}

	if state.Entities == nil {
		t.Error("Entities should be empty slice, not nil")
	}
	if state.CanvasConnections == nil {
		t.Error("CanvasConnections should be empty slice, not nil")
	}
}
