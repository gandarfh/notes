package service

import (
	"context"
	"strings"
	"sync"
	"testing"

	"notes/internal/domain"
	"notes/internal/storage"
	"notes/internal/testutil"
)

func newDrawingService(t *testing.T) (*DrawingService, *NotebookService, *MockEmitter) {
	t.Helper()
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	cs := storage.NewConnectionStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	blockSvc := NewBlockService(bs, dataDir, emitter)
	notebookSvc := NewNotebookService(ns, blockSvc, cs, dataDir, emitter)
	drawingSvc := NewDrawingService(notebookSvc)
	return drawingSvc, notebookSvc, emitter
}

// createDrawingTestPage creates a notebook + page and returns the page ID.
func createDrawingTestPage(t *testing.T, notebookSvc *NotebookService) string {
	t.Helper()
	nb, err := notebookSvc.CreateNotebook("test")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := notebookSvc.CreatePage(nb.ID, "test-page")
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	return page.ID
}

// ═══════════════════════════════════════════════════════════════
// AddElement + GetElements
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_AddAndGet(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	el := domain.DrawingElement{
		ID:              "el_1",
		Type:            domain.DrawingTypeRectangle,
		X:               100,
		Y:               200,
		Width:           300,
		Height:          150,
		StrokeColor:     "#e8e8f0",
		StrokeWidth:     2,
		BackgroundColor: "transparent",
	}

	if err := svc.AddElement(ctx, pageID, el); err != nil {
		t.Fatalf("add: %v", err)
	}

	elements, err := svc.GetElements(pageID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(elements) != 1 {
		t.Fatalf("len = %d, want 1", len(elements))
	}
	if elements[0].ID != "el_1" || elements[0].Type != domain.DrawingTypeRectangle {
		t.Errorf("element mismatch: %+v", elements[0])
	}
	if elements[0].X != 100 || elements[0].Width != 300 {
		t.Errorf("position/size mismatch: x=%v w=%v", elements[0].X, elements[0].Width)
	}
}

func TestDrawingService_GetElements_EmptyPage(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)

	elements, err := svc.GetElements(pageID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if elements != nil {
		t.Errorf("empty page should return nil, got %v", elements)
	}
}

func TestDrawingService_GetElements_InvalidPage(t *testing.T) {
	svc, _, _ := newDrawingService(t)

	_, err := svc.GetElements("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent page")
	}
}

// ═══════════════════════════════════════════════════════════════
// AddElements (batch)
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_AddElements(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	els := []domain.DrawingElement{
		{ID: "a", Type: domain.DrawingTypeRectangle, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "b", Type: domain.DrawingTypeEllipse, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "c", Type: domain.DrawingTypeText, StrokeColor: "#000", BackgroundColor: "transparent"},
	}

	if err := svc.AddElements(ctx, pageID, els); err != nil {
		t.Fatalf("add: %v", err)
	}

	got, _ := svc.GetElements(pageID)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
}

// ═══════════════════════════════════════════════════════════════
// FindElement
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_FindElement(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElement(ctx, pageID, domain.DrawingElement{
		ID: "target", Type: domain.DrawingTypeRectangle, X: 42,
		StrokeColor: "#000", BackgroundColor: "transparent",
	})

	el, err := svc.FindElement(pageID, "target")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if el.X != 42 {
		t.Errorf("X = %v, want 42", el.X)
	}
}

func TestDrawingService_FindElement_NotFound(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)

	_, err := svc.FindElement(pageID, "missing")
	if err == nil {
		t.Error("expected error for missing element")
	}
}

// ═══════════════════════════════════════════════════════════════
// UpdateElement
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_UpdateElement(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElement(ctx, pageID, domain.DrawingElement{
		ID: "el_1", Type: domain.DrawingTypeRectangle,
		X: 10, Y: 20, Width: 100, Height: 50,
		StrokeColor: "#000", StrokeWidth: 1, BackgroundColor: "transparent",
	})

	newX := 50.0
	newColor := "#fff"
	text := "updated"
	patch := domain.DrawingPatch{
		X:           &newX,
		StrokeColor: &newColor,
		Text:        &text,
	}

	if err := svc.UpdateElement(ctx, pageID, "el_1", patch); err != nil {
		t.Fatalf("update: %v", err)
	}

	el, _ := svc.FindElement(pageID, "el_1")
	if el.X != 50 {
		t.Errorf("X = %v, want 50", el.X)
	}
	if el.StrokeColor != "#fff" {
		t.Errorf("strokeColor = %q, want #fff", el.StrokeColor)
	}
	if el.Text == nil || *el.Text != "updated" {
		t.Error("text not updated")
	}
	// Unpatched fields remain
	if el.Width != 100 || el.Height != 50 {
		t.Error("unpatched fields changed")
	}
}

func TestDrawingService_UpdateElement_NotFound(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	x := 10.0
	err := svc.UpdateElement(ctx, pageID, "missing", domain.DrawingPatch{X: &x})
	if err == nil {
		t.Error("expected error for missing element")
	}
}

// ═══════════════════════════════════════════════════════════════
// UpdateElements (batch)
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_UpdateElements(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElements(ctx, pageID, []domain.DrawingElement{
		{ID: "a", Type: domain.DrawingTypeRectangle, X: 0, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "b", Type: domain.DrawingTypeEllipse, X: 0, StrokeColor: "#000", BackgroundColor: "transparent"},
	})

	xA, xB := 100.0, 200.0
	patches := map[string]domain.DrawingPatch{
		"a": {X: &xA},
		"b": {X: &xB},
	}

	if err := svc.UpdateElements(ctx, pageID, patches); err != nil {
		t.Fatalf("batch update: %v", err)
	}

	elA, _ := svc.FindElement(pageID, "a")
	elB, _ := svc.FindElement(pageID, "b")
	if elA.X != 100 {
		t.Errorf("a.X = %v, want 100", elA.X)
	}
	if elB.X != 200 {
		t.Errorf("b.X = %v, want 200", elB.X)
	}
}

// ═══════════════════════════════════════════════════════════════
// DeleteElement
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_DeleteElement(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElements(ctx, pageID, []domain.DrawingElement{
		{ID: "a", Type: domain.DrawingTypeRectangle, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "b", Type: domain.DrawingTypeEllipse, StrokeColor: "#000", BackgroundColor: "transparent"},
	})

	if err := svc.DeleteElement(ctx, pageID, "a"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	elements, _ := svc.GetElements(pageID)
	if len(elements) != 1 {
		t.Fatalf("len = %d, want 1", len(elements))
	}
	if elements[0].ID != "b" {
		t.Errorf("remaining = %q, want b", elements[0].ID)
	}
}

func TestDrawingService_DeleteElement_NotFound(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	err := svc.DeleteElement(ctx, pageID, "missing")
	if err == nil {
		t.Error("expected error for missing element")
	}
}

// ═══════════════════════════════════════════════════════════════
// DeleteElements (batch)
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_DeleteElements(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElements(ctx, pageID, []domain.DrawingElement{
		{ID: "a", Type: domain.DrawingTypeRectangle, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "b", Type: domain.DrawingTypeEllipse, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "c", Type: domain.DrawingTypeText, StrokeColor: "#000", BackgroundColor: "transparent"},
	})

	if err := svc.DeleteElements(ctx, pageID, []string{"a", "c"}); err != nil {
		t.Fatalf("batch delete: %v", err)
	}

	elements, _ := svc.GetElements(pageID)
	if len(elements) != 1 {
		t.Fatalf("len = %d, want 1", len(elements))
	}
	if elements[0].ID != "b" {
		t.Errorf("remaining = %q, want b", elements[0].ID)
	}
}

// ═══════════════════════════════════════════════════════════════
// MoveElement
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_MoveElement(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElement(ctx, pageID, domain.DrawingElement{
		ID: "el_1", Type: domain.DrawingTypeRectangle,
		X: 0, Y: 0, StrokeColor: "#000", BackgroundColor: "transparent",
	})

	if err := svc.MoveElement(ctx, pageID, "el_1", 500, 600); err != nil {
		t.Fatalf("move: %v", err)
	}

	el, _ := svc.FindElement(pageID, "el_1")
	if el.X != 500 || el.Y != 600 {
		t.Errorf("position = (%v, %v), want (500, 600)", el.X, el.Y)
	}
}

// ═══════════════════════════════════════════════════════════════
// ResizeElement
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_ResizeElement(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElement(ctx, pageID, domain.DrawingElement{
		ID: "el_1", Type: domain.DrawingTypeRectangle,
		Width: 100, Height: 50, StrokeColor: "#000", BackgroundColor: "transparent",
	})

	if err := svc.ResizeElement(ctx, pageID, "el_1", 400, 300); err != nil {
		t.Fatalf("resize: %v", err)
	}

	el, _ := svc.FindElement(pageID, "el_1")
	if el.Width != 400 || el.Height != 300 {
		t.Errorf("size = (%v, %v), want (400, 300)", el.Width, el.Height)
	}
}

// ═══════════════════════════════════════════════════════════════
// ClearAll
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_ClearAll(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElements(ctx, pageID, []domain.DrawingElement{
		{ID: "a", Type: domain.DrawingTypeRectangle, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "b", Type: domain.DrawingTypeEllipse, StrokeColor: "#000", BackgroundColor: "transparent"},
	})

	if err := svc.ClearAll(ctx, pageID); err != nil {
		t.Fatalf("clear: %v", err)
	}

	elements, _ := svc.GetElements(pageID)
	if len(elements) != 0 {
		t.Errorf("len = %d, want 0", len(elements))
	}
}

// ═══════════════════════════════════════════════════════════════
// WithElements — custom closure
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_WithElements_CustomClosure(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElements(ctx, pageID, []domain.DrawingElement{
		{ID: "a", Type: domain.DrawingTypeRectangle, X: 10, StrokeColor: "#000", BackgroundColor: "transparent"},
		{ID: "b", Type: domain.DrawingTypeRectangle, X: 20, StrokeColor: "#000", BackgroundColor: "transparent"},
	})

	// Double all X positions
	err := svc.WithElements(ctx, pageID, func(els []domain.DrawingElement) ([]domain.DrawingElement, error) {
		for i := range els {
			els[i].X *= 2
		}
		return els, nil
	})
	if err != nil {
		t.Fatalf("with elements: %v", err)
	}

	elements, _ := svc.GetElements(pageID)
	if elements[0].X != 20 || elements[1].X != 40 {
		t.Errorf("X values = (%v, %v), want (20, 40)", elements[0].X, elements[1].X)
	}
}

func TestDrawingService_WithElements_ErrorRollback(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	svc.AddElement(ctx, pageID, domain.DrawingElement{
		ID: "a", Type: domain.DrawingTypeRectangle, X: 10,
		StrokeColor: "#000", BackgroundColor: "transparent",
	})

	// Closure returns error — should not save
	err := svc.WithElements(ctx, pageID, func(els []domain.DrawingElement) ([]domain.DrawingElement, error) {
		els[0].X = 999
		return nil, context.Canceled
	})
	if err == nil {
		t.Fatal("expected error")
	}

	// Original value should be preserved
	el, _ := svc.FindElement(pageID, "a")
	if el.X != 10 {
		t.Errorf("X = %v, want 10 (should not have saved)", el.X)
	}
}

// ═══════════════════════════════════════════════════════════════
// GenID — uniqueness
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_GenID_Unique(t *testing.T) {
	svc, _, _ := newDrawingService(t)

	ids := make(map[string]bool)
	for range 100 {
		id := svc.GenID()
		if !strings.HasPrefix(id, "el_") {
			t.Errorf("id %q should start with el_", id)
		}
		if ids[id] {
			t.Fatalf("duplicate id: %s", id)
		}
		ids[id] = true
	}
}

// ═══════════════════════════════════════════════════════════════
// Concurrency — per-page locking prevents data races
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_ConcurrentAdds(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	var wg sync.WaitGroup
	n := 20
	wg.Add(n)
	for i := range n {
		go func(idx int) {
			defer wg.Done()
			el := domain.DrawingElement{
				ID:              svc.GenID(),
				Type:            domain.DrawingTypeRectangle,
				X:               float64(idx * 10),
				StrokeColor:     "#000",
				BackgroundColor: "transparent",
			}
			svc.AddElement(ctx, pageID, el)
		}(i)
	}
	wg.Wait()

	elements, err := svc.GetElements(pageID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(elements) != n {
		t.Errorf("len = %d, want %d", len(elements), n)
	}
}

// ═══════════════════════════════════════════════════════════════
// JSON round-trip — ensures domain types persist correctly via SQLite
// ═══════════════════════════════════════════════════════════════

func TestDrawingService_JSONRoundTrip_FullElement(t *testing.T) {
	svc, nbSvc, _ := newDrawingService(t)
	pageID := createDrawingTestPage(t, nbSvc)
	ctx := context.Background()

	text := "hello"
	fontSize := 16.0
	roundness := true
	borderRadius := 8.0
	arrowEnd := "arrow"

	el := domain.DrawingElement{
		ID:              "full_el",
		Type:            domain.DrawingTypeRectangle,
		X:               100,
		Y:               200,
		Width:           300,
		Height:          150,
		StrokeColor:     "#e8e8f0",
		StrokeWidth:     2,
		BackgroundColor: "transparent",
		Text:            &text,
		FontSize:        &fontSize,
		Roundness:       &roundness,
		BorderRadius:    &borderRadius,
		Points:          [][]float64{{0, 0}, {100, 100}},
		StartConnection: &domain.DrawingConnection{ElementID: "s1", Side: "right", T: 0.5},
		EndConnection:   &domain.DrawingConnection{ElementID: "s2", Side: "left", T: 0.5},
		ArrowEnd:        &arrowEnd,
	}

	if err := svc.AddElement(ctx, pageID, el); err != nil {
		t.Fatalf("add: %v", err)
	}

	got, err := svc.FindElement(pageID, "full_el")
	if err != nil {
		t.Fatalf("find: %v", err)
	}

	// Required fields
	if got.X != 100 || got.Y != 200 || got.Width != 300 || got.Height != 150 {
		t.Error("position/size mismatch")
	}

	// Optional text
	if got.Text == nil || *got.Text != "hello" {
		t.Error("text mismatch")
	}
	if got.FontSize == nil || *got.FontSize != 16 {
		t.Error("fontSize mismatch")
	}

	// Connections
	if got.StartConnection == nil || got.StartConnection.ElementID != "s1" {
		t.Error("startConnection mismatch")
	}
	if got.EndConnection == nil || got.EndConnection.Side != "left" {
		t.Error("endConnection mismatch")
	}

	// Points
	if len(got.Points) != 2 {
		t.Errorf("points len = %d, want 2", len(got.Points))
	}
}
