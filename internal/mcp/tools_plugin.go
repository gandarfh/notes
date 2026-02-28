package mcpserver

import (
	"context"
	"fmt"

	"notes/internal/service"

	"github.com/mark3labs/mcp-go/mcp"
)

// registerPluginTools iterates all registered Go plugins and auto-registers
// MCP tools for them. If a plugin implements MCPCapablePlugin, its custom
// tools are registered. Otherwise, generic CRUD tools are created.
func (s *Server) registerPluginTools() {
	if s.plugins == nil {
		return
	}

	s.plugins.ForEach(func(p service.GoBlockPlugin) {
		blockType := p.BlockType()

		// Check if plugin declares custom MCP tools
		if mcpPlugin, ok := p.(service.MCPCapablePlugin); ok {
			for _, toolDef := range mcpPlugin.MCPTools() {
				def := toolDef // capture for closure
				tool := mcp.NewTool(def.Name, mcp.WithDescription(def.Description))
				if def.Destructive {
					tool = mcp.NewTool(def.Name,
						mcp.WithDescription("🛑 DESTRUCTIVE: "+def.Description),
						mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
					)
				}
				s.mcp.AddTool(tool, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
					if def.Destructive {
						approved, err := s.approval.Request(def.Name, def.Description)
						if err != nil || !approved {
							return textResult("Action rejected by user"), nil
						}
					}
					result, err := def.Handler(req.GetArguments())
					if err != nil {
						return nil, err
					}
					return jsonResult(result)
				})
			}
			return
		}

		// Generic fallback: create/read/update for any plugin block type
		// create_{type}_block
		s.mcp.AddTool(mcp.NewTool(
			fmt.Sprintf("create_%s_block", blockType),
			mcp.WithDescription(fmt.Sprintf("Create a %s block on the canvas", blockType)),
			mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
			mcp.WithString("content", mcp.Description("Initial content (optional)")),
		), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args := req.GetArguments()
			pageID, err := s.resolvePageID(args)
			if err != nil {
				return nil, err
			}
			existing, _ := s.blocks.ListBlocks(pageID)
			x, y := s.layout.NextPosition(existing, 480, 360)
			block, err := s.blocks.CreateBlock(pageID, blockType, x, y, 480, 360)
			if err != nil {
				return nil, err
			}
			_ = s.plugins.OnCreate(block.ID, pageID, blockType)
			if content, ok := args["content"].(string); ok && content != "" {
				_ = s.blocks.UpdateBlockContent(block.ID, content)
			}
			s.emitBlocksChanged(ctx, pageID)
			return jsonResult(block)
		})

		// read_{type}_content
		s.mcp.AddTool(mcp.NewTool(
			fmt.Sprintf("read_%s_content", blockType),
			mcp.WithDescription(fmt.Sprintf("Read the content of a %s block", blockType)),
			mcp.WithString("blockId", mcp.Description("Block ID"), mcp.Required()),
		), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			block, err := s.getBlockForTool(req.GetArguments())
			if err != nil {
				return nil, err
			}
			return textResult(block.Content), nil
		})

		// update_{type}_content
		s.mcp.AddTool(mcp.NewTool(
			fmt.Sprintf("update_%s_content", blockType),
			mcp.WithDescription(fmt.Sprintf("Update the content of a %s block", blockType)),
			mcp.WithString("blockId", mcp.Description("Block ID"), mcp.Required()),
			mcp.WithString("content", mcp.Description("New content"), mcp.Required()),
		), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args := req.GetArguments()
			block, err := s.getBlockForTool(args)
			if err != nil {
				return nil, err
			}
			content, _ := args["content"].(string)
			if err := s.blocks.UpdateBlockContent(block.ID, content); err != nil {
				return nil, err
			}
			s.emitBlocksChanged(ctx, block.PageID)
			return textResult(fmt.Sprintf("Block %s updated", block.ID)), nil
		})
	})
}
