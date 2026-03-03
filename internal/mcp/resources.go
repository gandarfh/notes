package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerResources() {
	// ── notes://notebooks ──────────────────────────────
	s.mcp.AddResource(mcp.NewResource(
		"notes://notebooks",
		"All Notebooks",
		mcp.WithMIMEType("application/json"),
	), s.handleNotebooksResource)

	// ── notes://page/{pageId}/blocks ───────────────────
	s.mcp.AddResourceTemplate(
		mcp.NewResourceTemplate(
			"notes://page/{pageId}/blocks",
			"Blocks on a Page",
		),
		s.handlePageBlocksResource,
	)

	// ── notes://guides/workflows ───────────────────────
	s.mcp.AddResource(mcp.NewResource(
		"notes://guides/workflows",
		"Workflow Guide — correct step ordering for common tasks",
		mcp.WithMIMEType("text/markdown"),
	), s.handleWorkflowGuideResource)
}

func (s *Server) handleNotebooksResource(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	notebooks, err := s.notebooks.ListNotebooks()
	if err != nil {
		return nil, err
	}

	type notebookSummary struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}

	var summaries []notebookSummary
	for _, n := range notebooks {
		summaries = append(summaries, notebookSummary{ID: n.ID, Name: n.Name})
	}

	data, _ := json.MarshalIndent(summaries, "", "  ")
	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:      "notes://notebooks",
			MIMEType: "application/json",
			Text:     string(data),
		},
	}, nil
}

func (s *Server) handlePageBlocksResource(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	uri := req.Params.URI
	// Extract pageId from URI: notes://page/{pageId}/blocks
	var pageID string
	if _, err := fmt.Sscanf(uri, "notes://page/%s/blocks", &pageID); err != nil {
		// Try alternative parsing
		pageID = extractPageIDFromURI(uri)
	}
	if pageID == "" {
		return nil, fmt.Errorf("could not extract pageId from URI: %s", uri)
	}

	blocks, err := s.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}

	summaries := make([]blockSummary, len(blocks))
	for i, b := range blocks {
		summaries[i] = summarizeBlock(b)
	}

	data, _ := json.MarshalIndent(summaries, "", "  ")
	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:      uri,
			MIMEType: "application/json",
			Text:     string(data),
		},
	}, nil
}

// extractPageIDFromURI extracts page ID from "notes://page/{id}/blocks"
func extractPageIDFromURI(uri string) string {
	// notes://page/abc-123/blocks -> abc-123
	const prefix = "notes://page/"
	const suffix = "/blocks"
	if len(uri) > len(prefix)+len(suffix) && strings.HasPrefix(uri, prefix) {
		middle := uri[len(prefix):]
		if idx := strings.IndexByte(middle, '/'); idx > 0 {
			return middle[:idx]
		}
	}
	return ""
}

const workflowGuideContent = `# Notes MCP — Workflow Guide

Correct step ordering for common tasks. Following these workflows prevents field name mismatches and empty charts.

## ETL to Chart Pipeline

1. Create data source — HTTP block, database query block, or have file path ready
2. Preview source data — use ` + "`preview_etl_source`" + ` to see actual column names
3. Create LocalDB — use ` + "`create_local_database`" + ` with columns matching the preview
4. Create ETL job — use ` + "`create_etl_job`" + ` connecting source to LocalDB
5. Run ETL job — call ` + "`run_etl_job`" + ` and wait for completion
6. Verify data — call ` + "`list_localdb_rows`" + ` and ` + "`read_localdb_content`" + ` to get exact column schema
7. Create charts — only after step 6, using exact column names from the schema

Do not create charts before running the ETL job. Do not guess column names. Do not skip the preview step.

## Dashboard with Sample Data

1. Create title markdown block
2. Create LocalDB with columns — save the blockId
3. Add rows with ` + "`add_localdb_rows`" + `
4. Verify data with ` + "`list_localdb_rows`" + ` — confirm column names
5. Create charts using exact column names from step 4

## Column Name Resolution

Charts and pipeline stages accept column names (human-readable) — the system resolves them to internal IDs automatically. Always verify column names from ` + "`read_localdb_content`" + ` or ` + "`list_localdb_rows`" + ` responses.
`

func (s *Server) handleWorkflowGuideResource(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:      "notes://guides/workflows",
			MIMEType: "text/markdown",
			Text:     workflowGuideContent,
		},
	}, nil
}
