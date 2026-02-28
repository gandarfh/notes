package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerHTTPTools() {
	s.mcp.AddTool(mcp.NewTool("create_http_block",
		mcp.WithDescription("Create an HTTP block with method, URL, headers, and body"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("method", mcp.Description("HTTP method (GET, POST, PUT, DELETE, PATCH)"), mcp.Required()),
		mcp.WithString("url", mcp.Description("Request URL"), mcp.Required()),
		mcp.WithString("headersJSON", mcp.Description("Request headers as JSON object (optional)")),
		mcp.WithString("body", mcp.Description("Request body (optional)")),
	), s.handleCreateHTTPBlock)

	s.mcp.AddTool(mcp.NewTool("execute_http_request",
		mcp.WithDescription("Execute the HTTP request configured in a block"),
		mcp.WithString("blockId", mcp.Description("HTTP block ID"), mcp.Required()),
	), s.handleExecuteHTTPRequest)
}

func (s *Server) handleCreateHTTPBlock(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	method, _ := args["method"].(string)
	url, _ := args["url"].(string)
	headersStr, _ := args["headersJSON"].(string)
	body, _ := args["body"].(string)

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 540, 480)

	block, err := s.blocks.CreateBlock(pageID, "http", x, y, 540, 480)
	if err != nil {
		return nil, fmt.Errorf("create http block: %w", err)
	}
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, "http")
	}

	// Build config
	config := map[string]any{
		"method": method,
		"url":    url,
		"body":   body,
	}
	if headersStr != "" {
		var headers map[string]string
		if err := json.Unmarshal([]byte(headersStr), &headers); err == nil {
			config["headers"] = headers
		}
	}

	data, _ := json.Marshal(config)
	if err := s.blocks.UpdateBlockContent(block.ID, string(data)); err != nil {
		return nil, fmt.Errorf("set config: %w", err)
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(block)
}

func (s *Server) handleExecuteHTTPRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	blockID := req.GetString("blockId", "")
	if blockID == "" {
		return nil, fmt.Errorf("blockId is required")
	}

	block, err := s.blocks.GetBlock(blockID)
	if err != nil {
		return nil, fmt.Errorf("get block: %w", err)
	}

	// Parse the HTTP config from block content
	var config map[string]any
	if err := json.Unmarshal([]byte(block.Content), &config); err != nil {
		return nil, fmt.Errorf("parse HTTP config: %w", err)
	}

	return jsonResult(map[string]any{
		"status":  "configured",
		"config":  config,
		"message": "HTTP request is configured. Use the frontend to execute it, or call the app's ExecuteHTTPRequest binding.",
	})
}
