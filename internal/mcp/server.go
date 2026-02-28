package mcpserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"notes/internal/domain"
	"notes/internal/service"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Server is the MCP server for the Notes app.
// It exposes tools, resources, and prompts so AI agents can interact with the canvas.
type Server struct {
	mcp      *server.MCPServer
	emitter  EventEmitter
	approval *ApprovalQueue
	layout   *LayoutEngine

	// Services (injected from app layer)
	notebooks *service.NotebookService
	blocks    *service.BlockService
	localdb   *service.LocalDBService
	etl       *service.ETLService
	database  *service.DatabaseService
	plugins   *service.GoPluginRegistry

	// Active page context (set by set_active_page tool)
	activePageID string
}

// Deps holds all dependencies passed from the App layer to the MCP server.
type Deps struct {
	Emitter    EventEmitter
	Notebooks  *service.NotebookService
	Blocks     *service.BlockService
	LocalDB    *service.LocalDBService
	ETL        *service.ETLService
	Database   *service.DatabaseService
	Plugins    *service.GoPluginRegistry
	ApprovalDB *sql.DB // When set, use SQLite-based approval (standalone mode)
}

// New creates and configures a new MCP server with all tools and resources.
func New(ctx context.Context, deps Deps) *Server {
	approval := NewApprovalQueue(ctx, deps.Emitter)
	if deps.ApprovalDB != nil {
		approval.SetDB(deps.ApprovalDB)
	}
	s := &Server{
		emitter:   deps.Emitter,
		approval:  approval,
		layout:    NewLayoutEngine(),
		notebooks: deps.Notebooks,
		blocks:    deps.Blocks,
		localdb:   deps.LocalDB,
		etl:       deps.ETL,
		database:  deps.Database,
		plugins:   deps.Plugins,
	}

	s.mcp = server.NewMCPServer(
		"notes-mcp",
		"1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(true, false),
		server.WithPromptCapabilities(true),
	)

	// Phase 1: Core
	s.registerNavigationTools()
	s.registerBlockTools()
	s.registerResources()

	// Phase 2: Content tools
	s.registerMarkdownTools()
	s.registerCodeTools()
	s.registerChartTools()
	s.registerLocalDBTools()
	s.registerDrawingTools()

	// Phase 3: Integration tools
	s.registerDatabaseTools()
	s.registerETLTools()
	s.registerHTTPTools()
	s.registerPrompts()

	// Plugin-extensible tools (auto-discovered)
	s.registerPluginTools()

	return s
}

// ServeStdio starts the MCP server on stdin/stdout.
func (s *Server) ServeStdio() error {
	log.Println("[MCP] Starting stdio server...")
	return server.ServeStdio(s.mcp)
}

// Approve forwards a user approval to the approval queue.
func (s *Server) Approve(actionID string) {
	s.approval.Approve(actionID)
}

// Reject forwards a user rejection to the approval queue.
func (s *Server) Reject(actionID string) {
	s.approval.Reject(actionID)
}

// ── Helpers ────────────────────────────────────────────────

// emitBlocksChanged notifies the frontend that blocks have changed on a page.
func (s *Server) emitBlocksChanged(ctx context.Context, pageID string) {
	s.emitter.Emit(ctx, "mcp:blocks-changed", map[string]string{"pageId": pageID})
}

// textResult creates a simple text tool result.
func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			mcp.TextContent{Type: "text", Text: text},
		},
	}
}

// jsonResult serializes v to JSON and wraps it in a text tool result.
func jsonResult(v any) (*mcp.CallToolResult, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal result: %w", err)
	}
	return textResult(string(data)), nil
}

// resolvePageID returns the pageID from tool args or falls back to activePageID.
func (s *Server) resolvePageID(args map[string]any) (string, error) {
	if pid, ok := args["pageId"].(string); ok && pid != "" {
		return pid, nil
	}
	if s.activePageID != "" {
		return s.activePageID, nil
	}
	return "", fmt.Errorf("no pageId provided and no active page set (use set_active_page first)")
}

// getBlockForTool retrieves a block and validates it exists.
func (s *Server) getBlockForTool(args map[string]any) (*domain.Block, error) {
	blockID, ok := args["blockId"].(string)
	if !ok || blockID == "" {
		return nil, fmt.Errorf("blockId is required")
	}
	return s.blocks.GetBlock(blockID)
}
