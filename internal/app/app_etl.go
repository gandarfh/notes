package app

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"notes/internal/etl"
	_ "notes/internal/etl/sources" // register all sources via init()

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

	return a.etlStore.UpdateJob(job)
}

// ── Delete ─────────────────────────────────────────────────

func (a *App) DeleteETLJob(id string) error {
	return a.etlStore.DeleteJob(id)
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
		result = append(result, DatabaseBlockInfo{
			BlockID:      b.ID,
			ConnectionID: cfg.ConnectionID,
			Query:        cfg.Query,
		})
	}
	return result, nil
}
