package mcpserver

import (
	"context"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerMarkdownTools() {
	s.mcp.AddTool(mcp.NewTool("write_markdown",
		mcp.WithDescription("Create a new markdown block with content, or update an existing one"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("content", mcp.Description("Markdown content"), mcp.Required()),
		mcp.WithString("blockId", mcp.Description("Existing block ID to update (optional — creates new if omitted)")),
	), s.handleWriteMarkdown)

	s.mcp.AddTool(mcp.NewTool("append_markdown",
		mcp.WithDescription("Append text to an existing markdown block"),
		mcp.WithString("blockId", mcp.Description("Block ID"), mcp.Required()),
		mcp.WithString("content", mcp.Description("Text to append"), mcp.Required()),
	), s.handleAppendMarkdown)
}

func (s *Server) handleWriteMarkdown(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	content, _ := args["content"].(string)

	// Update existing block
	if blockID, ok := args["blockId"].(string); ok && blockID != "" {
		if err := s.blocks.UpdateBlockContent(blockID, content); err != nil {
			return nil, fmt.Errorf("update markdown: %w", err)
		}
		block, _ := s.blocks.GetBlock(blockID)
		if block != nil {
			s.emitBlocksChanged(ctx, block.PageID)
		}
		return textResult(fmt.Sprintf("Markdown block %s updated", blockID)), nil
	}

	// Create new block
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}
	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 480, 360)

	block, err := s.blocks.CreateBlock(pageID, "markdown", x, y, 480, 360)
	if err != nil {
		return nil, fmt.Errorf("create markdown block: %w", err)
	}
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, "markdown")
	}
	if err := s.blocks.UpdateBlockContent(block.ID, content); err != nil {
		return nil, fmt.Errorf("set content: %w", err)
	}
	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(block)
}

func (s *Server) handleAppendMarkdown(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	block, err := s.getBlockForTool(args)
	if err != nil {
		return nil, err
	}
	appendText, _ := args["content"].(string)
	newContent := block.Content + appendText

	if err := s.blocks.UpdateBlockContent(block.ID, newContent); err != nil {
		return nil, fmt.Errorf("append markdown: %w", err)
	}
	s.emitBlocksChanged(ctx, block.PageID)
	return textResult(fmt.Sprintf("Appended %d chars to block %s", len(appendText), block.ID)), nil
}
