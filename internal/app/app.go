package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/dbclient"
	"notes/internal/domain"
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

	// Database plugin
	secrets          secret.SecretStore
	dbConnStore      *storage.DBConnectionStore
	dbResultStore    *storage.QueryResultStore
	activeConnectors map[string]dbclient.Connector // connID → open connector
	connectorsMu     sync.Mutex
}

// New creates a new App.
func New() *App {
	return &App{}
}

// Startup is called when the app starts.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// macOS: disable "Press and Hold" accent popup so key repeat works in the WebView.
	// Without this, holding j/k in Neovim won't repeat — the OS shows accent alternatives instead.
	// Set for both the bundle ID (production) and global domain (wails dev).
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

	// Database plugin stores
	a.secrets = secret.NewKeychainStore()
	a.dbConnStore = storage.NewDBConnectionStore(db)
	a.dbResultStore = storage.NewQueryResultStore(db)
	a.activeConnectors = make(map[string]dbclient.Connector)

	// Embedded terminal: PTY output → base64 → frontend event
	a.term = terminal.New(
		func(data []byte) {
			encoded := base64.StdEncoding.EncodeToString(data)
			wailsRuntime.EventsEmit(ctx, "terminal:data", encoded)
		},
		func(exitLine int) {
			// Editor exited → read file, update block, notify frontend
			if a.editingBlockID != "" {
				a.onEditorExit(a.editingBlockID)
			}
			wailsRuntime.EventsEmit(ctx, "terminal:exit", map[string]int{
				"cursorLine": exitLine,
			})
		},
	)

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

// ============================================================
// Embedded Terminal (Neovim)
// ============================================================

// TerminalWrite sends input from xterm.js to the PTY.
func (a *App) TerminalWrite(data string) error {
	return a.term.Write(data)
}

// TerminalResize resizes the PTY.
func (a *App) TerminalResize(cols, rows int) error {
	return a.term.Resize(uint16(cols), uint16(rows))
}

// OpenBlockInEditor opens the block's .md file in the embedded Neovim terminal.
func (a *App) OpenBlockInEditor(blockID string, lineNumber int) error {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return err
	}
	if b.FilePath == "" {
		return fmt.Errorf("block %s has no file path", blockID)
	}

	a.editingBlockID = blockID

	// Start file watching for live preview
	if a.nvim != nil {
		a.nvim.WatchFile(blockID, b.FilePath)
	}

	// Open file in embedded terminal with Neovim at line
	return a.term.OpenFile(b.FilePath, lineNumber)
}

// CloseEditor closes the embedded terminal session.
func (a *App) CloseEditor() {
	if a.editingBlockID != "" && a.nvim != nil {
		a.nvim.StopWatching(a.editingBlockID)
	}
	a.term.Close()
	a.editingBlockID = ""
}

func (a *App) onEditorExit(blockID string) {
	block, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return
	}
	if block.FilePath == "" {
		return
	}

	content, err := os.ReadFile(block.FilePath)
	if err != nil {
		return
	}

	block.Content = strings.TrimSpace(string(content))
	a.blocks.UpdateBlock(block)
	wailsRuntime.EventsEmit(a.ctx, "block:content-updated", map[string]string{
		"blockId": blockID,
		"content": block.Content,
	})

	if a.nvim != nil {
		a.nvim.StopWatching(blockID)
	}
	a.editingBlockID = ""
}

// ============================================================
// Notebooks
// ============================================================

func (a *App) ListNotebooks() ([]domain.Notebook, error) {
	return a.notebooks.ListNotebooks()
}

func (a *App) CreateNotebook(name string) (*domain.Notebook, error) {
	nb := &domain.Notebook{
		ID:   uuid.New().String(),
		Name: name,
		Icon: "📓",
	}
	if err := a.notebooks.CreateNotebook(nb); err != nil {
		return nil, fmt.Errorf("create notebook: %w", err)
	}

	dir := filepath.Join(a.db.DataDir(), nb.ID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create notebook dir: %w", err)
	}

	return nb, nil
}

func (a *App) RenameNotebook(id, name string) error {
	nb, err := a.notebooks.GetNotebook(id)
	if err != nil {
		return err
	}
	nb.Name = name
	return a.notebooks.UpdateNotebook(nb)
}

func (a *App) DeleteNotebook(id string) error {
	pages, _ := a.notebooks.ListPages(id)
	for _, p := range pages {
		a.conns.DeleteConnectionsByPage(p.ID)
		a.blocks.DeleteBlocksByPage(p.ID)
	}
	a.notebooks.DeletePagesByNotebook(id)

	dir := filepath.Join(a.db.DataDir(), id)
	os.RemoveAll(dir)

	return a.notebooks.DeleteNotebook(id)
}

// ============================================================
// Pages
// ============================================================

func (a *App) ListPages(notebookID string) ([]domain.Page, error) {
	return a.notebooks.ListPages(notebookID)
}

func (a *App) CreatePage(notebookID, name string) (*domain.Page, error) {
	p := &domain.Page{
		ID:           uuid.New().String(),
		NotebookID:   notebookID,
		Name:         name,
		ViewportZoom: 1.0,
	}
	if err := a.notebooks.CreatePage(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (a *App) GetPageState(pageID string) (*domain.PageState, error) {
	wailsRuntime.LogInfof(a.ctx, "[GetPageState] loading page: %s", pageID)
	page, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return nil, err
	}
	blocks, err := a.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}
	connections, err := a.conns.ListConnections(pageID)
	if err != nil {
		return nil, err
	}

	if blocks == nil {
		blocks = []domain.Block{}
	}
	if connections == nil {
		connections = []domain.Connection{}
	}

	// Note: image block content is loaded lazily via GetImageData

	return &domain.PageState{
		Page:        *page,
		Blocks:      blocks,
		Connections: connections,
	}, nil
}

func (a *App) RenamePage(id, name string) error {
	p, err := a.notebooks.GetPage(id)
	if err != nil {
		return err
	}
	p.Name = name
	return a.notebooks.UpdatePage(p)
}

func (a *App) UpdateViewport(pageID string, x, y, zoom float64) error {
	p, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return err
	}
	p.ViewportX = x
	p.ViewportY = y
	p.ViewportZoom = zoom
	return a.notebooks.UpdatePage(p)
}

func (a *App) UpdateDrawingData(pageID string, data string) error {
	p, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return err
	}
	p.DrawingData = data
	return a.notebooks.UpdatePage(p)
}

func (a *App) DeletePage(id string) error {
	a.conns.DeleteConnectionsByPage(id)
	a.blocks.DeleteBlocksByPage(id)
	return a.notebooks.DeletePage(id)
}

// ============================================================
// Blocks
// ============================================================

func (a *App) CreateBlock(pageID string, blockType string, x, y, w, h float64) (*domain.Block, error) {
	blockID := uuid.New().String()

	b := &domain.Block{
		ID:        blockID,
		PageID:    pageID,
		Type:      domain.BlockType(blockType),
		X:         x,
		Y:         y,
		Width:     w,
		Height:    h,
		Content:   "",
		StyleJSON: "{}",
	}

	if b.Type == domain.BlockTypeMarkdown {
		page, err := a.notebooks.GetPage(pageID)
		if err != nil {
			return nil, err
		}
		filePath := filepath.Join(a.db.DataDir(), page.NotebookID, blockID+".md")
		if err := os.WriteFile(filePath, []byte("# New Note\n\n"), 0644); err != nil {
			return nil, fmt.Errorf("create md file: %w", err)
		}
		b.FilePath = filePath
		b.Content = "# New Note\n\n"
	}

	if b.Type == domain.BlockTypeCode {
		page, err := a.notebooks.GetPage(pageID)
		if err != nil {
			return nil, err
		}
		// Default to .txt; content may contain JSON config {"ext":"go"}
		ext := ".txt"
		if b.Content != "" {
			var cfg struct {
				Ext string `json:"ext"`
			}
			if json.Unmarshal([]byte(b.Content), &cfg) == nil && cfg.Ext != "" {
				ext = "." + strings.TrimPrefix(cfg.Ext, ".")
			}
		}
		filePath := filepath.Join(a.db.DataDir(), page.NotebookID, blockID+ext)
		if err := os.WriteFile(filePath, []byte(""), 0644); err != nil {
			return nil, fmt.Errorf("create code file: %w", err)
		}
		b.FilePath = filePath
		b.Content = ""
	}

	if err := a.blocks.CreateBlock(b); err != nil {
		return nil, err
	}

	return b, nil
}

func (a *App) UpdateBlockPosition(blockID string, x, y, w, h float64) error {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return err
	}
	b.X = x
	b.Y = y
	b.Width = w
	b.Height = h
	return a.blocks.UpdateBlock(b)
}

func (a *App) UpdateBlockContent(blockID, content string) error {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return err
	}
	b.Content = content

	if (b.Type == domain.BlockTypeMarkdown || b.Type == domain.BlockTypeCode) && b.FilePath != "" {
		if err := os.WriteFile(b.FilePath, []byte(content), 0644); err != nil {
			return fmt.Errorf("write file: %w", err)
		}
	}

	return a.blocks.UpdateBlock(b)
}

func (a *App) DeleteBlock(blockID string) error {
	// NOTE: Do NOT delete physical files (images, .md) — undo needs the filePath reference intact
	a.conns.DeleteConnectionsByBlock(blockID)

	if a.nvim != nil {
		a.nvim.StopWatching(blockID)
	}

	return a.blocks.DeleteBlock(blockID)
}

// PickTextFile opens a native file picker for selecting any text/code file.
func (a *App) PickTextFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Text File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Markdown", Pattern: "*.md"},
			{DisplayName: "Go", Pattern: "*.go"},
			{DisplayName: "JSON", Pattern: "*.json"},
			{DisplayName: "YAML", Pattern: "*.yaml;*.yml"},
			{DisplayName: "TypeScript", Pattern: "*.ts;*.tsx"},
			{DisplayName: "JavaScript", Pattern: "*.js;*.jsx"},
			{DisplayName: "Python", Pattern: "*.py"},
			{DisplayName: "Rust", Pattern: "*.rs"},
			{DisplayName: "Shell", Pattern: "*.sh;*.bash;*.zsh"},
			{DisplayName: "SQL", Pattern: "*.sql"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	return path, err
}

// ChangeBlockFileExt renames a code block's physical file to a new extension.
// Returns the new filePath so the frontend can update its state.
func (a *App) ChangeBlockFileExt(blockID, newExt string) (string, error) {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return "", err
	}
	if b.FilePath == "" {
		return "", fmt.Errorf("block %s has no file path", blockID)
	}

	ext := "." + strings.TrimPrefix(newExt, ".")
	dir := filepath.Dir(b.FilePath)
	base := filepath.Base(b.FilePath)
	nameNoExt := strings.TrimSuffix(base, filepath.Ext(base))
	newPath := filepath.Join(dir, nameNoExt+ext)

	if newPath != b.FilePath {
		if err := os.Rename(b.FilePath, newPath); err != nil {
			return "", fmt.Errorf("rename file: %w", err)
		}
		b.FilePath = newPath
		if err := a.blocks.UpdateBlock(b); err != nil {
			return "", err
		}
	}

	return newPath, nil
}

// UpdateBlockFilePath points a block to an external text file.
// It reads the file content and updates both filePath and content in the DB.
func (a *App) UpdateBlockFilePath(blockID, newPath string) (string, error) {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return "", err
	}

	// Read the external file
	data, err := os.ReadFile(newPath)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}

	content := strings.TrimSpace(string(data))
	b.FilePath = newPath
	b.Content = content

	if err := a.blocks.UpdateBlock(b); err != nil {
		return "", err
	}

	return content, nil
}

// GetImageData reads an image file and returns it as a base64 data URL.
// Called lazily by the frontend for each image block.
func (a *App) GetImageData(blockID string) (string, error) {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return "", err
	}
	if b.FilePath == "" {
		return "", nil
	}

	data, err := os.ReadFile(b.FilePath)
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(b.FilePath))
	mime := "image/png"
	switch ext {
	case ".jpg", ".jpeg":
		mime = "image/jpeg"
	case ".webp":
		mime = "image/webp"
	case ".gif":
		mime = "image/gif"
	}

	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// SaveImageFile saves a base64 data URL as an image file on disk
// and updates the block's filePath. This avoids storing large
// base64 data in the database content column.
func (a *App) SaveImageFile(blockID, dataURL string) (string, error) {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return "", err
	}

	page, err := a.notebooks.GetPage(b.PageID)
	if err != nil {
		return "", err
	}

	// Parse data URL: "data:image/png;base64,iVBOR..."
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid data URL")
	}

	// Detect extension from mime type
	ext := ".png"
	if strings.Contains(parts[0], "image/jpeg") {
		ext = ".jpg"
	} else if strings.Contains(parts[0], "image/webp") {
		ext = ".webp"
	} else if strings.Contains(parts[0], "image/gif") {
		ext = ".gif"
	}

	imageData, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}

	dir := filepath.Join(a.db.DataDir(), page.NotebookID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	filePath := filepath.Join(dir, blockID+ext)
	if err := os.WriteFile(filePath, imageData, 0644); err != nil {
		return "", fmt.Errorf("write image file: %w", err)
	}

	b.FilePath = filePath
	b.Content = "" // Don't store base64 in DB
	if err := a.blocks.UpdateBlock(b); err != nil {
		return "", err
	}

	return filePath, nil
}

// ============================================================
// Undo Tree
// ============================================================

func (a *App) LoadUndoTree(pageID string) (*storage.UndoTree, error) {
	return a.undos.LoadTree(pageID)
}

func (a *App) PushUndoNode(pageID, nodeID, parentID, label, snapshotJSON string) (*storage.UndoNode, error) {
	return a.undos.PushNode(pageID, nodeID, parentID, label, snapshotJSON)
}

func (a *App) GoToUndoNode(pageID, nodeID string) error {
	return a.undos.GoTo(pageID, nodeID)
}

// RestorePageBlocks fully replaces all blocks for a page (used by undo/redo).
func (a *App) RestorePageBlocks(pageID string, blocks []domain.Block) error {
	return a.blocks.ReplacePageBlocks(pageID, blocks)
}

// ============================================================
// Connections
// ============================================================

func (a *App) CreateConnection(pageID, fromBlockID, toBlockID string) (*domain.Connection, error) {
	c := &domain.Connection{
		ID:          uuid.New().String(),
		PageID:      pageID,
		FromBlockID: fromBlockID,
		ToBlockID:   toBlockID,
		Color:       "#666666",
		Style:       domain.ConnectionStyleSolid,
	}
	if err := a.conns.CreateConnection(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (a *App) UpdateConnection(id, label, color, style string) error {
	c, err := a.conns.GetConnection(id)
	if err != nil {
		return err
	}
	c.Label = label
	c.Color = color
	c.Style = domain.ConnectionStyle(style)
	return a.conns.UpdateConnection(c)
}

func (a *App) DeleteConnection(id string) error {
	return a.conns.DeleteConnection(id)
}

// PickDatabaseFile opens a native file picker for selecting a database file.
func (a *App) PickDatabaseFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Database File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Database Files", Pattern: "*.db;*.sqlite;*.sqlite3;*.s3db"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	return path, err
}

// ============================================================
// Database Plugin
// ============================================================

// DBConnView is the frontend-safe view of a database connection (no password).
type DBConnView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	SSLMode  string `json:"sslMode"`
}

// CreateDBConnInput is the input for creating/updating a database connection.
type CreateDBConnInput struct {
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"sslMode"`
}

// QueryResultView is the frontend view of a query result.
type QueryResultView struct {
	Columns      []string `json:"columns"`
	Rows         [][]any  `json:"rows"`
	TotalRows    int      `json:"totalRows"`
	HasMore      bool     `json:"hasMore"`
	DurationMs   int      `json:"durationMs"`
	Error        string   `json:"error"`
	IsWrite      bool     `json:"isWrite"`
	AffectedRows int      `json:"affectedRows"`
	Query        string   `json:"query"`
	PrimaryKeys  []string `json:"primaryKeys,omitempty"`
}

func (a *App) ListDatabaseConnections() ([]DBConnView, error) {
	conns, err := a.dbConnStore.ListConnections()
	if err != nil {
		return nil, err
	}
	views := make([]DBConnView, len(conns))
	for i, c := range conns {
		views[i] = DBConnView{
			ID: c.ID, Name: c.Name, Driver: string(c.Driver),
			Host: c.Host, Port: c.Port, Database: c.Database,
			Username: c.Username, SSLMode: c.SSLMode,
		}
	}
	return views, nil
}

func (a *App) CreateDatabaseConnection(input CreateDBConnInput) (*DBConnView, error) {
	id := uuid.New().String()
	conn := &domain.DatabaseConnection{
		ID:       id,
		Name:     input.Name,
		Driver:   domain.DatabaseDriver(input.Driver),
		Host:     input.Host,
		Port:     input.Port,
		Database: input.Database,
		Username: input.Username,
		SSLMode:  input.SSLMode,
	}

	if err := a.dbConnStore.CreateConnection(conn); err != nil {
		return nil, fmt.Errorf("save connection: %w", err)
	}

	// Store password in Keychain
	if input.Password != "" {
		if err := a.secrets.Set("notes-db:conn:"+id, []byte(input.Password)); err != nil {
			// Rollback DB entry
			a.dbConnStore.DeleteConnection(id)
			return nil, fmt.Errorf("save password: %w", err)
		}
	}

	return &DBConnView{
		ID: id, Name: input.Name, Driver: input.Driver,
		Host: input.Host, Port: input.Port, Database: input.Database,
		Username: input.Username, SSLMode: input.SSLMode,
	}, nil
}

func (a *App) UpdateDatabaseConnection(id string, input CreateDBConnInput) error {
	conn, err := a.dbConnStore.GetConnection(id)
	if err != nil {
		return err
	}

	conn.Name = input.Name
	conn.Driver = domain.DatabaseDriver(input.Driver)
	conn.Host = input.Host
	conn.Port = input.Port
	conn.Database = input.Database
	conn.Username = input.Username
	conn.SSLMode = input.SSLMode

	if err := a.dbConnStore.UpdateConnection(conn); err != nil {
		return err
	}

	// Update password if provided
	if input.Password != "" {
		if err := a.secrets.Set("notes-db:conn:"+id, []byte(input.Password)); err != nil {
			return fmt.Errorf("update password: %w", err)
		}
	}

	// Close cached connector if exists (force reconnect)
	a.connectorsMu.Lock()
	if c, ok := a.activeConnectors[id]; ok {
		c.Close()
		delete(a.activeConnectors, id)
	}
	a.connectorsMu.Unlock()

	return nil
}

func (a *App) DeleteDatabaseConnection(id string) error {
	// Close cached connector
	a.connectorsMu.Lock()
	if c, ok := a.activeConnectors[id]; ok {
		c.Close()
		delete(a.activeConnectors, id)
	}
	a.connectorsMu.Unlock()

	// Delete from keychain
	a.secrets.Delete("notes-db:conn:" + id)

	return a.dbConnStore.DeleteConnection(id)
}

func (a *App) TestDatabaseConnection(id string) error {
	connector, err := a.getOrCreateConnector(id)
	if err != nil {
		return err
	}
	return connector.TestConnection(context.Background())
}

func (a *App) IntrospectDatabase(connectionID string) (*dbclient.SchemaInfo, error) {
	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		return nil, err
	}
	return connector.Introspect(context.Background())
}

func (a *App) ExecuteQuery(blockID, connectionID, query string, fetchSize int) (*QueryResultView, error) {
	wailsRuntime.LogDebugf(a.ctx, "[DB] ExecuteQuery blockID=%s connID=%s fetchSize=%d", blockID, connectionID, fetchSize)
	wailsRuntime.LogDebugf(a.ctx, "[DB] Query: %s", query)

	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		wailsRuntime.LogErrorf(a.ctx, "[DB] getOrCreateConnector failed: %v", err)
		return nil, err
	}

	if fetchSize <= 0 {
		fetchSize = 50
	}

	start := time.Now()
	page, err := connector.Execute(context.Background(), query, fetchSize)
	durationMs := int(time.Since(start).Milliseconds())

	wailsRuntime.LogDebugf(a.ctx, "[DB] Execute done in %dms, err=%v", durationMs, err)

	if err != nil {
		wailsRuntime.LogErrorf(a.ctx, "[DB] Execute error: %v", err)
		// Cache the error result
		result := &domain.QueryResult{
			ID:          uuid.New().String(),
			BlockID:     blockID,
			Query:       query,
			ColumnsJSON: "[]",
			RowsJSON:    "[]",
			DurationMs:  durationMs,
			Error:       err.Error(),
		}
		a.dbResultStore.UpsertResult(result)
		return &QueryResultView{Error: err.Error(), DurationMs: durationMs, Query: query}, nil
	}

	wailsRuntime.LogDebugf(a.ctx, "[DB] Page: cols=%d rows=%d totalFetched=%d hasMore=%v isWrite=%v",
		len(page.Columns), len(page.Rows), page.TotalFetched, page.HasMore, page.IsWrite)

	// Serialize to JSON for caching
	colJSON, _ := json.Marshal(page.Columns)
	rowJSON, _ := json.Marshal(page.Rows)

	result := &domain.QueryResult{
		ID:           uuid.New().String(),
		BlockID:      blockID,
		Query:        query,
		ColumnsJSON:  string(colJSON),
		RowsJSON:     string(rowJSON),
		TotalRows:    page.TotalFetched,
		HasMore:      page.HasMore,
		DurationMs:   durationMs,
		IsWrite:      page.IsWrite,
		AffectedRows: page.AffectedRows,
	}
	a.dbResultStore.UpsertResult(result)

	return &QueryResultView{
		Columns:      page.Columns,
		Rows:         page.Rows,
		TotalRows:    page.TotalFetched,
		HasMore:      page.HasMore,
		DurationMs:   durationMs,
		IsWrite:      page.IsWrite,
		AffectedRows: page.AffectedRows,
		Query:        query,
		PrimaryKeys:  page.PrimaryKeys,
	}, nil
}

func (a *App) FetchMoreRows(connectionID string, fetchSize int) (*QueryResultView, error) {
	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	page, err := connector.FetchMore(context.Background(), fetchSize)
	durationMs := int(time.Since(start).Milliseconds())

	if err != nil {
		return &QueryResultView{Error: err.Error(), DurationMs: durationMs}, nil
	}

	return &QueryResultView{
		Columns:      page.Columns,
		Rows:         page.Rows,
		TotalRows:    page.TotalFetched,
		HasMore:      page.HasMore,
		DurationMs:   durationMs,
		IsWrite:      page.IsWrite,
		AffectedRows: page.AffectedRows,
		PrimaryKeys:  page.PrimaryKeys,
	}, nil
}

func (a *App) ApplyMutations(connectionID, table string, mutations []dbclient.Mutation) (*dbclient.MutationResult, error) {
	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		return nil, err
	}
	return connector.ApplyMutations(context.Background(), table, mutations)
}

func (a *App) GetCachedResult(blockID string) (*QueryResultView, error) {
	result, err := a.dbResultStore.GetResultByBlock(blockID)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}

	var columns []string
	var rows [][]any
	json.Unmarshal([]byte(result.ColumnsJSON), &columns)
	json.Unmarshal([]byte(result.RowsJSON), &rows)

	return &QueryResultView{
		Columns:      columns,
		Rows:         rows,
		TotalRows:    result.TotalRows,
		HasMore:      result.HasMore,
		DurationMs:   result.DurationMs,
		Error:        result.Error,
		IsWrite:      result.IsWrite,
		AffectedRows: result.AffectedRows,
		Query:        result.Query,
	}, nil
}

func (a *App) ClearCachedResult(blockID string) error {
	return a.dbResultStore.DeleteResultsByBlock(blockID)
}

func (a *App) SaveBlockDatabaseConfig(blockID string, config string) error {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return err
	}
	b.Content = config
	return a.blocks.UpdateBlock(b)
}

// getOrCreateConnector retrieves a cached connector or creates a new one.
func (a *App) getOrCreateConnector(connID string) (dbclient.Connector, error) {
	a.connectorsMu.Lock()
	defer a.connectorsMu.Unlock()

	if c, ok := a.activeConnectors[connID]; ok {
		return c, nil
	}

	conn, err := a.dbConnStore.GetConnection(connID)
	if err != nil {
		return nil, fmt.Errorf("connection not found: %w", err)
	}

	// Retrieve password from Keychain
	password := ""
	pwBytes, err := a.secrets.Get("notes-db:conn:" + connID)
	if err == nil && pwBytes != nil {
		password = string(pwBytes)
	}

	connector, err := dbclient.NewConnector(conn, password)
	if err != nil {
		return nil, fmt.Errorf("create connector: %w", err)
	}

	a.activeConnectors[connID] = connector
	return connector, nil
}
