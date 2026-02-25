package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/robfig/cron/v3"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/dbclient"
	"notes/internal/etl/sources"
	"notes/internal/neovim"
	"notes/internal/secret"
	"notes/internal/storage"
	"notes/internal/terminal"
)

// App is the main Wails application struct.
// All exported methods are available as Wails bindings.
type App struct {
	ctx context.Context

	db        *storage.DB
	notebooks *storage.NotebookStore
	blocks    *storage.BlockStore
	conns     *storage.ConnectionStore
	undos     *storage.UndoStore
	nvim      *neovim.Bridge
	term      *terminal.Manager

	// Track which block is being edited
	editingBlockID string

	// Local Database plugin
	localDBStore *storage.LocalDatabaseStore

	// Database plugin
	secrets          secret.SecretStore
	dbConnStore      *storage.DBConnectionStore
	dbResultStore    *storage.QueryResultStore
	activeConnectors map[string]dbclient.Connector // connID → open connector
	connectorsMu     sync.Mutex

	// ETL plugin
	etlStore       *storage.ETLStore
	etlWatcher     *fsnotify.Watcher
	etlWatchCancel context.CancelFunc
	etlCron        *cron.Cron
}

// New creates a new App.
func New() *App {
	return &App{}
}

// Startup is called when the app starts.
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
	a.notebooks = storage.NewNotebookStore(db)
	a.blocks = storage.NewBlockStore(db)
	a.conns = storage.NewConnectionStore(db)
	a.undos = storage.NewUndoStore(db)

	// Local Database plugin store
	a.localDBStore = storage.NewLocalDatabaseStore(db)

	// Database plugin stores
	a.secrets = secret.NewKeychainStore()
	a.dbConnStore = storage.NewDBConnectionStore(db)
	a.dbResultStore = storage.NewQueryResultStore(db)
	a.activeConnectors = make(map[string]dbclient.Connector)

	// ETL plugin store
	a.etlStore = storage.NewETLStore(db)
	sources.SetBlockResolver(&appBlockResolver{app: a})
	sources.SetDBProvider(&appDBProvider{app: a})
	sources.SetHTTPBlockResolver(&appHTTPBlockResolver{app: a})
	a.startETLWatchers()

	// Embedded terminal: PTY output → base64 → frontend event
	a.term = terminal.New(terminalDataCallback(a), terminalExitCallback(a))

	// Neovim bridge for file watching (still used for live preview updates)
	nvim, err := neovim.New(func(blockID, content string) {
		block, err := a.blocks.GetBlock(blockID)
		if err != nil {
			return
		}
		block.Content = content
		a.blocks.UpdateBlock(block)
		wailsRuntime.EventsEmit(ctx, "block:content-updated", map[string]string{
			"blockId": blockID,
			"content": content,
		})
	})
	if err != nil {
		wailsRuntime.LogErrorf(ctx, "Failed to create neovim bridge: %v", err)
	}
	a.nvim = nvim
}

// Shutdown is called when the app is closing.
func (a *App) Shutdown(ctx context.Context) {
	if a.term != nil {
		a.term.Close()
	}
	if a.nvim != nil {
		a.nvim.Close()
	}
	a.stopETLWatchers()
	// Close all active database connectors
	a.connectorsMu.Lock()
	for _, c := range a.activeConnectors {
		c.Close()
	}
	a.activeConnectors = nil
	a.connectorsMu.Unlock()

	if a.db != nil {
		a.db.Close()
	}
}
