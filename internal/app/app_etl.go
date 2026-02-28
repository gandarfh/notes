package app

// ─────────────────────────────────────────────────────────────
// ETL Handlers — thin delegates to ETLService
// ─────────────────────────────────────────────────────────────

import (
	"encoding/json"
	"notes/internal/domain"
	"notes/internal/etl"
	"notes/internal/service"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) ListETLSources() []etl.SourceSpec {
	return a.etl.ListSources()
}

func (a *App) CreateETLJob(input service.CreateETLJobInput) (*etl.SyncJob, error) {
	return a.etl.CreateJob(a.ctx, input)
}

func (a *App) GetETLJob(id string) (*etl.SyncJob, error) {
	return a.etl.GetJob(id)
}

func (a *App) ListETLJobs() ([]etl.SyncJob, error) {
	return a.etl.ListJobs()
}

func (a *App) UpdateETLJob(id string, input service.CreateETLJobInput) error {
	return a.etl.UpdateJob(a.ctx, id, input)
}

func (a *App) DeleteETLJob(id string) error {
	return a.etl.DeleteJob(a.ctx, id)
}

func (a *App) RunETLJob(id string) (*etl.SyncResult, error) {
	return a.etl.RunJob(a.ctx, id)
}

func (a *App) PreviewETLSource(sourceType, sourceConfigJSON string) (*service.PreviewResult, error) {
	return a.etl.PreviewSource(a.ctx, sourceType, sourceConfigJSON)
}

func (a *App) ListETLRunLogs(jobID string) ([]etl.SyncRunLog, error) {
	return a.etl.ListRunLogs(jobID)
}

func (a *App) DiscoverETLSchema(sourceType, sourceConfigJSON string) (*etl.Schema, error) {
	return a.etl.DiscoverSchema(a.ctx, sourceType, sourceConfigJSON)
}

func (a *App) PickETLFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select ETL source file",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "CSV / JSON", Pattern: "*.csv;*.json"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	return path, nil
}

// ListPageDatabaseBlocks and ListPageHTTPBlocks support the ETL UI
// for selecting target / source blocks on a page.
func (a *App) ListPageDatabaseBlocks(pageID string) ([]PageBlockRef, error) {
	return a.listPageBlocksByType(pageID, "database")
}

func (a *App) ListPageHTTPBlocks(pageID string) ([]PageBlockRef, error) {
	return a.listPageBlocksByType(pageID, "http")
}

// PageBlockRef is a minimal reference returned for page-block selectors.
type PageBlockRef struct {
	BlockID string `json:"blockId"`
	Label   string `json:"label"`
	// HTTP-specific fields (populated when blockType == "http")
	Method string `json:"method,omitempty"`
	URL    string `json:"url,omitempty"`
	// Database-specific fields (populated when blockType == "database")
	ConnectionID string `json:"connectionId,omitempty"`
	Query        string `json:"query,omitempty"`
}

func (a *App) listPageBlocksByType(pageID, blockType string) ([]PageBlockRef, error) {
	blocks, err := a.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}
	var refs []PageBlockRef
	for _, b := range blocks {
		if b.Type == domain.BlockType(blockType) {
			ref := PageBlockRef{BlockID: b.ID, Label: b.ID}

			// Parse content JSON to extract useful info for the label
			switch blockType {
			case "http":
				ref.parseHTTPContent(b.Content)
			case "database":
				ref.parseDatabaseContent(b.Content)
			}

			refs = append(refs, ref)
		}
	}
	return refs, nil
}

func (ref *PageBlockRef) parseHTTPContent(content string) {
	if content == "" {
		return
	}
	var cfg struct {
		Method string `json:"method"`
		URL    string `json:"url"`
	}
	if err := json.Unmarshal([]byte(content), &cfg); err != nil {
		return
	}
	ref.Method = cfg.Method
	ref.URL = cfg.URL
	if cfg.Method != "" && cfg.URL != "" {
		ref.Label = cfg.Method + " " + cfg.URL
	} else if cfg.URL != "" {
		ref.Label = cfg.URL
	}
}

func (ref *PageBlockRef) parseDatabaseContent(content string) {
	if content == "" {
		return
	}
	var cfg struct {
		ConnectionID string `json:"connectionId"`
		Query        string `json:"query"`
	}
	if err := json.Unmarshal([]byte(content), &cfg); err != nil {
		return
	}
	ref.ConnectionID = cfg.ConnectionID
	ref.Query = cfg.Query
	if cfg.Query != "" {
		label := cfg.Query
		if len(label) > 60 {
			label = label[:60] + "…"
		}
		ref.Label = label
	}
}
