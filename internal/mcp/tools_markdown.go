package mcpserver

import (
	"context"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerMarkdownTools() {
	s.mcp.AddTool(mcp.NewTool("write_markdown",
		mcp.WithDescription("Write markdown content to a document page (boardMode=document or split). Replaces the full document content."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("content", mcp.Description("Markdown content"), mcp.Required()),
	), s.handleWriteMarkdown)

	s.mcp.AddTool(mcp.NewTool("append_markdown",
		mcp.WithDescription("Append markdown content to a document page (boardMode=document or split)"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("content", mcp.Description("Markdown content to append"), mcp.Required()),
	), s.handleAppendMarkdown)
}

func (s *Server) handleWriteMarkdown(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	content, _ := args["content"].(string)
	if content == "" {
		return nil, fmt.Errorf("content is required and must be a non-empty string")
	}

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	state, err := s.notebooks.GetPageState(pageID)
	if err != nil {
		return nil, fmt.Errorf("get page: %w", err)
	}

	if !isDocumentPage(state.Page.PageType, state.Page.BoardMode) {
		return nil, fmt.Errorf("write_markdown requires a document or split page (got pageType=%q boardMode=%q); use create_block for canvas/dashboard pages", state.Page.PageType, state.Page.BoardMode)
	}

	if err := s.notebooks.UpdateBoardContent(pageID, content); err != nil {
		return nil, fmt.Errorf("write document: %w", err)
	}
	s.emitBoardContentChanged(ctx, pageID, content)
	return textResult(fmt.Sprintf("Document content written (%d chars)", len(content))), nil
}

func (s *Server) handleAppendMarkdown(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	content, _ := args["content"].(string)
	if content == "" {
		return nil, fmt.Errorf("content is required and must be a non-empty string")
	}

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	state, err := s.notebooks.GetPageState(pageID)
	if err != nil {
		return nil, fmt.Errorf("get page: %w", err)
	}

	if !isDocumentPage(state.Page.PageType, state.Page.BoardMode) {
		return nil, fmt.Errorf("append_markdown requires a document or split page (got pageType=%q boardMode=%q); use create_block for canvas/dashboard pages", state.Page.PageType, state.Page.BoardMode)
	}

	existing := state.Page.BoardContent
	var newContent string
	if existing == "" {
		newContent = content
	} else {
		newContent = existing + "\n\n" + content
	}

	if err := s.notebooks.UpdateBoardContent(pageID, newContent); err != nil {
		return nil, fmt.Errorf("append document: %w", err)
	}
	s.emitBoardContentChanged(ctx, pageID, newContent)
	return textResult(fmt.Sprintf("Appended %d chars to document", len(content))), nil
}

// isDocumentPage reports whether pageType + boardMode represent a document or split page.
func isDocumentPage(pageType, boardMode string) bool {
	return pageType == "board" && (boardMode == "document" || boardMode == "split")
}
