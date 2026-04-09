package mcpserver

import (
	"context"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerPrompts() {
	s.mcp.AddPrompt(mcp.NewPrompt("create_dashboard",
		mcp.WithPromptDescription("Guide through creating a multi-block dashboard on a canvas page"),
		mcp.WithArgument("topic",
			mcp.ArgumentDescription("Topic or title for the dashboard"),
			mcp.RequiredArgument(),
		),
	), s.handleDashboardPrompt)

	s.mcp.AddPrompt(mcp.NewPrompt("document_api",
		mcp.WithPromptDescription("Create structured API documentation with markdown, HTTP blocks, and code samples"),
		mcp.WithArgument("apiName",
			mcp.ArgumentDescription("Name of the API to document"),
			mcp.RequiredArgument(),
		),
		mcp.WithArgument("baseUrl",
			mcp.ArgumentDescription("Base URL of the API"),
			mcp.RequiredArgument(),
		),
	), s.handleDocumentAPIPrompt)

	s.mcp.AddPrompt(mcp.NewPrompt("data_pipeline",
		mcp.WithPromptDescription("Set up an ETL → LocalDB → Chart data pipeline"),
		mcp.WithArgument("sourceType",
			mcp.ArgumentDescription("ETL source type (e.g. csv, api, database)"),
			mcp.RequiredArgument(),
		),
		mcp.WithArgument("description",
			mcp.ArgumentDescription("What this pipeline does"),
			mcp.RequiredArgument(),
		),
	), s.handleDataPipelinePrompt)

	s.mcp.AddPrompt(mcp.NewPrompt("system_diagram",
		mcp.WithPromptDescription("Create a system architecture diagram using drawing shapes and arrows"),
		mcp.WithArgument("systemName",
			mcp.ArgumentDescription("Name of the system to diagram"),
			mcp.RequiredArgument(),
		),
	), s.handleSystemDiagramPrompt)
}

func (s *Server) handleDashboardPrompt(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	topic := req.Params.Arguments["topic"]
	return &mcp.GetPromptResult{
		Description: fmt.Sprintf("Create a dashboard for: %s", topic),
		Messages: []mcp.PromptMessage{
			{
				Role: mcp.RoleUser,
				Content: mcp.TextContent{
					Type: "text",
					Text: fmt.Sprintf(`Create a dashboard about "%s" on the active page. Follow these steps in order — do not create charts before data exists.

1. write_markdown — create a title block: "# %s Dashboard"
2. create_local_database — define relevant columns, save the returned blockId
3. add_localdb_rows — insert sample data using the blockId from step 2
4. list_localdb_rows — verify data was inserted and confirm column names
5. create_chart — only now, using the exact column names from step 4`, topic, topic),
				},
			},
		},
	}, nil
}

func (s *Server) handleDocumentAPIPrompt(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	apiName := req.Params.Arguments["apiName"]
	baseURL := req.Params.Arguments["baseUrl"]
	return &mcp.GetPromptResult{
		Description: fmt.Sprintf("Document the %s API", apiName),
		Messages: []mcp.PromptMessage{
			{
				Role: mcp.RoleUser,
				Content: mcp.TextContent{
					Type: "text",
					Text: fmt.Sprintf(`Create API documentation for "%s" (Base URL: %s). Follow these steps:

1. Use write_markdown to create an overview block: "# %s API", with a brief description
2. For each endpoint, create:
   - An HTTP block (create_http_block) configured with the correct method, URL, and sample headers/body
   - A code block (write_code) with a sample request/response in JSON
3. Add a markdown block at the end with authentication notes and error codes

Organize blocks in a clean layout with the overview at top, endpoints below.`, apiName, baseURL, apiName),
				},
			},
		},
	}, nil
}

func (s *Server) handleDataPipelinePrompt(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	sourceType := req.Params.Arguments["sourceType"]
	description := req.Params.Arguments["description"]
	return &mcp.GetPromptResult{
		Description: fmt.Sprintf("Set up a %s data pipeline", sourceType),
		Messages: []mcp.PromptMessage{
			{
				Role: mcp.RoleUser,
				Content: mcp.TextContent{
					Type: "text",
					Text: fmt.Sprintf(`Set up a data pipeline: %s. Follow these steps strictly in order — each depends on the previous one.

1. Create the data source for type "%s":
   - http_block: create_http_block with the endpoint, then execute_http_request to test
   - database: create_query_block to verify the query
   - csv/json: use preview_etl_source to validate the file path
   - http: just have the URL ready
   Save any returned block IDs for the ETL config.

2. preview_etl_source — preview the source data to see actual column names and shape.

3. create_local_database — columns matching the preview from step 2. Save the returned blockId.

4. create_etl_job — connect source to LocalDB, include transforms as needed. Save the returned jobId.

5. run_etl_job — populate the LocalDB. Wait for completion.

6. list_localdb_rows + read_localdb_content — verify data loaded and get exact column schema.

7. create_chart or batch_create_charts — only after step 6, using exact column names from the schema.

Do not create charts before the ETL job runs. Do not guess column names. Do not skip the preview step.`, description, sourceType),
				},
			},
		},
	}, nil
}

func (s *Server) handleSystemDiagramPrompt(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	systemName := req.Params.Arguments["systemName"]
	return &mcp.GetPromptResult{
		Description: fmt.Sprintf("Create a system diagram for: %s", systemName),
		Messages: []mcp.PromptMessage{
			{
				Role: mcp.RoleUser,
				Content: mcp.TextContent{
					Type: "text",
					Text: fmt.Sprintf(`Create a system architecture diagram for "%s" using the drawing tools.

SEMANTIC COLOR PALETTE (use backgroundColor, NOT fillColor):
  Our components:  backgroundColor #1971c2, strokeColor #e8e8f0
  External systems: backgroundColor #e8e8f0, strokeColor #828298
  Databases/Storage: backgroundColor #b2f2bb, strokeColor #2f9e44
  Sidecars/Intermediaries: backgroundColor #ffec99, strokeColor #f08c00
  Errors/Failures: backgroundColor #ffc9c9, strokeColor #e03131
  Events/Async:    backgroundColor #eebefa, strokeColor #9c36b5
  HTTP Endpoints:  backgroundColor #a5d8ff, strokeColor #1971c2

LAYOUT RULES:
  1. Main flow goes LEFT-TO-RIGHT with shapes of 220×60 max.
  2. Details, databases, or annotations go BELOW the main flow, connected by vertical arrows.
  3. Each logical section of the system is a separate add_drawing_group.
  4. Keep 1000px+ vertical distance between groups/sections.
  5. Keep 160px horizontal gap between shapes in the same row.
  6. Keep 140px vertical gap between a shape and its detail below.
  7. Start at x=100, y=100 for the first section.
  8. NEVER use width >= 600 on a single shape (rendering bug). Split into smaller shapes instead.
  9. Keep text SHORT (1-2 lines max). If something is complex, create a group with internal diagram instead of a big text block.

DIAGRAM STRUCTURE:
  For each section, create one group with:
  - Top row: main flow (L→R arrows between small shapes)
  - Bottom row: supporting details (databases, configs, events) connected by vertical arrows

STEPS:
  1. Break "%s" into logical sections (e.g., "Registration", "Processing", "Delivery").
  2. For each section, use add_drawing_group first.
  3. Use batch_add_drawing_elements for all shapes in that section.
  4. Use add_drawing_arrow sequentially to connect shapes (horizontal for flow, vertical for details).
  5. Move to the next section 1000px below.`, systemName, systemName),
				},
			},
		},
	}, nil
}
