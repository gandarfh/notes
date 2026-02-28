package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"notes/internal/service"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerETLTools() {
	s.mcp.AddTool(mcp.NewTool("create_etl_job",
		mcp.WithDescription("Create an ETL block + sync job (source → LocalDB)"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("name", mcp.Description("Job name"), mcp.Required()),
		mcp.WithString("sourceType", mcp.Description("ETL source type (use list_etl_sources to see available types)"), mcp.Required()),
		mcp.WithString("sourceConfigJSON", mcp.Description("Source configuration as JSON"), mcp.Required()),
		mcp.WithString("localdbBlockId", mcp.Description("Target LocalDB block ID"), mcp.Required()),
	), s.handleCreateETLJob)

	s.mcp.AddTool(mcp.NewTool("list_etl_sources",
		mcp.WithDescription("List available ETL source types with their configuration schemas"),
	), s.handleListETLSources)

	s.mcp.AddTool(mcp.NewTool("run_etl_job",
		mcp.WithDescription("🛑 DESTRUCTIVE: Execute an ETL sync job. May overwrite LocalDB data. Requires user approval."),
		mcp.WithString("jobId", mcp.Description("ETL job ID"), mcp.Required()),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleRunETLJob)

	s.mcp.AddTool(mcp.NewTool("preview_etl_source",
		mcp.WithDescription("Preview data from an ETL source without persisting anything"),
		mcp.WithString("sourceType", mcp.Description("Source type"), mcp.Required()),
		mcp.WithString("sourceConfigJSON", mcp.Description("Source configuration as JSON"), mcp.Required()),
	), s.handlePreviewETLSource)
}

func (s *Server) handleCreateETLJob(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	name, _ := args["name"].(string)
	sourceType, _ := args["sourceType"].(string)
	sourceConfigStr, _ := args["sourceConfigJSON"].(string)
	localdbBlockID, _ := args["localdbBlockId"].(string)

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	// Create the ETL block
	existing, _ := s.blocks.ListBlocks(pageID)
	x, y := s.layout.NextPosition(existing, 600, 480)

	block, err := s.blocks.CreateBlock(pageID, "etl", x, y, 600, 480)
	if err != nil {
		return nil, fmt.Errorf("create etl block: %w", err)
	}
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, "etl")
	}

	// Parse source config
	var sourceConfig map[string]any
	if err := json.Unmarshal([]byte(sourceConfigStr), &sourceConfig); err != nil {
		return nil, fmt.Errorf("parse sourceConfig: %w", err)
	}

	// Resolve localdb block → database ID
	localDB, dbErr := s.localdb.GetDatabase(localdbBlockID)
	if dbErr != nil {
		return nil, fmt.Errorf("get target localdb: %w", dbErr)
	}

	// Create the ETL job
	input := service.CreateETLJobInput{
		Name:         name,
		SourceType:   sourceType,
		SourceConfig: sourceConfig,
		TargetDBID:   localDB.ID,
		Enabled:      true,
	}
	job, err := s.etl.CreateJob(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("create ETL job: %w", err)
	}

	// Store job reference in block content
	ref, _ := json.Marshal(map[string]string{"jobId": job.ID})
	_ = s.blocks.UpdateBlockContent(block.ID, string(ref))

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(map[string]any{
		"block": block,
		"job":   job,
	})
}

func (s *Server) handleListETLSources(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sources := s.etl.ListSources()
	return jsonResult(sources)
}

func (s *Server) handleRunETLJob(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	jobID := req.GetString("jobId", "")
	if jobID == "" {
		return nil, fmt.Errorf("jobId is required")
	}

	approved, err := s.approval.Request("run_etl_job",
		fmt.Sprintf("Run ETL job %s (may overwrite LocalDB data)", jobID))
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	result, err := s.etl.RunJob(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("run ETL job: %w", err)
	}
	return jsonResult(result)
}

func (s *Server) handlePreviewETLSource(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sourceType := req.GetString("sourceType", "")
	sourceConfigStr := req.GetString("sourceConfigJSON", "")
	if sourceType == "" || sourceConfigStr == "" {
		return nil, fmt.Errorf("sourceType and sourceConfigJSON are required")
	}

	preview, err := s.etl.PreviewSource(ctx, sourceType, sourceConfigStr)
	if err != nil {
		return nil, fmt.Errorf("preview source: %w", err)
	}
	return jsonResult(preview)
}
