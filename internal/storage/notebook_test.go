package storage

import (
	"testing"

	"notes/internal/domain"
)

func newNotebookStore(t *testing.T) *NotebookStore {
	t.Helper()
	return NewNotebookStore(newTestDB(t))
}

// ── Notebook Tests ──────────────────────────────────────────

func TestNotebookStore_CreateAndGet(t *testing.T) {
	s := newNotebookStore(t)

	nb := &domain.Notebook{ID: "nb-1", Name: "My Notebook", Icon: "📓"}
	if err := s.CreateNotebook(nb); err != nil {
		t.Fatalf("create: %v", err)
	}

	if nb.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}

	got, err := s.GetNotebook("nb-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "My Notebook" {
		t.Errorf("name = %q, want %q", got.Name, "My Notebook")
	}
	if got.Icon != "📓" {
		t.Errorf("icon = %q, want 📓", got.Icon)
	}
}

func TestNotebookStore_GetNotFound(t *testing.T) {
	s := newNotebookStore(t)
	_, err := s.GetNotebook("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent notebook")
	}
}

func TestNotebookStore_ListNotebooks(t *testing.T) {
	s := newNotebookStore(t)

	for _, id := range []string{"nb-1", "nb-2"} {
		nb := &domain.Notebook{ID: id, Name: id, Icon: "📓"}
		if err := s.CreateNotebook(nb); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}

	list, err := s.ListNotebooks()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}

	// Should be ordered by created_at DESC (newest first)
	if list[0].ID != "nb-2" {
		t.Errorf("first notebook = %q, want nb-2 (newest first)", list[0].ID)
	}
}

func TestNotebookStore_ListNotebooks_Empty(t *testing.T) {
	s := newNotebookStore(t)
	list, err := s.ListNotebooks()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if list != nil {
		t.Errorf("expected nil for empty list, got %v", list)
	}
}

func TestNotebookStore_UpdateNotebook(t *testing.T) {
	s := newNotebookStore(t)

	nb := &domain.Notebook{ID: "nb-1", Name: "Old", Icon: "📓"}
	if err := s.CreateNotebook(nb); err != nil {
		t.Fatalf("create: %v", err)
	}

	nb.Name = "New"
	nb.Icon = "🔥"
	if err := s.UpdateNotebook(nb); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err := s.GetNotebook("nb-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "New" {
		t.Errorf("name = %q, want New", got.Name)
	}
	if got.Icon != "🔥" {
		t.Errorf("icon = %q, want 🔥", got.Icon)
	}
}

func TestNotebookStore_DeleteNotebook(t *testing.T) {
	s := newNotebookStore(t)

	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	if err := s.CreateNotebook(nb); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.DeleteNotebook("nb-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := s.GetNotebook("nb-1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

// ── Page Tests ──────────────────────────────────────────────

func TestNotebookStore_CreateAndGetPage(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	if err := s.CreateNotebook(nb); err != nil {
		t.Fatalf("create nb: %v", err)
	}

	p := &domain.Page{
		ID: "page-1", NotebookID: "nb-1", Name: "Page 1",
		Order: 1, ViewportX: 100, ViewportY: 200, ViewportZoom: 1.5,
	}
	if err := s.CreatePage(p); err != nil {
		t.Fatalf("create page: %v", err)
	}

	got, err := s.GetPage("page-1")
	if err != nil {
		t.Fatalf("get page: %v", err)
	}
	if got.Name != "Page 1" {
		t.Errorf("name = %q, want %q", got.Name, "Page 1")
	}
	if got.ViewportX != 100 || got.ViewportY != 200 {
		t.Errorf("viewport = (%v, %v), want (100, 200)", got.ViewportX, got.ViewportY)
	}
	if got.ViewportZoom != 1.5 {
		t.Errorf("zoom = %v, want 1.5", got.ViewportZoom)
	}
}

func TestNotebookStore_GetPage_IncludesDrawingData(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	s.CreateNotebook(nb)

	p := &domain.Page{ID: "page-1", NotebookID: "nb-1", Name: "P", ViewportZoom: 1.0}
	s.CreatePage(p)

	// Update with drawing data
	p.DrawingData = `{"shapes":[]}`
	if err := s.UpdatePage(p); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err := s.GetPage("page-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.DrawingData != `{"shapes":[]}` {
		t.Errorf("drawing_data = %q, want {\"shapes\":[]}", got.DrawingData)
	}
}

func TestNotebookStore_ListPages_OmitsDrawingData(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	s.CreateNotebook(nb)

	p := &domain.Page{ID: "page-1", NotebookID: "nb-1", Name: "P", ViewportZoom: 1.0}
	s.CreatePage(p)

	p.DrawingData = `{"shapes":[]}`
	s.UpdatePage(p)

	pages, err := s.ListPages("nb-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(pages) != 1 {
		t.Fatalf("len = %d, want 1", len(pages))
	}
	// ListPages omits drawing_data column
	if pages[0].DrawingData != "" {
		t.Errorf("ListPages should omit drawing_data, got %q", pages[0].DrawingData)
	}
}

func TestNotebookStore_ListPages_OrderedBySortOrder(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	s.CreateNotebook(nb)

	// Insert in reverse order
	for i, id := range []string{"p3", "p1", "p2"} {
		order := []int{3, 1, 2}[i]
		p := &domain.Page{ID: id, NotebookID: "nb-1", Name: id, Order: order, ViewportZoom: 1.0}
		if err := s.CreatePage(p); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}

	pages, err := s.ListPages("nb-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if pages[0].ID != "p1" || pages[1].ID != "p2" || pages[2].ID != "p3" {
		t.Errorf("pages not sorted by sort_order: %v, %v, %v", pages[0].ID, pages[1].ID, pages[2].ID)
	}
}

func TestNotebookStore_UpdatePage(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	s.CreateNotebook(nb)

	p := &domain.Page{ID: "page-1", NotebookID: "nb-1", Name: "Old", ViewportZoom: 1.0}
	s.CreatePage(p)

	p.Name = "New"
	p.ViewportX = 500
	p.ViewportZoom = 2.0
	p.DrawingData = `{"shapes":[1]}`
	if err := s.UpdatePage(p); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetPage("page-1")
	if got.Name != "New" {
		t.Errorf("name = %q, want New", got.Name)
	}
	if got.ViewportX != 500 {
		t.Errorf("viewport_x = %v, want 500", got.ViewportX)
	}
	if got.ViewportZoom != 2.0 {
		t.Errorf("zoom = %v, want 2.0", got.ViewportZoom)
	}
}

func TestNotebookStore_DeletePage(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	s.CreateNotebook(nb)

	p := &domain.Page{ID: "page-1", NotebookID: "nb-1", Name: "P", ViewportZoom: 1.0}
	s.CreatePage(p)

	if err := s.DeletePage("page-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := s.GetPage("page-1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestNotebookStore_DeletePagesByNotebook(t *testing.T) {
	s := newNotebookStore(t)
	nb := &domain.Notebook{ID: "nb-1", Name: "Test", Icon: "📓"}
	s.CreateNotebook(nb)

	for _, id := range []string{"p1", "p2"} {
		p := &domain.Page{ID: id, NotebookID: "nb-1", Name: id, ViewportZoom: 1.0}
		s.CreatePage(p)
	}

	if err := s.DeletePagesByNotebook("nb-1"); err != nil {
		t.Fatalf("delete by notebook: %v", err)
	}

	pages, _ := s.ListPages("nb-1")
	if len(pages) != 0 {
		t.Errorf("len = %d, want 0", len(pages))
	}
}
