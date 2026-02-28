package mcpserver

import (
	"context"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerLocalDBTools() {
	s.mcp.AddTool(mcp.NewTool("create_local_database",
		mcp.WithDescription("Create a LocalDB block with column definitions"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("name", mcp.Description("Database name"), mcp.Required()),
		mcp.WithString("configJSON", mcp.Description("Column definitions as JSON (array of {id, name, type})"), mcp.Required()),
	), s.handleCreateLocalDatabase)

	s.mcp.AddTool(mcp.NewTool("add_localdb_rows",
		mcp.WithDescription("Insert one or more rows into a LocalDB. Each row is a JSON object keyed by column ID."),
		mcp.WithString("blockId", mcp.Description("Block ID of the LocalDB"), mcp.Required()),
		mcp.WithString("rows", mcp.Description("JSON array of row objects [{colId: value, ...}, ...]"), mcp.Required()),
	), s.handleAddLocalDBRows)

	s.mcp.AddTool(mcp.NewTool("list_localdb_rows",
		mcp.WithDescription("List all rows in a LocalDB"),
		mcp.WithString("blockId", mcp.Description("Block ID of the LocalDB"), mcp.Required()),
	), s.handleListLocalDBRows)

	s.mcp.AddTool(mcp.NewTool("update_localdb_row",
		mcp.WithDescription("Update a row in a LocalDB"),
		mcp.WithString("rowId", mcp.Description("Row ID"), mcp.Required()),
		mcp.WithString("dataJSON", mcp.Description("New row data as JSON object {colId: value, ...}"), mcp.Required()),
	), s.handleUpdateLocalDBRow)

	s.mcp.AddTool(mcp.NewTool("delete_localdb_row",
		mcp.WithDescription("🛑 DESTRUCTIVE: Delete a row from a LocalDB. Requires user approval."),
		mcp.WithString("rowId", mcp.Description("Row ID to delete"), mcp.Required()),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleDeleteLocalDBRow)
}

func (s *Server) handleCreateLocalDatabase(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	name, _ := args["name"].(string)
	configJSON, _ := args["configJSON"].(string)

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 600, 420)

	block, err := s.blocks.CreateBlock(pageID, "localdb", x, y, 600, 420)
	if err != nil {
		return nil, fmt.Errorf("create localdb block: %w", err)
	}
	// NOTE: Do NOT call s.plugins.OnCreate here — the plugin's OnCreate
	// would call CreateDatabase a second time with "New Database" name,
	// causing a UNIQUE constraint violation. We handle creation below
	// with the user-specified name and config.

	// Create the database
	db, err := s.localdb.CreateDatabase(block.ID, name)
	if err != nil {
		return nil, fmt.Errorf("create database: %w", err)
	}

	// Set column config
	if configJSON != "" {
		if err := s.localdb.UpdateConfig(db.ID, configJSON); err != nil {
			return nil, fmt.Errorf("set config: %w", err)
		}
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(map[string]any{
		"block":    block,
		"database": db,
	})
}

func (s *Server) handleAddLocalDBRows(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	blockID, _ := args["blockId"].(string)
	rowsJSON, _ := args["rows"].(string)

	if blockID == "" || rowsJSON == "" {
		return nil, fmt.Errorf("blockId and rows are required")
	}

	// Get the database for this block
	db, err := s.localdb.GetDatabase(blockID)
	if err != nil {
		return nil, fmt.Errorf("get database: %w", err)
	}

	// Parse JSON array and insert each row
	var rows []map[string]any
	if err := parseJSON(rowsJSON, &rows); err != nil {
		return nil, fmt.Errorf("parse rows JSON: %w", err)
	}

	count := 0
	for _, row := range rows {
		rowData, _ := marshalJSON(row)
		if _, err := s.localdb.CreateRow(db.ID, string(rowData)); err != nil {
			return nil, fmt.Errorf("insert row %d: %w", count, err)
		}
		count++
	}

	block, _ := s.blocks.GetBlock(blockID)
	if block != nil {
		s.emitBlocksChanged(ctx, block.PageID)
	}
	return textResult(fmt.Sprintf("Inserted %d rows into database %s", count, db.Name)), nil
}

func (s *Server) handleListLocalDBRows(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	blockID, _ := args["blockId"].(string)
	if blockID == "" {
		return nil, fmt.Errorf("blockId is required")
	}

	db, err := s.localdb.GetDatabase(blockID)
	if err != nil {
		return nil, fmt.Errorf("get database: %w", err)
	}
	rows, err := s.localdb.ListRows(db.ID)
	if err != nil {
		return nil, fmt.Errorf("list rows: %w", err)
	}
	return jsonResult(rows)
}

func (s *Server) handleUpdateLocalDBRow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	rowID, _ := args["rowId"].(string)
	dataJSON, _ := args["dataJSON"].(string)

	if rowID == "" || dataJSON == "" {
		return nil, fmt.Errorf("rowId and dataJSON are required")
	}
	if err := s.localdb.UpdateRow(rowID, dataJSON); err != nil {
		return nil, fmt.Errorf("update row: %w", err)
	}
	return textResult(fmt.Sprintf("Row %s updated", rowID)), nil
}

func (s *Server) handleDeleteLocalDBRow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	rowID, _ := args["rowId"].(string)
	if rowID == "" {
		return nil, fmt.Errorf("rowId is required")
	}

	approved, err := s.approval.Request("delete_localdb_row",
		fmt.Sprintf("Delete row %s from LocalDB", rowID))
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	if err := s.localdb.DeleteRow(rowID); err != nil {
		return nil, fmt.Errorf("delete row: %w", err)
	}
	return textResult(fmt.Sprintf("Row %s deleted", rowID)), nil
}
