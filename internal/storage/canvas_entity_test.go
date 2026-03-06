package storage

import (
	"encoding/json"
	"testing"

	"notes/internal/domain"
)

func setupCanvasEntityTest(t *testing.T) (*CanvasEntityStore, *CanvasConnectionStore, string) {
	t.Helper()
	db := newTestDB(t)
	es := NewCanvasEntityStore(db)
	cs := NewCanvasConnectionStore(db)
	ns := NewNotebookStore(db)

	pageID := createPageForBlocks(t, ns)
	return es, cs, pageID
}

// ── CanvasEntityStore CRUD ──────────────────────────────────────

func TestCanvasEntityStore_CreateAndGet(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	e := &domain.CanvasEntity{
		ID: "e1", PageID: pageID, Type: "rectangle",
		X: 10, Y: 20, Width: 100, Height: 50,
		CanvasProps: `{"strokeColor":"#000"}`,
	}
	if err := es.CreateCanvasEntity(e); err != nil {
		t.Fatalf("create: %v", err)
	}

	if e.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}
	if e.RenderMode != domain.RenderCanvas {
		t.Errorf("RenderMode = %q, want canvas", e.RenderMode)
	}

	got, err := es.GetCanvasEntity("e1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Type != "rectangle" {
		t.Errorf("type = %q, want rectangle", got.Type)
	}
	if got.X != 10 || got.Y != 20 {
		t.Errorf("position = (%v, %v), want (10, 20)", got.X, got.Y)
	}
	if got.RenderMode != domain.RenderCanvas {
		t.Errorf("RenderMode = %q, want canvas", got.RenderMode)
	}
	if got.CanvasProps != `{"strokeColor":"#000"}` {
		t.Errorf("CanvasProps = %q", got.CanvasProps)
	}
}

func TestCanvasEntityStore_CreateDOM(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	e := &domain.CanvasEntity{
		ID: "e1", PageID: pageID, Type: "markdown",
		X: 0, Y: 0, Width: 300, Height: 200,
		Content: "# Hello", FilePath: "/tmp/f.md",
	}
	if err := es.CreateCanvasEntity(e); err != nil {
		t.Fatalf("create: %v", err)
	}

	if e.RenderMode != domain.RenderDOM {
		t.Errorf("RenderMode = %q, want dom", e.RenderMode)
	}

	got, err := es.GetCanvasEntity("e1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Content != "# Hello" {
		t.Errorf("content = %q, want # Hello", got.Content)
	}
	if got.RenderMode != domain.RenderDOM {
		t.Errorf("RenderMode = %q, want dom", got.RenderMode)
	}
}

func TestCanvasEntityStore_GetNotFound(t *testing.T) {
	es, _, _ := setupCanvasEntityTest(t)
	_, err := es.GetCanvasEntity("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent entity")
	}
}

func TestCanvasEntityStore_ListEntities(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	// Create 3 entities with different z-indexes (out of order)
	for _, tc := range []struct {
		id string
		z  int
	}{
		{"e3", 20},
		{"e1", 0},
		{"e2", 10},
	} {
		e := &domain.CanvasEntity{
			ID: tc.id, PageID: pageID, Type: "rectangle",
			ZIndex: tc.z, RenderMode: domain.RenderCanvas,
		}
		if err := es.CreateCanvasEntity(e); err != nil {
			t.Fatalf("create %s: %v", tc.id, err)
		}
	}

	entities, err := es.ListCanvasEntities(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entities) != 3 {
		t.Fatalf("len = %d, want 3", len(entities))
	}

	// Should be ordered by z_index ASC
	if entities[0].ID != "e1" || entities[1].ID != "e2" || entities[2].ID != "e3" {
		t.Errorf("order = [%s, %s, %s], want [e1, e2, e3]",
			entities[0].ID, entities[1].ID, entities[2].ID)
	}
}

func TestCanvasEntityStore_ListEntities_Empty(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	entities, err := es.ListCanvasEntities(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if entities != nil {
		t.Errorf("expected nil for empty page, got %v", entities)
	}
}

func TestCanvasEntityStore_UpdateEntity(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	e := &domain.CanvasEntity{
		ID: "e1", PageID: pageID, Type: "rectangle",
		X: 10, Y: 20, Width: 100, Height: 50,
	}
	es.CreateCanvasEntity(e)

	e.X = 50
	e.Width = 200
	e.CanvasProps = `{"strokeColor":"#f00"}`
	if err := es.UpdateCanvasEntity(e); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := es.GetCanvasEntity("e1")
	if got.X != 50 {
		t.Errorf("x = %v, want 50", got.X)
	}
	if got.Width != 200 {
		t.Errorf("width = %v, want 200", got.Width)
	}
	if got.CanvasProps != `{"strokeColor":"#f00"}` {
		t.Errorf("CanvasProps = %q", got.CanvasProps)
	}
	if !got.UpdatedAt.After(got.CreatedAt) {
		t.Error("UpdatedAt should be after CreatedAt")
	}
}

func TestCanvasEntityStore_DeleteEntity(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	e := &domain.CanvasEntity{ID: "e1", PageID: pageID, Type: "rectangle"}
	es.CreateCanvasEntity(e)

	if err := es.DeleteCanvasEntity("e1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := es.GetCanvasEntity("e1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestCanvasEntityStore_DeleteByPage(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	for _, id := range []string{"e1", "e2"} {
		e := &domain.CanvasEntity{ID: id, PageID: pageID, Type: "rectangle"}
		es.CreateCanvasEntity(e)
	}

	if err := es.DeleteCanvasEntitiesByPage(pageID); err != nil {
		t.Fatalf("delete by page: %v", err)
	}

	entities, _ := es.ListCanvasEntities(pageID)
	if len(entities) != 0 {
		t.Errorf("len = %d, want 0", len(entities))
	}
}

func TestCanvasEntityStore_BatchUpdate(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	for _, id := range []string{"e1", "e2"} {
		e := &domain.CanvasEntity{
			ID: id, PageID: pageID, Type: "rectangle",
			X: 0, Y: 0, Width: 100, Height: 100,
		}
		es.CreateCanvasEntity(e)
	}

	updates := []domain.CanvasEntity{
		{ID: "e1", Type: "rectangle", RenderMode: domain.RenderCanvas, X: 100, Y: 200, Width: 100, Height: 100},
		{ID: "e2", Type: "ellipse", RenderMode: domain.RenderCanvas, X: 300, Y: 400, Width: 100, Height: 100},
	}
	if err := es.BatchUpdateCanvasEntities(updates); err != nil {
		t.Fatalf("batch update: %v", err)
	}

	got1, _ := es.GetCanvasEntity("e1")
	if got1.X != 100 || got1.Y != 200 {
		t.Errorf("e1 position = (%v, %v), want (100, 200)", got1.X, got1.Y)
	}

	got2, _ := es.GetCanvasEntity("e2")
	if got2.Type != "ellipse" {
		t.Errorf("e2 type = %q, want ellipse", got2.Type)
	}
	if got2.X != 300 || got2.Y != 400 {
		t.Errorf("e2 position = (%v, %v), want (300, 400)", got2.X, got2.Y)
	}
}

func TestCanvasEntityStore_UpdateZOrder(t *testing.T) {
	es, _, pageID := setupCanvasEntityTest(t)

	for i, id := range []string{"e1", "e2", "e3"} {
		e := &domain.CanvasEntity{
			ID: id, PageID: pageID, Type: "rectangle",
			ZIndex: i, RenderMode: domain.RenderCanvas,
		}
		es.CreateCanvasEntity(e)
	}

	// Reverse order: e3, e1, e2
	if err := es.UpdateEntityZOrder(pageID, []string{"e3", "e1", "e2"}); err != nil {
		t.Fatalf("update z-order: %v", err)
	}

	entities, _ := es.ListCanvasEntities(pageID)
	if len(entities) != 3 {
		t.Fatalf("len = %d, want 3", len(entities))
	}
	// After z-order update: e3=0, e1=1, e2=2
	if entities[0].ID != "e3" || entities[1].ID != "e1" || entities[2].ID != "e2" {
		t.Errorf("order = [%s, %s, %s], want [e3, e1, e2]",
			entities[0].ID, entities[1].ID, entities[2].ID)
	}
}

// ── CanvasConnectionStore CRUD ──────────────────────────────────

func TestCanvasConnectionStore_CreateAndGet(t *testing.T) {
	_, cs, pageID := setupCanvasEntityTest(t)

	c := &domain.CanvasConnection{
		ID: "cc1", PageID: pageID,
		FromEntityID: "e1", ToEntityID: "e2",
		FromSide: "right", FromT: 0.5, ToSide: "left", ToT: 0.5,
		Label: "depends", Color: "#f00", Style: domain.ConnectionStyleDashed,
	}
	if err := cs.CreateCanvasConnection(c); err != nil {
		t.Fatalf("create: %v", err)
	}

	if c.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}

	got, err := cs.GetCanvasConnection("cc1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.FromEntityID != "e1" || got.ToEntityID != "e2" {
		t.Errorf("endpoints = (%q, %q), want (e1, e2)", got.FromEntityID, got.ToEntityID)
	}
	if got.FromSide != "right" || got.ToSide != "left" {
		t.Errorf("sides = (%q, %q), want (right, left)", got.FromSide, got.ToSide)
	}
	if got.Label != "depends" {
		t.Errorf("label = %q, want depends", got.Label)
	}
	if got.Style != domain.ConnectionStyleDashed {
		t.Errorf("style = %v, want dashed", got.Style)
	}
}

func TestCanvasConnectionStore_GetNotFound(t *testing.T) {
	_, cs, _ := setupCanvasEntityTest(t)
	_, err := cs.GetCanvasConnection("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent connection")
	}
}

func TestCanvasConnectionStore_ListConnections(t *testing.T) {
	_, cs, pageID := setupCanvasEntityTest(t)

	for _, id := range []string{"cc1", "cc2"} {
		c := &domain.CanvasConnection{
			ID: id, PageID: pageID,
			FromEntityID: "e1", ToEntityID: "e2",
			Color: "#666", Style: domain.ConnectionStyleSolid,
		}
		cs.CreateCanvasConnection(c)
	}

	conns, err := cs.ListCanvasConnections(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(conns) != 2 {
		t.Fatalf("len = %d, want 2", len(conns))
	}
}

func TestCanvasConnectionStore_UpdateConnection(t *testing.T) {
	_, cs, pageID := setupCanvasEntityTest(t)

	c := &domain.CanvasConnection{
		ID: "cc1", PageID: pageID,
		FromEntityID: "e1", ToEntityID: "e2",
		Label: "old", Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateCanvasConnection(c)

	c.Label = "new"
	c.Color = "#fff"
	c.Style = domain.ConnectionStyleDotted
	c.FromSide = "top"
	c.FromT = 0.3
	if err := cs.UpdateCanvasConnection(c); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := cs.GetCanvasConnection("cc1")
	if got.Label != "new" {
		t.Errorf("label = %q, want new", got.Label)
	}
	if got.Color != "#fff" {
		t.Errorf("color = %q, want #fff", got.Color)
	}
	if got.Style != domain.ConnectionStyleDotted {
		t.Errorf("style = %v, want dotted", got.Style)
	}
	if got.FromSide != "top" {
		t.Errorf("fromSide = %q, want top", got.FromSide)
	}
}

func TestCanvasConnectionStore_DeleteConnection(t *testing.T) {
	_, cs, pageID := setupCanvasEntityTest(t)

	c := &domain.CanvasConnection{
		ID: "cc1", PageID: pageID,
		FromEntityID: "e1", ToEntityID: "e2",
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateCanvasConnection(c)

	if err := cs.DeleteCanvasConnection("cc1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := cs.GetCanvasConnection("cc1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestCanvasConnectionStore_DeleteByPage(t *testing.T) {
	_, cs, pageID := setupCanvasEntityTest(t)

	for _, id := range []string{"cc1", "cc2"} {
		c := &domain.CanvasConnection{
			ID: id, PageID: pageID,
			FromEntityID: "e1", ToEntityID: "e2",
			Color: "#666", Style: domain.ConnectionStyleSolid,
		}
		cs.CreateCanvasConnection(c)
	}

	if err := cs.DeleteCanvasConnectionsByPage(pageID); err != nil {
		t.Fatalf("delete by page: %v", err)
	}

	conns, _ := cs.ListCanvasConnections(pageID)
	if len(conns) != 0 {
		t.Errorf("len = %d, want 0", len(conns))
	}
}

func TestCanvasConnectionStore_DeleteByEntity(t *testing.T) {
	_, cs, pageID := setupCanvasEntityTest(t)

	// e1 → e2
	c1 := &domain.CanvasConnection{
		ID: "cc1", PageID: pageID,
		FromEntityID: "e1", ToEntityID: "e2",
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateCanvasConnection(c1)

	// e2 → e1 (reverse)
	c2 := &domain.CanvasConnection{
		ID: "cc2", PageID: pageID,
		FromEntityID: "e2", ToEntityID: "e1",
		Color: "#666", Style: domain.ConnectionStyleSolid,
	}
	cs.CreateCanvasConnection(c2)

	// Delete connections involving e1
	if err := cs.DeleteCanvasConnectionsByEntity("e1"); err != nil {
		t.Fatalf("delete by entity: %v", err)
	}

	conns, _ := cs.ListCanvasConnections(pageID)
	if len(conns) != 0 {
		t.Errorf("len = %d, want 0 (should delete both from and to connections)", len(conns))
	}
}

// ── MigrateToCanvasEntities ─────────────────────────────────────

func TestMigrateToCanvasEntities_Blocks(t *testing.T) {
	db := newTestDB(t)
	ns := NewNotebookStore(db)
	bs := NewBlockStore(db)
	es := NewCanvasEntityStore(db)

	pageID := createPageForBlocks(t, ns)

	// Create blocks
	for i, id := range []string{"b1", "b2"} {
		b := &domain.Block{
			ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown,
			X: float64(i * 100), Y: float64(i * 50), Width: 300, Height: 200,
			Content: "content-" + id, FilePath: "/tmp/" + id + ".md", StyleJSON: "{}",
		}
		if err := bs.CreateBlock(b); err != nil {
			t.Fatalf("create block %s: %v", id, err)
		}
	}

	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	entities, err := es.ListCanvasEntities(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entities) != 2 {
		t.Fatalf("len = %d, want 2", len(entities))
	}

	// Blocks should be migrated with dom render mode and z_index >= 1000
	for _, e := range entities {
		if e.RenderMode != domain.RenderDOM {
			t.Errorf("entity %s: renderMode = %q, want dom", e.ID, e.RenderMode)
		}
		if e.ZIndex < 1000 {
			t.Errorf("entity %s: zIndex = %d, want >= 1000", e.ID, e.ZIndex)
		}
		if e.Content == "" {
			t.Errorf("entity %s: content should not be empty", e.ID)
		}
	}
}

func TestMigrateToCanvasEntities_DrawingElements(t *testing.T) {
	db := newTestDB(t)
	ns := NewNotebookStore(db)
	es := NewCanvasEntityStore(db)

	pageID := createPageForBlocks(t, ns)

	// Insert drawing data into pages
	elements := []domain.DrawingElement{
		{
			ID: "d1", Type: "rectangle",
			X: 10, Y: 20, Width: 100, Height: 50,
			StrokeColor: "#000", StrokeWidth: 2, BackgroundColor: "#fff",
		},
		{
			ID: "d2", Type: "ellipse",
			X: 200, Y: 300, Width: 80, Height: 80,
			StrokeColor: "#f00", StrokeWidth: 1, BackgroundColor: "transparent",
		},
	}
	drawingJSON, _ := json.Marshal(elements)
	_, err := db.Conn().Exec(`UPDATE pages SET drawing_data = ? WHERE id = ?`, string(drawingJSON), pageID)
	if err != nil {
		t.Fatalf("set drawing_data: %v", err)
	}

	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	entities, err := es.ListCanvasEntities(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entities) != 2 {
		t.Fatalf("len = %d, want 2", len(entities))
	}

	// Drawing elements should have canvas render mode
	for _, e := range entities {
		if e.RenderMode != domain.RenderCanvas {
			t.Errorf("entity %s: renderMode = %q, want canvas", e.ID, e.RenderMode)
		}
	}

	// Check canvas_props contains drawing properties
	var props map[string]any
	if err := json.Unmarshal([]byte(entities[0].CanvasProps), &props); err != nil {
		t.Fatalf("unmarshal canvas_props: %v", err)
	}
	if props["strokeColor"] != "#000" {
		t.Errorf("strokeColor = %v, want #000", props["strokeColor"])
	}
	if props["backgroundColor"] != "#fff" {
		t.Errorf("backgroundColor = %v, want #fff", props["backgroundColor"])
	}
}

func TestMigrateToCanvasEntities_Connections(t *testing.T) {
	db := newTestDB(t)
	ns := NewNotebookStore(db)
	bs := NewBlockStore(db)
	oldCS := NewConnectionStore(db)
	newCS := NewCanvasConnectionStore(db)

	pageID := createPageForBlocks(t, ns)

	// Create blocks and connection
	for _, id := range []string{"b1", "b2"} {
		b := &domain.Block{ID: id, PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
		bs.CreateBlock(b)
	}
	conn := &domain.Connection{
		ID: "c1", PageID: pageID,
		FromBlockID: "b1", ToBlockID: "b2",
		Label: "depends", Color: "#f00", Style: domain.ConnectionStyleDashed,
	}
	oldCS.CreateConnection(conn)

	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	conns, err := newCS.ListCanvasConnections(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(conns) != 1 {
		t.Fatalf("len = %d, want 1", len(conns))
	}

	cc := conns[0]
	if cc.FromEntityID != "b1" || cc.ToEntityID != "b2" {
		t.Errorf("endpoints = (%q, %q), want (b1, b2)", cc.FromEntityID, cc.ToEntityID)
	}
	if cc.Label != "depends" {
		t.Errorf("label = %q, want depends", cc.Label)
	}
	if cc.Color != "#f00" {
		t.Errorf("color = %q, want #f00", cc.Color)
	}
}

func TestMigrateToCanvasEntities_Idempotent(t *testing.T) {
	db := newTestDB(t)
	ns := NewNotebookStore(db)
	bs := NewBlockStore(db)
	es := NewCanvasEntityStore(db)

	pageID := createPageForBlocks(t, ns)

	b := &domain.Block{ID: "b1", PageID: pageID, Type: domain.BlockTypeMarkdown, StyleJSON: "{}"}
	bs.CreateBlock(b)

	// Run migration twice
	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("second migrate: %v", err)
	}

	// Should only have 1 entity, not 2
	entities, _ := es.ListCanvasEntities(pageID)
	if len(entities) != 1 {
		t.Errorf("len = %d, want 1 (idempotent check)", len(entities))
	}
}

func TestMigrateToCanvasEntities_Mixed(t *testing.T) {
	db := newTestDB(t)
	ns := NewNotebookStore(db)
	bs := NewBlockStore(db)
	es := NewCanvasEntityStore(db)

	pageID := createPageForBlocks(t, ns)

	// Add a block
	b := &domain.Block{
		ID: "b1", PageID: pageID, Type: domain.BlockTypeMarkdown,
		X: 0, Y: 0, Width: 300, Height: 200,
		Content: "hello", StyleJSON: "{}",
	}
	bs.CreateBlock(b)

	// Add drawing elements
	elements := []domain.DrawingElement{
		{ID: "d1", Type: "rectangle", X: 500, Y: 500, Width: 100, Height: 100,
			StrokeColor: "#000", StrokeWidth: 1},
	}
	drawingJSON, _ := json.Marshal(elements)
	db.Conn().Exec(`UPDATE pages SET drawing_data = ? WHERE id = ?`, string(drawingJSON), pageID)

	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	entities, _ := es.ListCanvasEntities(pageID)
	if len(entities) != 2 {
		t.Fatalf("len = %d, want 2", len(entities))
	}

	// Drawing element should come first (lower z-index)
	if entities[0].RenderMode != domain.RenderCanvas {
		t.Errorf("first entity renderMode = %q, want canvas", entities[0].RenderMode)
	}
	if entities[1].RenderMode != domain.RenderDOM {
		t.Errorf("second entity renderMode = %q, want dom", entities[1].RenderMode)
	}

	// Block entity should have z_index >= 1000
	if entities[1].ZIndex < 1000 {
		t.Errorf("block entity zIndex = %d, want >= 1000", entities[1].ZIndex)
	}
}

func TestMigrateToCanvasEntities_EmptyPage(t *testing.T) {
	db := newTestDB(t)
	ns := NewNotebookStore(db)
	es := NewCanvasEntityStore(db)

	pageID := createPageForBlocks(t, ns)

	if err := db.MigrateToCanvasEntities(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	entities, _ := es.ListCanvasEntities(pageID)
	if len(entities) != 0 {
		t.Errorf("len = %d, want 0", len(entities))
	}
}
