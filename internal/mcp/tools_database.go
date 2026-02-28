package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerDatabaseTools() {
	s.mcp.AddTool(mcp.NewTool("list_db_connections",
		mcp.WithDescription("List all available database connections"),
	), s.handleListDBConnections)

	s.mcp.AddTool(mcp.NewTool("introspect_database",
		mcp.WithDescription("Get schema information (tables and columns) of a database connection"),
		mcp.WithString("connectionId", mcp.Description("Database connection ID"), mcp.Required()),
	), s.handleIntrospectDatabase)

	s.mcp.AddTool(mcp.NewTool("execute_query",
		mcp.WithDescription("Run a SQL query against a database connection. 🛑 Write queries (UPDATE/DELETE/DROP/INSERT) require user approval."),
		mcp.WithString("connectionId", mcp.Description("Database connection ID"), mcp.Required()),
		mcp.WithString("query", mcp.Description("SQL query to execute"), mcp.Required()),
		mcp.WithString("blockId", mcp.Description("Block ID to cache results against (optional)")),
		mcp.WithNumber("fetchSize", mcp.Description("Number of rows to fetch (default 100)")),
	), s.handleExecuteQuery)

	s.mcp.AddTool(mcp.NewTool("create_query_block",
		mcp.WithDescription("Create a database block with a pre-written query"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("connectionId", mcp.Description("Database connection ID"), mcp.Required()),
		mcp.WithString("query", mcp.Description("SQL query"), mcp.Required()),
	), s.handleCreateQueryBlock)
}

func (s *Server) handleListDBConnections(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	conns, err := s.database.ListConnections()
	if err != nil {
		return nil, fmt.Errorf("list connections: %w", err)
	}
	return jsonResult(conns)
}

func (s *Server) handleIntrospectDatabase(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	connID := req.GetString("connectionId", "")
	if connID == "" {
		return nil, fmt.Errorf("connectionId is required")
	}
	schema, err := s.database.Introspect(ctx, connID)
	if err != nil {
		return nil, fmt.Errorf("introspect: %w", err)
	}
	return jsonResult(schema)
}

func (s *Server) handleExecuteQuery(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	connID, _ := args["connectionId"].(string)
	query, _ := args["query"].(string)
	blockID, _ := args["blockId"].(string)
	fetchSize := int(getFloat(args, "fetchSize", 100))

	if connID == "" || query == "" {
		return nil, fmt.Errorf("connectionId and query are required")
	}

	// Detect write queries — require approval
	upperQuery := strings.ToUpper(strings.TrimSpace(query))
	isWrite := strings.HasPrefix(upperQuery, "UPDATE") ||
		strings.HasPrefix(upperQuery, "DELETE") ||
		strings.HasPrefix(upperQuery, "DROP") ||
		strings.HasPrefix(upperQuery, "INSERT") ||
		strings.HasPrefix(upperQuery, "ALTER") ||
		strings.HasPrefix(upperQuery, "TRUNCATE")

	if isWrite {
		approved, err := s.approval.Request("execute_query",
			fmt.Sprintf("Execute write query: %s", truncate(query, 100)))
		if err != nil || !approved {
			return textResult("Write query rejected by user"), nil
		}
	}

	if blockID == "" {
		blockID = "mcp-query" // placeholder for non-block queries
	}

	result, err := s.database.ExecuteQuery(ctx, blockID, connID, query, fetchSize)
	if err != nil {
		return nil, fmt.Errorf("execute query: %w", err)
	}
	return jsonResult(result)
}

func (s *Server) handleCreateQueryBlock(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	connID, _ := args["connectionId"].(string)
	query, _ := args["query"].(string)

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 600, 420)

	block, err := s.blocks.CreateBlock(pageID, "database", x, y, 600, 420)
	if err != nil {
		return nil, fmt.Errorf("create database block: %w", err)
	}
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, "database")
	}

	// Set config with connection and query
	config := fmt.Sprintf(`{"connectionId":"%s","query":"%s"}`, connID, escapeJSON(query))
	if err := s.blocks.UpdateBlockContent(block.ID, config); err != nil {
		return nil, fmt.Errorf("set config: %w", err)
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(block)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}
