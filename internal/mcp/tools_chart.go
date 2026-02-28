package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerChartTools() {
	s.mcp.AddTool(mcp.NewTool("create_chart",
		mcp.WithDescription("Create a chart block linked to a LocalDB"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("localdbBlockId", mcp.Description("Block ID of the LocalDB data source"), mcp.Required()),
		mcp.WithString("chartType", mcp.Description("Chart type: bar, line, area, pie, scatter, number, etc."), mcp.Required()),
		mcp.WithString("xColumn", mcp.Description("Column name or ID for X axis"), mcp.Required()),
		mcp.WithString("yColumn", mcp.Description("Column name or ID for Y axis"), mcp.Required()),
		mcp.WithString("title", mcp.Description("Chart title (optional)")),
	), s.handleCreateChart)

	s.mcp.AddTool(mcp.NewTool("batch_create_charts",
		mcp.WithDescription("Create multiple chart blocks at once. Pass a JSON array of chart objects."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("charts",
			mcp.Description("JSON array of chart objects [{localdbBlockId, chartType, xColumn, yColumn, title?, x?, y?, width?, height?}, ...]"),
			mcp.Required(),
		),
	), s.handleBatchCreateCharts)
}

func (s *Server) handleCreateChart(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	localdbBlockID, _ := args["localdbBlockId"].(string)
	chartType, _ := args["chartType"].(string)
	xCol, _ := args["xColumn"].(string)
	yCol, _ := args["yColumn"].(string)
	title, _ := args["title"].(string)

	// Resolve localdb block → database (pipeline uses database ID, not block ID)
	localDB, err := s.localdb.GetDatabase(localdbBlockID)
	if err != nil {
		return nil, fmt.Errorf("resolve localdb: %w", err)
	}

	// Build name→id mapping so callers can pass column names instead of UUIDs
	xCol = resolveColumnRef(localDB.ConfigJSON, xCol)
	yCol = resolveColumnRef(localDB.ConfigJSON, yCol)

	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 540, 420)

	block, err := s.blocks.CreateBlock(pageID, "chart", x, y, 540, 420)
	if err != nil {
		return nil, fmt.Errorf("create chart block: %w", err)
	}
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, "chart")
	}

	// Build proper PipelineConfig format that matches frontend expectations
	config := map[string]any{
		"chartType": chartType,
		"title":     title,
		"data":      []any{},
		"series":    []any{},
		"pipeline": map[string]any{
			"stages": []any{
				map[string]any{"type": "source", "databaseId": localDB.ID},
			},
			"viz": map[string]any{
				"xAxis":  xCol,
				"series": []string{yCol},
			},
		},
	}
	data, _ := json.Marshal(config)
	if err := s.blocks.UpdateBlockContent(block.ID, string(data)); err != nil {
		return nil, fmt.Errorf("set chart config: %w", err)
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(block)
}

// resolveColumnRef resolves a column name to its UUID-based ID from the LocalDB config.
// If the value is already a UUID or not found by name, it returns the original value.
func resolveColumnRef(configJSON, ref string) string {
	if ref == "" || configJSON == "" {
		return ref
	}
	var cfg struct {
		Columns []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"columns"`
	}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return ref
	}
	for _, col := range cfg.Columns {
		if col.Name == ref {
			return col.ID
		}
	}
	return ref // already an ID or not found
}

func (s *Server) handleBatchCreateCharts(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	chartsJSON, _ := args["charts"].(string)
	var charts []struct {
		LocalDBBlockID string   `json:"localdbBlockId"`
		ChartType      string   `json:"chartType"`
		XColumn        string   `json:"xColumn"`
		YColumn        string   `json:"yColumn"`
		Title          string   `json:"title"`
		X              *float64 `json:"x"`
		Y              *float64 `json:"y"`
		Width          *float64 `json:"width"`
		Height         *float64 `json:"height"`
	}
	if err := json.Unmarshal([]byte(chartsJSON), &charts); err != nil {
		return nil, fmt.Errorf("parse charts JSON: %w", err)
	}
	if len(charts) == 0 {
		return nil, fmt.Errorf("charts array is empty")
	}

	var created []string
	for _, c := range charts {
		localDB, err := s.localdb.GetDatabase(c.LocalDBBlockID)
		if err != nil {
			return nil, fmt.Errorf("resolve localdb %s: %w", c.LocalDBBlockID, err)
		}

		xCol := resolveColumnRef(localDB.ConfigJSON, c.XColumn)
		yCol := resolveColumnRef(localDB.ConfigJSON, c.YColumn)

		w, h := 540.0, 420.0
		if c.Width != nil {
			w = *c.Width
		}
		if c.Height != nil {
			h = *c.Height
		}

		var x, y float64
		if c.X != nil && c.Y != nil {
			x, y = *c.X, *c.Y
		} else {
			existing, _ := s.blocks.ListBlocks(pageID)
			x, y = s.layout.NextPosition(existing, w, h)
		}

		block, err := s.blocks.CreateBlock(pageID, "chart", x, y, w, h)
		if err != nil {
			return nil, fmt.Errorf("create chart block: %w", err)
		}
		if s.plugins != nil {
			_ = s.plugins.OnCreate(block.ID, pageID, "chart")
		}

		config := map[string]any{
			"chartType": c.ChartType,
			"title":     c.Title,
			"data":      []any{},
			"series":    []any{},
			"pipeline": map[string]any{
				"stages": []any{
					map[string]any{"type": "source", "databaseId": localDB.ID},
				},
				"viz": map[string]any{
					"xAxis":  xCol,
					"series": []string{yCol},
				},
			},
		}
		data, _ := json.Marshal(config)
		if err := s.blocks.UpdateBlockContent(block.ID, string(data)); err != nil {
			return nil, fmt.Errorf("set chart config: %w", err)
		}
		created = append(created, block.ID)
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(map[string]any{"count": len(created), "created": created})
}
