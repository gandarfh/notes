package mcpserver

import (
	"context"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerNavigationTools() {
	// ── list_notebooks ─────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("list_notebooks",
		mcp.WithDescription("List all notebooks in the workspace"),
	), s.handleListNotebooks)

	// ── list_pages ─────────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("list_pages",
		mcp.WithDescription("List all pages in a notebook"),
		mcp.WithString("notebookId",
			mcp.Description("ID of the notebook"),
			mcp.Required(),
		),
	), s.handleListPages)

	// ── create_page ────────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("create_page",
		mcp.WithDescription("Create a new page in a notebook"),
		mcp.WithString("notebookId",
			mcp.Description("ID of the notebook"),
			mcp.Required(),
		),
		mcp.WithString("name",
			mcp.Description("Name of the new page"),
			mcp.Required(),
		),
	), s.handleCreatePage)

	// ── set_active_page ────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("set_active_page",
		mcp.WithDescription("Set the active page for subsequent tool calls. Tools that accept pageId will default to this."),
		mcp.WithString("pageId",
			mcp.Description("ID of the page to make active"),
			mcp.Required(),
		),
	), s.handleSetActivePage)
}

func (s *Server) handleListNotebooks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	notebooks, err := s.notebooks.ListNotebooks()
	if err != nil {
		return nil, fmt.Errorf("list notebooks: %w", err)
	}
	return jsonResult(notebooks)
}

func (s *Server) handleListPages(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	notebookID := req.GetString("notebookId", "")
	if notebookID == "" {
		return nil, fmt.Errorf("notebookId is required")
	}
	pages, err := s.notebooks.ListPages(notebookID)
	if err != nil {
		return nil, fmt.Errorf("list pages: %w", err)
	}
	return jsonResult(pages)
}

func (s *Server) handleCreatePage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	notebookID := req.GetString("notebookId", "")
	name := req.GetString("name", "")
	if notebookID == "" || name == "" {
		return nil, fmt.Errorf("notebookId and name are required")
	}
	page, err := s.notebooks.CreatePage(notebookID, name)
	if err != nil {
		return nil, fmt.Errorf("create page: %w", err)
	}
	// Auto-set as active page
	s.activePageID = page.ID
	return jsonResult(page)
}

func (s *Server) handleSetActivePage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	pageID := req.GetString("pageId", "")
	if pageID == "" {
		return nil, fmt.Errorf("pageId is required")
	}
	s.activePageID = pageID
	return textResult(fmt.Sprintf("Active page set to %s", pageID)), nil
}
