package app

import (
	"context"
	"fmt"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// pageWatcher polls the database for changes to the active page,
// detecting external modifications (e.g. from MCP standalone process)
// and emitting Wails events so the frontend auto-refreshes.
type pageWatcher struct {
	ctx context.Context
	app *App
	mu  sync.Mutex
	// Active page tracking
	pageID     string
	notebookID string
	lastDrawn  string // page updated_at fingerprint
	lastBlock  string // blocks fingerprint (count + max updated_at)
	// Page list tracking (sidebar refresh)
	lastPageList string // pages fingerprint (count + max updated_at)
	stopCh       chan struct{}
	// Track emitted approval IDs to avoid infinite re-emission
	emittedApprovals map[string]bool
}

func newPageWatcher(ctx context.Context, app *App) *pageWatcher {
	return &pageWatcher{ctx: ctx, app: app, emittedApprovals: map[string]bool{}}
}

// SetPage updates the watched page ID. Called when user navigates to a page.
func (w *pageWatcher) SetPage(pageID, notebookID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pageID = pageID
	w.notebookID = notebookID
	// Reset tracked state when switching pages
	w.lastDrawn = ""
	w.lastBlock = ""
	w.lastPageList = ""
}

// Start begins the polling loop. Should be called once on app startup.
func (w *pageWatcher) Start() {
	w.stopCh = make(chan struct{})
	go w.pollLoop()
}

// Stop terminates the polling loop.
func (w *pageWatcher) Stop() {
	if w.stopCh != nil {
		close(w.stopCh)
	}
}

func (w *pageWatcher) pollLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			w.check()
		case <-w.stopCh:
			return
		case <-w.ctx.Done():
			return
		}
	}
}

func (w *pageWatcher) check() {
	w.mu.Lock()
	pageID := w.pageID
	notebookID := w.notebookID
	w.mu.Unlock()

	if pageID == "" {
		return
	}

	db := w.app.db.Conn()

	// ── Check page drawing_data updated_at ──────────────
	var pageUpdated string
	err := db.QueryRow(`SELECT COALESCE(updated_at, '') FROM pages WHERE id = ?`, pageID).Scan(&pageUpdated)
	if err != nil {
		return
	}

	// ── Check blocks MAX(updated_at) and count ──────────
	var blockUpdated string
	var blockCount int
	err = db.QueryRow(
		`SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM blocks WHERE page_id = ?`, pageID,
	).Scan(&blockCount, &blockUpdated)
	if err != nil {
		return
	}

	// ── Check page list changes (sidebar) ───────────────
	var pageListFingerprint string
	if notebookID != "" {
		var pageCount int
		var pagesMaxUpdated string
		err = db.QueryRow(
			`SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM pages WHERE notebook_id = ?`, notebookID,
		).Scan(&pageCount, &pagesMaxUpdated)
		if err == nil {
			pageListFingerprint = fmt.Sprintf("%d:%s", pageCount, pagesMaxUpdated)
		}
	}

	// ── Build fingerprints and compare ──────────────────
	drawingFingerprint := pageUpdated
	blockFingerprint := fmt.Sprintf("%d:%s", blockCount, blockUpdated)

	w.mu.Lock()
	drawingChanged := w.lastDrawn != "" && w.lastDrawn != drawingFingerprint
	blocksChanged := w.lastBlock != "" && w.lastBlock != blockFingerprint
	pagesChanged := w.lastPageList != "" && pageListFingerprint != "" && w.lastPageList != pageListFingerprint
	w.lastDrawn = drawingFingerprint
	w.lastBlock = blockFingerprint
	if pageListFingerprint != "" {
		w.lastPageList = pageListFingerprint
	}
	w.mu.Unlock()

	// ── Emit events ────────────────────────────────────
	changes := 0
	if drawingChanged {
		wailsRuntime.EventsEmit(w.ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
		changes++
	}
	if blocksChanged {
		wailsRuntime.EventsEmit(w.ctx, "mcp:blocks-changed", map[string]string{"pageId": pageID})
		changes++
	}
	if pagesChanged {
		wailsRuntime.EventsEmit(w.ctx, "mcp:pages-changed", map[string]string{"notebookId": notebookID})
		changes++
	}

	// Note: mcp:activity is emitted only for pending approvals (below), not for
	// generic page changes, since those also occur from manual user edits.

	// ── Check pending MCP approvals (cross-process IPC) ─
	rows, err := db.Query(`SELECT id, tool, description, created_at, metadata FROM mcp_approvals WHERE status = 'pending'`)
	if err == nil {
		for rows.Next() {
			var id, tool, desc, createdAt, metadata string
			if rows.Scan(&id, &tool, &desc, &createdAt, &metadata) == nil {
				w.mu.Lock()
				alreadySent := w.emittedApprovals[id]
				if !alreadySent {
					w.emittedApprovals[id] = true
				}
				w.mu.Unlock()
				if !alreadySent {
					wailsRuntime.EventsEmit(w.ctx, "mcp:activity", map[string]any{
						"changes": 1,
						"pageId":  pageID,
					})
					wailsRuntime.EventsEmit(w.ctx, "mcp:approval-required", map[string]string{
						"id":          id,
						"tool":        tool,
						"description": desc,
						"createdAt":   createdAt,
						"metadata":    metadata,
					})
				}
			}
		}
		rows.Close()
	}

	// Clean up tracking for resolved/deleted approvals (standalone MCP deletes after reading)
	w.mu.Lock()
	for id := range w.emittedApprovals {
		var count int
		if db.QueryRow(`SELECT COUNT(*) FROM mcp_approvals WHERE id = ? AND status = 'pending'`, id).Scan(&count) == nil && count == 0 {
			delete(w.emittedApprovals, id)
		}
	}
	w.mu.Unlock()
}
