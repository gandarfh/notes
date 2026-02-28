package app

import (
	"context"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	mcpserver "notes/internal/mcp"
	"notes/internal/plugins"
	"notes/internal/secret"
	"notes/internal/service"
	"notes/internal/storage"
)

// noopEmitter is a no-op EventEmitter used in MCP-only mode (no Wails frontend).
type noopEmitter struct{}

func (noopEmitter) Emit(_ context.Context, _ string, _ any) {}

// ServeMCP runs the app as a standalone MCP server on stdin/stdout with no GUI.
// It initializes storage, services, and runs the MCP server until interrupted.
func ServeMCP() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	homeDir, _ := os.UserHomeDir()
	dataDir := filepath.Join(homeDir, ".local", "share", "notes")
	dbPath := filepath.Join(dataDir, "notes.db")

	db, err := storage.New(dbPath, filepath.Join(dataDir, "notebooks"))
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Storage stores
	notebooksStore := storage.NewNotebookStore(db)
	blocksStore := storage.NewBlockStore(db)
	localDBStore := storage.NewLocalDatabaseStore(db)
	etlStore := storage.NewETLStore(db)
	dbConnStore := storage.NewDBConnectionStore(db)

	secretStore := secret.NewKeychainStore()
	emitter := noopEmitter{}

	// Services
	blocksSvc := service.NewBlockService(blocksStore, dataDir, emitter)
	localdbSvc := service.NewLocalDBService(localDBStore)
	databaseSvc := service.NewDatabaseService(dbConnStore, secretStore, blocksStore)
	etlSvc := service.NewETLService(etlStore, localDBStore, emitter)
	notebooksSvc := service.NewNotebookService(notebooksStore, blocksSvc, storage.NewConnectionStore(db), dataDir, emitter)

	// Plugin registry
	pluginRegistry := service.NewGoPluginRegistry()
	pluginRegistry.Register(plugins.NewLocalDBPlugin(localdbSvc))
	pluginRegistry.Register(plugins.NewHTTPPlugin(blocksStore))

	// Wire ETL adapters so database source can resolve block references
	setupETLAdapters(&App{
		blocks:   blocksSvc,
		database: databaseSvc,
	})

	// Create and serve MCP
	mcpSrv := mcpserver.New(ctx, mcpserver.Deps{
		Emitter:    emitter,
		Notebooks:  notebooksSvc,
		Blocks:     blocksSvc,
		LocalDB:    localdbSvc,
		ETL:        etlSvc,
		Database:   databaseSvc,
		Plugins:    pluginRegistry,
		ApprovalDB: db.Conn(), // Enable SQLite-based approval IPC
	})

	log.Println("[MCP] Starting standalone stdio server...")
	if err := mcpSrv.ServeStdio(); err != nil {
		log.Fatalf("MCP server error: %v", err)
	}
}
