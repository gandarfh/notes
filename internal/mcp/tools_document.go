package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerDocumentTools() {
	s.mcp.AddTool(mcp.NewTool("read_document",
		mcp.WithDescription("Read the markdown content and metadata of a board/document page"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
	), s.handleReadDocument)

	s.mcp.AddTool(mcp.NewTool("write_document",
		mcp.WithDescription("Replace the entire content of a board/document page with new markdown. "+
			"Warning: any existing block embed HTML nodes (<div data-block-embed>) in the content should be preserved when rewriting."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("content", mcp.Description("Markdown content to set as the document body"), mcp.Required()),
	), s.handleWriteDocument)

	s.mcp.AddTool(mcp.NewTool("append_document",
		mcp.WithDescription("Append markdown content to the end of a board/document page"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("content", mcp.Description("Markdown content to append"), mcp.Required()),
	), s.handleAppendDocument)

	s.mcp.AddTool(mcp.NewTool("insert_document",
		mcp.WithDescription("Insert markdown content at a specific position in a board/document page"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("content", mcp.Description("Markdown content to insert"), mcp.Required()),
		mcp.WithString("position", mcp.Description("Where to insert: 'start', 'end' (default), or 'after:some text' to insert after the first occurrence of that text")),
	), s.handleInsertDocument)

	s.mcp.AddTool(mcp.NewTool("update_board_mode",
		mcp.WithDescription("Change the board mode of a page: 'document' (rich text editor), 'dashboard' (grid layout with blocks), or 'split' (both side-by-side)"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("mode", mcp.Description("Board mode: 'document', 'dashboard', or 'split'"), mcp.Required()),
	), s.handleUpdateBoardMode)
}

// resolveDocumentPage resolves the page ID and validates it is a board page.
func (s *Server) resolveDocumentPage(args map[string]any) (string, error) {
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return "", err
	}
	page, err := s.notebooks.GetPage(pageID)
	if err != nil {
		return "", fmt.Errorf("get page: %w", err)
	}
	if page.PageType != "board" {
		return "", fmt.Errorf("page %s is type %q, not a board/document page — use create_page with pageType='board' to create one", pageID, page.PageType)
	}
	return pageID, nil
}

func (s *Server) handleReadDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolveDocumentPage(args)
	if err != nil {
		return nil, err
	}

	page, err := s.notebooks.GetPage(pageID)
	if err != nil {
		return nil, fmt.Errorf("get page: %w", err)
	}

	result := map[string]any{
		"pageId":  page.ID,
		"name":    page.Name,
		"mode":    page.BoardMode,
		"content": page.BoardContent,
	}
	return jsonResult(result)
}

func (s *Server) handleWriteDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolveDocumentPage(args)
	if err != nil {
		return nil, err
	}

	content, _ := args["content"].(string)
	if err := s.notebooks.UpdateBoardContent(pageID, content); err != nil {
		return nil, fmt.Errorf("write document: %w", err)
	}
	s.emitBoardContentChanged(ctx, pageID, content)
	return textResult(fmt.Sprintf("Document %s updated (%d chars)", pageID, len(content))), nil
}

func (s *Server) handleAppendDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolveDocumentPage(args)
	if err != nil {
		return nil, err
	}

	page, err := s.notebooks.GetPage(pageID)
	if err != nil {
		return nil, fmt.Errorf("get page: %w", err)
	}

	appendText, _ := args["content"].(string)
	newContent := page.BoardContent
	if newContent != "" {
		newContent += "\n\n"
	}
	newContent += appendText

	if err := s.notebooks.UpdateBoardContent(pageID, newContent); err != nil {
		return nil, fmt.Errorf("append document: %w", err)
	}
	s.emitBoardContentChanged(ctx, pageID, newContent)
	return textResult(fmt.Sprintf("Appended %d chars to document %s", len(appendText), pageID)), nil
}

func (s *Server) handleInsertDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolveDocumentPage(args)
	if err != nil {
		return nil, err
	}

	page, err := s.notebooks.GetPage(pageID)
	if err != nil {
		return nil, fmt.Errorf("get page: %w", err)
	}

	insertText, _ := args["content"].(string)
	position, _ := args["position"].(string)
	if position == "" {
		position = "end"
	}

	existing := page.BoardContent
	var newContent string

	switch {
	case position == "start":
		if existing != "" {
			newContent = insertText + "\n\n" + existing
		} else {
			newContent = insertText
		}
	case position == "end":
		if existing != "" {
			newContent = existing + "\n\n" + insertText
		} else {
			newContent = insertText
		}
	case strings.HasPrefix(position, "after:"):
		needle := strings.TrimPrefix(position, "after:")
		idx := strings.Index(existing, needle)
		if idx == -1 {
			return nil, fmt.Errorf("text %q not found in document", needle)
		}
		insertAt := idx + len(needle)
		newContent = existing[:insertAt] + "\n\n" + insertText + existing[insertAt:]
	default:
		return nil, fmt.Errorf("invalid position %q: use 'start', 'end', or 'after:some text'", position)
	}

	if err := s.notebooks.UpdateBoardContent(pageID, newContent); err != nil {
		return nil, fmt.Errorf("insert document: %w", err)
	}
	s.emitBoardContentChanged(ctx, pageID, newContent)
	return textResult(fmt.Sprintf("Inserted %d chars at position %q in document %s", len(insertText), position, pageID)), nil
}

func (s *Server) handleUpdateBoardMode(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolveDocumentPage(args)
	if err != nil {
		return nil, err
	}

	mode, _ := args["mode"].(string)
	validModes := map[string]bool{"document": true, "dashboard": true, "split": true}
	if !validModes[mode] {
		return nil, fmt.Errorf("invalid mode %q: must be 'document', 'dashboard', or 'split'", mode)
	}

	if err := s.notebooks.UpdateBoardMode(pageID, mode); err != nil {
		return nil, fmt.Errorf("update board mode: %w", err)
	}

	// Emit a page reload so frontend picks up the mode change
	s.emitBlocksChanged(ctx, pageID)
	return textResult(fmt.Sprintf("Board mode set to %q for page %s", mode, pageID)), nil
}
