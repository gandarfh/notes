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
					Text: fmt.Sprintf(`Create a system architecture diagram for "%s" using the drawing tools. Follow these steps:

1. Identify the main components of the system
2. Use add_drawing_element to create a rectangle for each component, with descriptive text
3. Use add_drawing_arrow to connect related components, showing data flow or dependencies
4. Add labels to arrows using update_arrow_label to describe the connections
5. Use arrange_drawing_elements to ensure the layout is clean
6. Add a write_markdown block with a legend or description of the architecture

Use consistent colors: #3b82f6 for primary components, #10b981 for databases, #f59e0b for external services.`, systemName),
				},
			},
		},
	}, nil
}
