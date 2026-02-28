package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	mcpserver "notes/internal/mcp"
	"notes/internal/neovim"
	"notes/internal/plugins"
	"notes/internal/secret"
	"notes/internal/service"
	"notes/internal/storage"
	"notes/internal/terminal"
)

// App is the main Wails application struct.
// It is a thin Wails adapter; all business logic lives in the service layer.
// All exported methods are available as Wails bindings.
type App struct {
	ctx context.Context

	// Core storage
	db    *storage.DB
	undos *storage.UndoStore
	// Canvas connections (arrows between blocks) — kept here for app_connection.go
	conns *storage.ConnectionStore

	// Services (business logic layer)
	notebooks *service.NotebookService
	blocks    *service.BlockService
	etl       *service.ETLService
	localdb   *service.LocalDBService
	database  *service.DatabaseService
	window    *service.WindowSettingsService

	// Plugin registry
	pluginRegistry *service.GoPluginRegistry

	// MCP server (agents connect via stdio)
	mcpServer *mcpserver.Server

	// Page change watcher (detects external DB changes from MCP standalone)
	watcher *pageWatcher

	// Terminal / editor
	term           *terminal.Manager
	nvim           *neovim.Bridge
	editingBlockID string
}

// New creates a new App.
func New() *App {
	return &App{}
}

// ── EventEmitter implementation ─────────────────────────────
// Allows services to emit Wails events without importing wailsRuntime directly.

func (a *App) Emit(_ context.Context, event string, data any) {
	wailsRuntime.EventsEmit(a.ctx, event, data)
}

// ── Startup ────────────────────────────────────────────────

// Startup is called when the app starts. Sets up storage, services, and plugins.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// macOS: disable "Press and Hold" accent popup so key repeat works in the WebView.
	exec.Command("defaults", "write", "com.wails.notes", "ApplePressAndHoldEnabled", "-bool", "false").Run()
	exec.Command("defaults", "write", "-g", "ApplePressAndHoldEnabled", "-bool", "false").Run()

	homeDir, _ := os.UserHomeDir()
	dataDir := filepath.Join(homeDir, ".local", "share", "notes")
	dbPath := filepath.Join(dataDir, "notes.db")

	db, err := storage.New(dbPath, filepath.Join(dataDir, "notebooks"))
	if err != nil {
		wailsRuntime.LogFatalf(ctx, "Failed to open database: %v", err)
		return
	}
	a.db = db

	// ── Storage stores ──────────────────────────────────────
	notebooksStore := storage.NewNotebookStore(db)
	blocksStore := storage.NewBlockStore(db)
	connsStore := storage.NewConnectionStore(db)
	undoStore := storage.NewUndoStore(db)
	localDBStore := storage.NewLocalDatabaseStore(db)
	etlStore := storage.NewETLStore(db)
	dbConnStore := storage.NewDBConnectionStore(db)

	a.undos = undoStore
	a.conns = connsStore

	// Secret store (macOS Keychain)
	secretStore := secret.NewKeychainStore()

	// ── Services ────────────────────────────────────────────
	// App itself implements EventEmitter — emits Wails events to the frontend.
	a.blocks = service.NewBlockService(blocksStore, dataDir, a)
	a.localdb = service.NewLocalDBService(localDBStore)
	a.database = service.NewDatabaseService(dbConnStore, secretStore, blocksStore)
	a.etl = service.NewETLService(etlStore, localDBStore, a)
	a.notebooks = service.NewNotebookService(notebooksStore, a.blocks, connsStore, dataDir, a)
	a.window = service.NewWindowSettingsService(db)

	// Restore saved window size
	win := a.window.LoadWindowSize()
	wailsRuntime.WindowSetSize(ctx, win.Width, win.Height)

	// ── Plugin Registry ─────────────────────────────────────
	a.pluginRegistry = service.NewGoPluginRegistry()
	a.pluginRegistry.Register(plugins.NewLocalDBPlugin(a.localdb))
	a.pluginRegistry.Register(plugins.NewHTTPPlugin(blocksStore))

	// ETL block resolver adapters (remain in app layer since they need ctx)
	setupETLAdapters(a)

	// Start ETL watchers (cron + file watch)
	a.etl.RestartWatchers(ctx)

	// ── Terminal / Neovim ───────────────────────────────────
	a.term = terminal.New(terminalDataCallback(a), terminalExitCallback(a))

	nvim, err := neovim.New(func(blockID, content string) {
		if err := a.blocks.UpdateBlockContent(blockID, content); err != nil {
			return
		}
		wailsRuntime.EventsEmit(ctx, "block:content-updated", map[string]string{
			"blockId": blockID,
			"content": content,
		})
	})
	if err != nil {
		wailsRuntime.LogErrorf(ctx, "Failed to create neovim bridge: %v", err)
	}
	a.nvim = nvim

	// ── MCP Server ──────────────────────────────────────────
	a.mcpServer = mcpserver.New(ctx, mcpserver.Deps{
		Emitter:   a,
		Notebooks: a.notebooks,
		Blocks:    a.blocks,
		LocalDB:   a.localdb,
		ETL:       a.etl,
		Database:  a.database,
		Plugins:   a.pluginRegistry,
	})
	// Start MCP stdio server in background goroutine
	go func() {
		if err := a.mcpServer.ServeStdio(); err != nil {
			wailsRuntime.LogErrorf(ctx, "MCP server error: %v", err)
		}
	}()

	// ── Page Watcher ────────────────────────────────────────
	// Polls DB for changes made by external MCP process, emits Wails events.
	a.watcher = newPageWatcher(ctx, a)
	a.watcher.Start()
}

// ── Shutdown ────────────────────────────────────────────────

// Shutdown is called when the app is closing.
// Waits up to 3 seconds for in-progress ETL jobs to finish (graceful shutdown).
func (a *App) Shutdown(ctx context.Context) {
	// 1. Persist window size before anything closes
	if a.window != nil {
		w, h := wailsRuntime.WindowGetSize(ctx)
		_ = a.window.SaveWindowSize(w, h)
	}

	// 2. Stop accepting new terminal/editor input
	if a.term != nil {
		a.term.Close()
	}
	if a.nvim != nil {
		a.nvim.Close()
	}

	// 3. Stop page watcher
	if a.watcher != nil {
		a.watcher.Stop()
	}

	// 4. Graceful ETL shutdown — wait up to 3s for running jobs
	if a.etl != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		a.etl.WaitRunning(shutdownCtx)
		a.etl.Stop()
	}

	// 4. Close all active database connectors
	if a.database != nil {
		a.database.Close()
	}

	// 5. Close the SQLite database
	if a.db != nil {
		a.db.Close()
	}
}

// ── MCP Approval Bindings ──────────────────────────────────

// ApproveAction approves a pending MCP destructive action.
func (a *App) ApproveAction(actionID string) {
	// In-process mode: notify via channel
	if a.mcpServer != nil {
		a.mcpServer.Approve(actionID)
	}
	// Cross-process mode: update SQLite row so standalone MCP unblocks
	a.db.Conn().Exec(
		`UPDATE mcp_approvals SET status = 'approved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
		actionID,
	)
}

// RejectAction rejects a pending MCP destructive action.
func (a *App) RejectAction(actionID string) {
	// In-process mode: notify via channel
	if a.mcpServer != nil {
		a.mcpServer.Reject(actionID)
	}
	// Cross-process mode: update SQLite row so standalone MCP unblocks
	a.db.Conn().Exec(
		`UPDATE mcp_approvals SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
		actionID,
	)
}
