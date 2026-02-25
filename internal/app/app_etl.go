package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/robfig/cron/v3"

	"notes/internal/etl"
	"notes/internal/etl/sources" // register all sources via init() + used by appDBProvider

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// appBlockResolver implements sources.BlockResolver to let
// the database ETL source resolve a block reference to connectionId + query.
type appBlockResolver struct {
	app *App
}

func (r *appBlockResolver) GetBlockContent(_ context.Context, blockID string) (string, string, error) {
	block, err := r.app.blocks.GetBlock(blockID)
	if err != nil {
		return "", "", fmt.Errorf("block %s not found: %w", blockID, err)
	}
	var cfg struct {
		ConnectionID string `json:"connectionId"`
		Query        string `json:"query"`
	}
	if err := json.Unmarshal([]byte(block.Content), &cfg); err != nil {
		return "", "", fmt.Errorf("parse block config: %w", err)
	}
	if cfg.ConnectionID == "" {
		return "", "", fmt.Errorf("block %s has no database connection", blockID)
	}
	return cfg.ConnectionID, cfg.Query, nil
}

// appHTTPBlockResolver implements sources.HTTPBlockResolver to let
// the HTTP ETL source resolve an HTTP block reference to url + method + headers + body.
type appHTTPBlockResolver struct {
	app *App
}

func (r *appHTTPBlockResolver) GetHTTPBlockContent(blockID string) (string, string, string, string, error) {
	block, err := r.app.blocks.GetBlock(blockID)
	if err != nil {
		return "", "", "", "", fmt.Errorf("block %s not found: %w", blockID, err)
	}
	var cfg struct {
		Method  string          `json:"method"`
		URL     string          `json:"url"`
		Headers json.RawMessage `json:"headers"` // can be array or object
		Body    json.RawMessage `json:"body"`    // can be string or object
	}
	if err := json.Unmarshal([]byte(block.Content), &cfg); err != nil {
		return "", "", "", "", fmt.Errorf("parse http block config: %w", err)
	}

	// Resolve headers: convert KV array to JSON object string
	headersStr := ""
	if len(cfg.Headers) > 0 {
		// Try as array of {key, value, enabled}
		var kvPairs []struct {
			Key     string `json:"key"`
			Value   string `json:"value"`
			Enabled bool   `json:"enabled"`
		}
		if json.Unmarshal(cfg.Headers, &kvPairs) == nil {
			hMap := make(map[string]string)
			for _, p := range kvPairs {
				if p.Enabled && p.Key != "" {
					hMap[p.Key] = p.Value
				}
			}
			if len(hMap) > 0 {
				b, _ := json.Marshal(hMap)
				headersStr = string(b)
			}
		} else {
			// Already a JSON object string
			headersStr = string(cfg.Headers)
		}
	}

	// Resolve body: can be { mode, content } object or plain string
	bodyStr := ""
	if len(cfg.Body) > 0 {
		var bodyObj struct {
			Mode    string `json:"mode"`
			Content string `json:"content"`
		}
		if json.Unmarshal(cfg.Body, &bodyObj) == nil && bodyObj.Content != "" {
			bodyStr = bodyObj.Content
		} else {
			// Try as plain string
			var s string
			if json.Unmarshal(cfg.Body, &s) == nil {
				bodyStr = s
			}
		}
	}

	return cfg.URL, cfg.Method, headersStr, bodyStr, nil
}

// appDBProvider implements sources.DBProvider to let
// the database ETL source execute queries against external database connections.
type appDBProvider struct {
	app *App
}

func (p *appDBProvider) ExecuteETLQuery(ctx context.Context, connID, query string, fetchSize int) (*sources.QueryPage, error) {
	connector, err := p.app.getOrCreateConnector(connID)
	if err != nil {
		return nil, err
	}
	page, err := connector.Execute(ctx, query, fetchSize)
	if err != nil {
		return nil, err
	}
	return &sources.QueryPage{
		Columns: page.Columns,
		Rows:    page.Rows,
		HasMore: page.HasMore,
	}, nil
}

func (p *appDBProvider) FetchMoreETLRows(ctx context.Context, connID string, fetchSize int) (*sources.QueryPage, error) {
	connector, err := p.app.getOrCreateConnector(connID)
	if err != nil {
		return nil, err
	}
	page, err := connector.FetchMore(ctx, fetchSize)
	if err != nil {
		return nil, err
	}
	return &sources.QueryPage{
		Columns: page.Columns,
		Rows:    page.Rows,
		HasMore: page.HasMore,
	}, nil
}

// ============================================================
// ETL Sync Jobs
// ============================================================

// ── Create ─────────────────────────────────────────────────

type CreateETLJobInput struct {
	Name          string                `json:"name"`
	SourceType    string                `json:"sourceType"`
	SourceConfig  map[string]any        `json:"sourceConfig"`
	Transforms    []etl.TransformConfig `json:"transforms"`
	TargetDBID    string                `json:"targetDbId"`
	SyncMode      string                `json:"syncMode"`
	DedupeKey     string                `json:"dedupeKey"`
	TriggerType   string                `json:"triggerType"`
	TriggerConfig string                `json:"triggerConfig"`
}

func (a *App) CreateETLJob(input CreateETLJobInput) (*etl.SyncJob, error) {
	// Validate source type exists in registry.
	if _, err := etl.GetSource(input.SourceType); err != nil {
		return nil, err
	}

	job := &etl.SyncJob{
		Name:          input.Name,
		SourceType:    input.SourceType,
		SourceCfg:     input.SourceConfig,
		Transforms:    input.Transforms,
		TargetDBID:    input.TargetDBID,
		SyncMode:      etl.SyncMode(input.SyncMode),
		DedupeKey:     input.DedupeKey,
		TriggerType:   input.TriggerType,
		TriggerConfig: input.TriggerConfig,
		Enabled:       true,
	}

	if job.SyncMode == "" {
		job.SyncMode = etl.SyncReplace
	}
	if job.TriggerType == "" {
		job.TriggerType = "manual"
	}

	if err := a.etlStore.CreateJob(job); err != nil {
		return nil, fmt.Errorf("create etl job: %w", err)
	}
	a.startETLWatchers()
	return job, nil
}

// ── Read ───────────────────────────────────────────────────

func (a *App) GetETLJob(id string) (*etl.SyncJob, error) {
	return a.etlStore.GetJob(id)
}

func (a *App) ListETLJobs() ([]etl.SyncJob, error) {
	return a.etlStore.ListJobs()
}

// ── Update ─────────────────────────────────────────────────

func (a *App) UpdateETLJob(id string, input CreateETLJobInput) error {
	job, err := a.etlStore.GetJob(id)
	if err != nil {
		return err
	}

	job.Name = input.Name
	job.SourceType = input.SourceType
	job.SourceCfg = input.SourceConfig
	job.Transforms = input.Transforms
	job.TargetDBID = input.TargetDBID
	job.SyncMode = etl.SyncMode(input.SyncMode)
	job.DedupeKey = input.DedupeKey
	job.TriggerType = input.TriggerType
	job.TriggerConfig = input.TriggerConfig

	if err := a.etlStore.UpdateJob(job); err != nil {
		return err
	}
	a.startETLWatchers()
	return nil
}

// ── Delete ─────────────────────────────────────────────────

func (a *App) DeleteETLJob(id string) error {
	err := a.etlStore.DeleteJob(id)
	if err == nil {
		a.startETLWatchers()
	}
	return err
}

// ── Run ────────────────────────────────────────────────────

func (a *App) RunETLJob(id string) (*etl.SyncResult, error) {
	job, err := a.etlStore.GetJob(id)
	if err != nil {
		return nil, err
	}

	// Mark as running.
	a.etlStore.UpdateJobStatus(id, "running", "")

	engine := &etl.Engine{
		Dest: &etl.LocalDBWriter{Store: a.localDBStore},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	start := time.Now()
	result, runErr := engine.RunSync(ctx, job)

	// Save run log.
	log := &etl.SyncRunLog{
		JobID:       id,
		StartedAt:   start,
		FinishedAt:  time.Now(),
		Status:      result.Status,
		RowsRead:    result.RowsRead,
		RowsWritten: result.RowsWritten,
	}
	if runErr != nil {
		log.Error = runErr.Error()
	}
	a.etlStore.CreateRunLog(log)

	// Update job status.
	errMsg := ""
	if runErr != nil {
		errMsg = runErr.Error()
	}
	a.etlStore.UpdateJobStatus(id, result.Status, errMsg)

	// Notify frontend that target DB was updated (so LocalDB blocks can refresh).
	if result.Status == "success" && job.TargetDBID != "" {
		wailsRuntime.EventsEmit(a.ctx, "db:updated", map[string]string{
			"databaseId": job.TargetDBID,
			"jobId":      id,
		})
	}

	return result, runErr
}

// ── Preview ────────────────────────────────────────────────

type PreviewResult struct {
	Schema  *etl.Schema  `json:"schema"`
	Records []etl.Record `json:"records"`
}

func (a *App) PreviewETLSource(sourceType string, sourceConfigJSON string) (*PreviewResult, error) {
	var cfg etl.SourceConfig
	if err := json.Unmarshal([]byte(sourceConfigJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse source config: %w", err)
	}

	engine := &etl.Engine{
		Dest: &etl.LocalDBWriter{Store: a.localDBStore},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	records, schema, err := engine.Preview(ctx, sourceType, cfg, 10)
	if err != nil {
		return nil, err
	}

	return &PreviewResult{Schema: schema, Records: records}, nil
}

// ── Schema Discovery ───────────────────────────────────────

// DiscoverETLSchema returns the source schema (column names + types) without reading data.
// Used by the frontend pipeline editor for column autocomplete.
func (a *App) DiscoverETLSchema(sourceType string, sourceConfigJSON string) (*etl.Schema, error) {
	var cfg etl.SourceConfig
	if err := json.Unmarshal([]byte(sourceConfigJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse source config: %w", err)
	}

	source, err := etl.GetSource(sourceType)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return source.Discover(ctx, cfg)
}

// ── Run Logs ───────────────────────────────────────────────

func (a *App) ListETLRunLogs(jobID string) ([]etl.SyncRunLog, error) {
	return a.etlStore.ListRunLogs(jobID, 50)
}

// ── Source Registry ────────────────────────────────────────

func (a *App) ListETLSources() []etl.SourceSpec {
	return etl.ListSources()
}

// ── File Picker ────────────────────────────────────────────

// PickETLFile opens a native file dialog for selecting data files (CSV, JSON, etc.)
func (a *App) PickETLFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Data File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "CSV Files", Pattern: "*.csv;*.tsv"},
			{DisplayName: "JSON Files", Pattern: "*.json;*.jsonl"},
			{DisplayName: "Excel Files", Pattern: "*.xlsx;*.xls"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	return path, err
}

// ── Database Block Discovery ──────────────────────────────

// DatabaseBlockInfo represents a database block that can be referenced by ETL.
type DatabaseBlockInfo struct {
	BlockID      string `json:"blockId"`
	ConnectionID string `json:"connectionId"`
	Query        string `json:"query"`
	Label        string `json:"label"` // human-readable label (connection name + query summary)
}

// ListPageDatabaseBlocks returns all database blocks on a page,
// so the ETL editor can offer them as sources instead of raw SQL input.
func (a *App) ListPageDatabaseBlocks(pageID string) ([]DatabaseBlockInfo, error) {
	blocks, err := a.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}

	var result []DatabaseBlockInfo
	for _, b := range blocks {
		if b.Type != "database" {
			continue
		}
		// Parse the block content to extract connectionId and query.
		var cfg struct {
			ConnectionID string `json:"connectionId"`
			Query        string `json:"query"`
		}
		if err := json.Unmarshal([]byte(b.Content), &cfg); err != nil {
			continue
		}
		if cfg.ConnectionID == "" {
			continue
		}

		// Build a human-readable label from connection name + query
		label := b.ID[:8] // fallback: short block ID
		if conn, err := a.dbConnStore.GetConnection(cfg.ConnectionID); err == nil && conn.Name != "" {
			label = conn.Name
			if cfg.Query != "" {
				// Show a summary of the query (e.g. "users.find" or first 30 chars)
				q := cfg.Query
				if len(q) > 30 {
					q = q[:27] + "…"
				}
				label += " · " + q
			}
		}

		result = append(result, DatabaseBlockInfo{
			BlockID:      b.ID,
			ConnectionID: cfg.ConnectionID,
			Query:        cfg.Query,
			Label:        label,
		})
	}
	return result, nil
}

// ── HTTP Block Discovery ──────────────────────────────────

// HTTPBlockInfo describes an HTTP block on a page (for ETL source selection).
type HTTPBlockInfo struct {
	BlockID string `json:"blockId"`
	Method  string `json:"method"`
	URL     string `json:"url"`
	Label   string `json:"label"`
}

// ListPageHTTPBlocks returns all HTTP blocks on a given page.
func (a *App) ListPageHTTPBlocks(pageID string) ([]HTTPBlockInfo, error) {
	blocks, err := a.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}

	var result []HTTPBlockInfo
	for _, b := range blocks {
		if b.Type != "http" {
			continue
		}
		var cfg struct {
			Method string `json:"method"`
			URL    string `json:"url"`
		}
		if err := json.Unmarshal([]byte(b.Content), &cfg); err != nil {
			continue
		}
		if cfg.URL == "" {
			continue
		}

		method := cfg.Method
		if method == "" {
			method = "GET"
		}

		// Build label: "GET · api.github.com/repos"
		label := method
		if cfg.URL != "" {
			short := cfg.URL
			// Strip protocol prefix
			for _, prefix := range []string{"https://", "http://"} {
				short = strings.TrimPrefix(short, prefix)
			}
			if len(short) > 40 {
				short = short[:37] + "…"
			}
			label += " · " + short
		}

		result = append(result, HTTPBlockInfo{
			BlockID: b.ID,
			Method:  method,
			URL:     cfg.URL,
			Label:   label,
		})
	}
	return result, nil
}

// ── File Watcher ───────────────────────────────────────────

// startETLWatchers sets up fsnotify watchers for all enabled file_watch ETL jobs.
func (a *App) startETLWatchers() {
	// Tear down previous watcher if any.
	a.stopETLWatchers()

	jobs, err := a.etlStore.ListEnabledScheduledJobs()
	if err != nil {
		log.Printf("etl watcher: failed to list jobs: %v", err)
		return
	}

	// Collect file_watch jobs and their paths.
	type watchEntry struct {
		jobID string
		path  string
	}
	var entries []watchEntry
	for _, j := range jobs {
		if j.TriggerType != "file_watch" || j.TriggerConfig == "" {
			continue
		}
		entries = append(entries, watchEntry{jobID: j.ID, path: j.TriggerConfig})
	}

	// ── Cron scheduler for schedule jobs ──
	var cronJobs []struct {
		jobID string
		expr  string
	}
	for _, j := range jobs {
		if j.TriggerType == "schedule" && j.TriggerConfig != "" {
			cronJobs = append(cronJobs, struct {
				jobID string
				expr  string
			}{jobID: j.ID, expr: j.TriggerConfig})
		}
	}

	if len(cronJobs) > 0 {
		c := cron.New()
		for _, cj := range cronJobs {
			jid := cj.jobID // capture for closure
			_, err := c.AddFunc(cj.expr, func() {
				log.Printf("etl cron: running job %s", jid)
				if _, err := a.RunETLJob(jid); err != nil {
					log.Printf("etl cron: job %s failed: %v", jid, err)
				}
				// Emit event to frontend so it can refresh
				wailsRuntime.EventsEmit(a.ctx, "etl:job-completed", jid)
			})
			if err != nil {
				log.Printf("etl cron: invalid expression %q for job %s: %v", cj.expr, cj.jobID, err)
				continue
			}
		}
		c.Start()
		a.etlCron = c
		log.Printf("etl cron: scheduled %d job(s)", len(cronJobs))
	}

	// ── File watchers ──

	if len(entries) == 0 {
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("etl watcher: failed to create watcher: %v", err)
		return
	}
	a.etlWatcher = watcher

	// Build path → jobID mapping and watch directories.
	pathToJob := make(map[string]string)
	watchedDirs := make(map[string]bool)
	for _, e := range entries {
		absPath, err := filepath.Abs(e.path)
		if err != nil {
			log.Printf("etl watcher: bad path %q: %v", e.path, err)
			continue
		}
		pathToJob[absPath] = e.jobID

		// fsnotify watches directories, not individual files.
		dir := filepath.Dir(absPath)
		if !watchedDirs[dir] {
			if err := watcher.Add(dir); err != nil {
				log.Printf("etl watcher: failed to watch dir %q: %v", dir, err)
			} else {
				watchedDirs[dir] = true
			}
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	a.etlWatchCancel = cancel

	go func() {
		// Debounce timers per job to avoid rapid re-runs.
		timers := make(map[string]*time.Timer)

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if !event.Has(fsnotify.Write) && !event.Has(fsnotify.Create) {
					continue
				}
				absPath, _ := filepath.Abs(event.Name)
				jobID, ok := pathToJob[absPath]
				if !ok {
					continue
				}

				// Debounce: wait 500ms after last write before running.
				if t, exists := timers[jobID]; exists {
					t.Stop()
				}
				jid := jobID // capture for closure
				timers[jobID] = time.AfterFunc(500*time.Millisecond, func() {
					log.Printf("etl watcher: file changed %q, running job %s", absPath, jid)
					if _, err := a.RunETLJob(jid); err != nil {
						log.Printf("etl watcher: run failed for job %s: %v", jid, err)
					}
				})

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("etl watcher: error: %v", err)
			}
		}
	}()

	log.Printf("etl watcher: watching %d file(s)", len(pathToJob))
}

// stopETLWatchers tears down the current file watcher and cron scheduler.
func (a *App) stopETLWatchers() {
	if a.etlWatchCancel != nil {
		a.etlWatchCancel()
		a.etlWatchCancel = nil
	}
	if a.etlWatcher != nil {
		a.etlWatcher.Close()
		a.etlWatcher = nil
	}
	if a.etlCron != nil {
		a.etlCron.Stop()
		a.etlCron = nil
	}
}
