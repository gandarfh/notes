package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

const chartStagesDescription = `Optional JSON array of pipeline stages to apply after the source. Stages transform data before visualization. Each stage has a "type" and stage-specific fields. Available types:
- filter: {conditions: [{column, op (eq|neq|gt|lt|gte|lte|contains|not_contains|is_empty|is_not_empty), value}], logic: "and"|"or"}
- group: {groupBy: ["col1"], metrics: [{column, agg (count|sum|avg|min|max), as?: "output_name"}]}
- compute: {columns: [{name, expression}]} — use {column_name} refs, supports math (+,-,*,/) and string concat
- sort: {column, direction: "asc"|"desc"}
- limit: {count: number}
- percent: {column, as?: "output_name"} — adds percentage-of-total column
- join: {databaseId, leftKey, rightKey, joinType: "inner"|"left"} — join with another LocalDB
- pivot: {rowKeys: ["col"], pivotColumn, valueColumns: ["col"], showTotal?: bool} — pivot table
- date_part: {field, part (year|month|day|hour|minute|weekday|week), targetField}
- string: {field, op (upper|lower|trim|replace|concat|split|substring), ...}
- math: {field, op (round|ceil|floor|abs)}
- type_cast: {field, castType (number|string|bool|date|datetime)}
- default_value: {field, defaultValue}
Example: [{"type":"group","groupBy":["category"],"metrics":[{"column":"sales","agg":"sum","as":"total"}]},{"type":"sort","column":"total","direction":"desc"}]`

func (s *Server) registerChartTools() {
	s.mcp.AddTool(mcp.NewTool("create_chart",
		mcp.WithDescription("Create a chart block linked to a LocalDB. Supports powerful data pipeline stages (filter, group, join, pivot, compute, sort, percent, and more) applied in sequence to transform data before visualization."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("localdbBlockId", mcp.Description("Block ID of the LocalDB data source"), mcp.Required()),
		mcp.WithString("chartType", mcp.Description("Chart type: bar, line, area, pie, scatter, number, etc."), mcp.Required()),
		mcp.WithString("xColumn", mcp.Description("Column name or ID for X axis"), mcp.Required()),
		mcp.WithString("yColumn", mcp.Description("Column name or ID for Y axis"), mcp.Required()),
		mcp.WithString("title", mcp.Description("Chart title (optional)")),
		mcp.WithString("stagesJSON", mcp.Description(chartStagesDescription)),
	), s.handleCreateChart)

	s.mcp.AddTool(mcp.NewTool("batch_create_charts",
		mcp.WithDescription("Create multiple chart blocks at once. Pass a JSON array of chart objects."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("charts",
			mcp.Description("JSON array of chart objects [{localdbBlockId, chartType, xColumn, yColumn, title?, stagesJSON?, x?, y?, width?, height?}, ...]"),
			mcp.Required(),
		),
	), s.handleBatchCreateCharts)
}

// parseStagesJSON parses a stagesJSON value that may come as a string or raw JSON array.
func parseStagesJSON(raw any) ([]any, error) {
	if raw == nil {
		return nil, nil
	}
	var jsonStr string
	switch v := raw.(type) {
	case string:
		jsonStr = v
	default:
		b, _ := json.Marshal(v)
		jsonStr = string(b)
	}
	if jsonStr == "" {
		return nil, nil
	}
	var stages []any
	if err := json.Unmarshal([]byte(jsonStr), &stages); err != nil {
		return nil, fmt.Errorf("parse stagesJSON: %w", err)
	}
	return stages, nil
}

// buildPipelineStages creates the stages array: source first, then optional extra stages.
func buildPipelineStages(databaseID string, extraStages []any) []any {
	stages := []any{
		map[string]any{"type": "source", "databaseId": databaseID},
	}
	stages = append(stages, extraStages...)
	return stages
}

// resolveStagesColumnRefs walks pipeline stages and resolves column name references to UUIDs.
func resolveStagesColumnRefs(stages []any, configJSON string) []any {
	resolve := func(ref string) string { return resolveColumnRef(configJSON, ref) }
	resolveArr := func(arr []any) []any {
		out := make([]any, len(arr))
		for i, v := range arr {
			if s, ok := v.(string); ok {
				out[i] = resolve(s)
			} else {
				out[i] = v
			}
		}
		return out
	}

	resolved := make([]any, len(stages))
	for i, raw := range stages {
		s, ok := raw.(map[string]any)
		if !ok {
			resolved[i] = raw
			continue
		}
		// Clone to avoid mutating original
		out := make(map[string]any, len(s))
		for k, v := range s {
			out[k] = v
		}

		switch out["type"] {
		case "filter":
			if conds, ok := out["conditions"].([]any); ok {
				newConds := make([]any, len(conds))
				for j, c := range conds {
					if cm, ok := c.(map[string]any); ok {
						nc := make(map[string]any, len(cm))
						for k, v := range cm {
							nc[k] = v
						}
						if col, ok := nc["column"].(string); ok {
							nc["column"] = resolve(col)
						}
						newConds[j] = nc
					} else {
						newConds[j] = c
					}
				}
				out["conditions"] = newConds
			}
		case "group":
			if gb, ok := out["groupBy"].([]any); ok {
				out["groupBy"] = resolveArr(gb)
			}
			if metrics, ok := out["metrics"].([]any); ok {
				newMetrics := make([]any, len(metrics))
				for j, m := range metrics {
					if mm, ok := m.(map[string]any); ok {
						nm := make(map[string]any, len(mm))
						for k, v := range mm {
							nm[k] = v
						}
						if col, ok := nm["column"].(string); ok {
							nm["column"] = resolve(col)
						}
						newMetrics[j] = nm
					} else {
						newMetrics[j] = m
					}
				}
				out["metrics"] = newMetrics
			}
		case "sort":
			if col, ok := out["column"].(string); ok {
				out["column"] = resolve(col)
			}
		case "date_part":
			if f, ok := out["field"].(string); ok {
				out["field"] = resolve(f)
			}
		case "percent":
			if col, ok := out["column"].(string); ok {
				out["column"] = resolve(col)
			}
		case "pivot":
			if rk, ok := out["rowKeys"].([]any); ok {
				out["rowKeys"] = resolveArr(rk)
			}
			if pc, ok := out["pivotColumn"].(string); ok {
				out["pivotColumn"] = resolve(pc)
			}
			if vc, ok := out["valueColumns"].([]any); ok {
				out["valueColumns"] = resolveArr(vc)
			}
		case "string", "math", "type_cast", "default_value":
			if f, ok := out["field"].(string); ok {
				out["field"] = resolve(f)
			}
		case "join":
			if lk, ok := out["leftKey"].(string); ok {
				out["leftKey"] = resolve(lk)
			}
			if rk, ok := out["rightKey"].(string); ok {
				out["rightKey"] = resolve(rk)
			}
		}
		resolved[i] = out
	}
	return resolved
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

	// Parse optional pipeline stages
	extraStages, err := parseStagesJSON(args["stagesJSON"])
	if err != nil {
		return nil, err
	}

	// Resolve localdb block → database (pipeline uses database ID, not block ID)
	localDB, err := s.localdb.GetDatabase(localdbBlockID)
	if err != nil {
		return nil, fmt.Errorf("resolve localdb: %w", err)
	}

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
			"stages": buildPipelineStages(localDB.ID, extraStages),
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
		StagesJSON     any      `json:"stagesJSON"`
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

		xCol := c.XColumn
		yCol := c.YColumn

		// Parse optional pipeline stages
		extraStages, err := parseStagesJSON(c.StagesJSON)
		if err != nil {
			return nil, err
		}

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
				"stages": buildPipelineStages(localDB.ID, extraStages),
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
