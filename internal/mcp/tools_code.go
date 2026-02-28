package mcpserver

import (
	"context"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerCodeTools() {
	s.mcp.AddTool(mcp.NewTool("write_code",
		mcp.WithDescription("Create a code block with language and content"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("language", mcp.Description("Programming language (e.g. go, python, typescript)"), mcp.Required()),
		mcp.WithString("content", mcp.Description("Code content"), mcp.Required()),
	), s.handleWriteCode)
}

func (s *Server) handleWriteCode(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	lang, _ := args["language"].(string)
	content, _ := args["content"].(string)

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 480, 360)

	block, err := s.blocks.CreateBlock(pageID, "code", x, y, 480, 360)
	if err != nil {
		return nil, fmt.Errorf("create code block: %w", err)
	}
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, "code")
	}

	// Set language extension
	extMap := map[string]string{
		"go": ".go", "python": ".py", "javascript": ".js", "typescript": ".ts",
		"rust": ".rs", "java": ".java", "c": ".c", "cpp": ".cpp", "ruby": ".rb",
		"shell": ".sh", "bash": ".sh", "sql": ".sql", "html": ".html", "css": ".css",
		"json": ".json", "yaml": ".yml", "toml": ".toml", "markdown": ".md",
	}
	if ext, ok := extMap[lang]; ok {
		s.blocks.ChangeBlockFileExt(block.ID, ext)
	}

	if err := s.blocks.UpdateBlockContent(block.ID, content); err != nil {
		return nil, fmt.Errorf("set content: %w", err)
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(block)
}
