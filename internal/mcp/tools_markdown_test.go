package mcpserver

import (
	"context"
	"strings"
	"testing"

	"notes/internal/service"
	"notes/internal/storage"
	"notes/internal/testutil"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// newTestServer builds a minimal Server with a real NotebookService backed by an
// in-memory SQLite database. mockEmitter is defined in approval_test.go.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	db := testutil.NewTestDB(t)
	ns := storage.NewNotebookStore(db)
	bs := storage.NewBlockStore(db)
	cs := storage.NewConnectionStore(db)
	em := &mockEmitter{}
	blockSvc := service.NewBlockService(bs, t.TempDir(), em)
	notebookSvc := service.NewNotebookService(ns, blockSvc, cs, t.TempDir(), em)
	s := &Server{
		emitter:   em,
		layout:    NewLayoutEngine(),
		notebooks: notebookSvc,
		mcp: mcpserver.NewMCPServer(
			"test", "0.0.0",
			mcpserver.WithToolCapabilities(true),
		),
	}
	return s
}

// callTool invokes a handler directly with the given arguments map.
func callTool(
	ctx context.Context,
	handler func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error),
	args map[string]any,
) (*mcp.CallToolResult, error) {
	req := mcp.CallToolRequest{}
	req.Params.Arguments = args
	return handler(ctx, req)
}

// ── TestWriteMarkdown ──────────────────────────────────────────────────────

func TestWriteMarkdown_WritesToDocumentPage(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreateBoardPage(nb.ID, "Doc")
	if err != nil {
		t.Fatalf("create board page: %v", err)
	}

	result, err := callTool(ctx, s.handleWriteMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# Hello World",
	})
	if err != nil {
		t.Fatalf("handleWriteMarkdown: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	// Verify the content was persisted in the DB.
	state, err := s.notebooks.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}
	if state.Page.BoardContent != "# Hello World" {
		t.Errorf("boardContent = %q, want %q", state.Page.BoardContent, "# Hello World")
	}
}

func TestWriteMarkdown_RejectsCanvasPage(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreatePage(nb.ID, "Canvas")
	if err != nil {
		t.Fatalf("create canvas page: %v", err)
	}

	_, err = callTool(ctx, s.handleWriteMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# Should fail",
	})
	if err == nil {
		t.Fatal("expected error for canvas page, got nil")
	}
	if !strings.Contains(err.Error(), "write_markdown") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestWriteMarkdown_ReplacesPreviousContent(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreateBoardPage(nb.ID, "Doc")
	if err != nil {
		t.Fatalf("create board page: %v", err)
	}

	// Write initial content.
	_, err = callTool(ctx, s.handleWriteMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# First",
	})
	if err != nil {
		t.Fatalf("first write: %v", err)
	}

	// Overwrite with new content.
	_, err = callTool(ctx, s.handleWriteMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# Second",
	})
	if err != nil {
		t.Fatalf("second write: %v", err)
	}

	state, err := s.notebooks.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}
	if state.Page.BoardContent != "# Second" {
		t.Errorf("boardContent = %q, want %q", state.Page.BoardContent, "# Second")
	}
}

func TestWriteMarkdown_RejectsEmptyContent(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreateBoardPage(nb.ID, "Doc")
	if err != nil {
		t.Fatalf("create board page: %v", err)
	}

	_, err = callTool(ctx, s.handleWriteMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "",
	})
	if err == nil {
		t.Error("expected error for empty content, got nil")
	}
}

// ── TestAppendMarkdown ─────────────────────────────────────────────────────

func TestAppendMarkdown_AppendsToDocumentPage(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreateBoardPage(nb.ID, "Doc")
	if err != nil {
		t.Fatalf("create board page: %v", err)
	}

	// Write initial content via write_markdown so we have a known starting state.
	_, err = callTool(ctx, s.handleWriteMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# First",
	})
	if err != nil {
		t.Fatalf("write initial content: %v", err)
	}

	// Append second section.
	_, err = callTool(ctx, s.handleAppendMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "## Second",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	state, err := s.notebooks.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}
	want := "# First\n\n## Second"
	if state.Page.BoardContent != want {
		t.Errorf("boardContent = %q, want %q", state.Page.BoardContent, want)
	}
}

func TestAppendMarkdown_EmptyInitialContent(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreateBoardPage(nb.ID, "Doc")
	if err != nil {
		t.Fatalf("create board page: %v", err)
	}

	// No prior content — result should be exactly the appended content (no leading \n\n).
	_, err = callTool(ctx, s.handleAppendMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# Hello",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	state, err := s.notebooks.GetPageState(page.ID)
	if err != nil {
		t.Fatalf("get page state: %v", err)
	}
	if state.Page.BoardContent != "# Hello" {
		t.Errorf("boardContent = %q, want %q", state.Page.BoardContent, "# Hello")
	}
}

func TestAppendMarkdown_RejectsCanvasPage(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreatePage(nb.ID, "Canvas")
	if err != nil {
		t.Fatalf("create canvas page: %v", err)
	}

	_, err = callTool(ctx, s.handleAppendMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "# Should fail",
	})
	if err == nil {
		t.Fatal("expected error for canvas page, got nil")
	}
	if !strings.Contains(err.Error(), "append_markdown") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestAppendMarkdown_RejectsEmptyContent(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()

	nb, err := s.notebooks.CreateNotebook("NB")
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	page, err := s.notebooks.CreateBoardPage(nb.ID, "Doc")
	if err != nil {
		t.Fatalf("create board page: %v", err)
	}

	_, err = callTool(ctx, s.handleAppendMarkdown, map[string]any{
		"pageId":  page.ID,
		"content": "",
	})
	if err == nil {
		t.Error("expected error for empty content, got nil")
	}
}

// ── TestIsDocumentPage ─────────────────────────────────────────────────────

func TestIsDocumentPage(t *testing.T) {
	tests := []struct {
		pageType  string
		boardMode string
		want      bool
	}{
		{"board", "document", true},
		{"board", "split", true},
		{"board", "dashboard", false},
		{"canvas", "", false},
		{"canvas", "document", false},
	}
	for _, tc := range tests {
		got := isDocumentPage(tc.pageType, tc.boardMode)
		if got != tc.want {
			t.Errorf("isDocumentPage(%q, %q) = %v, want %v", tc.pageType, tc.boardMode, got, tc.want)
		}
	}
}
