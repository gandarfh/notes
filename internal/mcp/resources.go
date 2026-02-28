package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

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
	if len(uri) > len(prefix)+len(suffix) {
		middle := uri[len(prefix):]
		if idx := indexOf(middle, '/'); idx > 0 {
			return middle[:idx]
		}
	}
	return ""
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}
