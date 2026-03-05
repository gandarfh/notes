package service

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"notes/internal/domain"
	"notes/internal/storage"
	"notes/internal/testutil"
)

func newBlockService(t *testing.T) (*BlockService, *storage.BlockStore, *storage.NotebookStore, string) {
	t.Helper()
	db := testutil.NewTestDB(t)
	bs := storage.NewBlockStore(db)
	ns := storage.NewNotebookStore(db)
	dataDir := t.TempDir()
	emitter := &MockEmitter{}
	svc := NewBlockService(bs, dataDir, emitter)
	return svc, bs, ns, dataDir
}

func createTestPage(t *testing.T, ns *storage.NotebookStore) string {
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

func TestBlockService_CreateBlock_Markdown(t *testing.T) {
	svc, _, ns, dataDir := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, err := svc.CreateBlock(pageID, "markdown", 10, 20, 300, 200, "dashboard")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if b.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if b.PageID != pageID {
		t.Errorf("pageID = %q", b.PageID)
	}
	if b.Type != domain.BlockTypeMarkdown {
		t.Errorf("type = %v, want markdown", b.Type)
	}
	if b.Content != "# New Note\n" {
		t.Errorf("content = %q, want default markdown", b.Content)
	}
	if b.X != 10 || b.Y != 20 {
		t.Errorf("position = (%v, %v)", b.X, b.Y)
	}

	// Should create backing .md file
	if b.FilePath == "" {
		t.Fatal("FilePath should be set for markdown blocks")
	}
	if !strings.HasSuffix(b.FilePath, ".md") {
		t.Errorf("FilePath = %q, should end with .md", b.FilePath)
	}

	// File should exist on disk
	content, err := os.ReadFile(b.FilePath)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(content) != "# New Note\n" {
		t.Errorf("file content = %q", string(content))
	}

	// File should be in dataDir/pageID/
	expectedDir := filepath.Join(dataDir, pageID)
	if !strings.HasPrefix(b.FilePath, expectedDir) {
		t.Errorf("file not in expected dir: %q", b.FilePath)
	}
}

func TestBlockService_CreateBlock_Code(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, err := svc.CreateBlock(pageID, "code", 0, 0, 300, 200, "dashboard")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if b.Content != "" {
		t.Errorf("content = %q, want empty for code", b.Content)
	}
	if !strings.HasSuffix(b.FilePath, ".txt") {
		t.Errorf("FilePath = %q, should end with .txt", b.FilePath)
	}
}

func TestBlockService_CreateBlock_Drawing(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, err := svc.CreateBlock(pageID, "drawing", 0, 0, 300, 200, "dashboard")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if b.Content != "{}" {
		t.Errorf("content = %q, want {} for non-file blocks", b.Content)
	}
	if b.FilePath != "" {
		t.Errorf("FilePath = %q, should be empty for drawing blocks", b.FilePath)
	}
}

func TestBlockService_GetBlock(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	created, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")

	got, err := svc.GetBlock(created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("id = %q, want %q", got.ID, created.ID)
	}
}

func TestBlockService_ListBlocks(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")
	svc.CreateBlock(pageID, "code", 400, 0, 300, 200, "dashboard")

	blocks, err := svc.ListBlocks(pageID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(blocks) != 2 {
		t.Fatalf("len = %d, want 2", len(blocks))
	}
}

func TestBlockService_UpdateBlockPosition(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")

	if err := svc.UpdateBlockPosition(b.ID, 100, 200, 400, 300); err != nil {
		t.Fatalf("update position: %v", err)
	}

	got, _ := svc.GetBlock(b.ID)
	if got.X != 100 || got.Y != 200 {
		t.Errorf("position = (%v, %v), want (100, 200)", got.X, got.Y)
	}
	if got.Width != 400 || got.Height != 300 {
		t.Errorf("size = (%v, %v), want (400, 300)", got.Width, got.Height)
	}
}

func TestBlockService_UpdateBlockContent(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")

	if err := svc.UpdateBlockContent(b.ID, "# Updated\n"); err != nil {
		t.Fatalf("update content: %v", err)
	}

	got, _ := svc.GetBlock(b.ID)
	if got.Content != "# Updated\n" {
		t.Errorf("content = %q", got.Content)
	}

	// File on disk should also be updated
	fileContent, err := os.ReadFile(b.FilePath)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(fileContent) != "# Updated\n" {
		t.Errorf("file content = %q", string(fileContent))
	}
}

func TestBlockService_UpdateBlockContent_NoFile(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "drawing", 0, 0, 300, 200, "dashboard")

	if err := svc.UpdateBlockContent(b.ID, `{"shapes":[1]}`); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := svc.GetBlock(b.ID)
	if got.Content != `{"shapes":[1]}` {
		t.Errorf("content = %q", got.Content)
	}
}

func TestBlockService_DeleteBlock(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")
	filePath := b.FilePath

	if err := svc.DeleteBlock(context.Background(), b.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := svc.GetBlock(b.ID)
	if err == nil {
		t.Fatal("expected error after delete")
	}

	// File should be removed
	if _, err := os.Stat(filePath); err == nil {
		t.Error("file should be deleted")
	}
}

func TestBlockService_DeleteBlocksByPage(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b1, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")
	b2, _ := svc.CreateBlock(pageID, "code", 400, 0, 300, 200, "dashboard")

	if err := svc.DeleteBlocksByPage(pageID); err != nil {
		t.Fatalf("delete by page: %v", err)
	}

	blocks, _ := svc.ListBlocks(pageID)
	if len(blocks) != 0 {
		t.Errorf("len = %d, want 0", len(blocks))
	}

	// Files should be removed
	for _, fp := range []string{b1.FilePath, b2.FilePath} {
		if _, err := os.Stat(fp); err == nil {
			t.Errorf("file %q should be deleted", fp)
		}
	}
}

func TestBlockService_SaveAndGetImageFile(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "image", 0, 0, 300, 200, "dashboard")

	// Create a small fake PNG (just base64 of some bytes)
	fakeImage := []byte{0x89, 0x50, 0x4E, 0x47}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(fakeImage)

	path, err := svc.SaveImageFile(b.ID, dataURL)
	if err != nil {
		t.Fatalf("save image: %v", err)
	}

	if !strings.HasSuffix(path, ".png") {
		t.Errorf("path = %q, want .png", path)
	}

	// Verify file exists
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("image file not found: %v", err)
	}

	// GetImageData should return the base64 data URL
	result, err := svc.GetImageData(b.ID)
	if err != nil {
		t.Fatalf("get image: %v", err)
	}
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Errorf("result doesn't start with data URL prefix")
	}
}

func TestBlockService_GetImageData_NoFile(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "image", 0, 0, 300, 200, "dashboard")

	data, err := svc.GetImageData(b.ID)
	if err != nil {
		t.Fatalf("get image: %v", err)
	}
	if data != "" {
		t.Errorf("expected empty string for block without file, got %q", data)
	}
}

func TestBlockService_UpdateBlockFilePath(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")

	// Create a temp file to link
	tmpFile := filepath.Join(t.TempDir(), "external.md")
	os.WriteFile(tmpFile, []byte("external content"), 0644)

	path, err := svc.UpdateBlockFilePath(b.ID, tmpFile)
	if err != nil {
		t.Fatalf("update file path: %v", err)
	}
	if path == "" {
		t.Fatal("expected non-empty path")
	}

	// Block content should be updated from the file
	got, _ := svc.GetBlock(b.ID)
	if got.Content != "external content" {
		t.Errorf("content = %q, want 'external content'", got.Content)
	}
}

func TestBlockService_UpdateBlockFilePath_FileNotFound(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")

	_, err := svc.UpdateBlockFilePath(b.ID, "/nonexistent/file.md")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestBlockService_ChangeBlockFileExt(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "code", 0, 0, 300, 200, "dashboard")

	newPath, err := svc.ChangeBlockFileExt(b.ID, ".py")
	if err != nil {
		t.Fatalf("change ext: %v", err)
	}

	if !strings.HasSuffix(newPath, ".py") {
		t.Errorf("path = %q, want .py extension", newPath)
	}

	// Old file should not exist
	if _, err := os.Stat(b.FilePath); err == nil {
		t.Error("old file should be removed")
	}
	// New file should exist
	if _, err := os.Stat(newPath); err != nil {
		t.Errorf("new file should exist: %v", err)
	}
}

func TestBlockService_ChangeBlockFileExt_NoFile(t *testing.T) {
	svc, _, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	b, _ := svc.CreateBlock(pageID, "drawing", 0, 0, 300, 200, "dashboard")

	_, err := svc.ChangeBlockFileExt(b.ID, ".py")
	if err == nil {
		t.Fatal("expected error for block without file")
	}
}

func TestBlockService_RestorePageBlocks(t *testing.T) {
	svc, bs, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")
	svc.CreateBlock(pageID, "code", 400, 0, 300, 200, "dashboard")

	// Restore with new blocks
	newBlocks := []domain.Block{
		{ID: "restored-1", PageID: pageID, Type: domain.BlockTypeDrawing, Content: "restored", StyleJSON: "{}"},
	}
	if err := svc.RestorePageBlocks(context.Background(), pageID, newBlocks); err != nil {
		t.Fatalf("restore: %v", err)
	}

	blocks, _ := bs.ListBlocks(pageID)
	if len(blocks) != 1 {
		t.Fatalf("len = %d, want 1", len(blocks))
	}
	if blocks[0].ID != "restored-1" {
		t.Errorf("id = %q, want restored-1", blocks[0].ID)
	}
}

func TestBlockService_ReplacePageBlocks(t *testing.T) {
	svc, bs, ns, _ := newBlockService(t)
	pageID := createTestPage(t, ns)

	svc.CreateBlock(pageID, "markdown", 0, 0, 300, 200, "dashboard")

	newBlocks := []domain.Block{
		{ID: "new-1", PageID: pageID, Type: domain.BlockTypeImage, Content: "{}", StyleJSON: "{}"},
	}
	if err := svc.ReplacePageBlocks(pageID, newBlocks); err != nil {
		t.Fatalf("replace: %v", err)
	}

	blocks, _ := bs.ListBlocks(pageID)
	if len(blocks) != 1 {
		t.Fatalf("len = %d, want 1", len(blocks))
	}
}
