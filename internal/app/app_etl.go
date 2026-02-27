package app

// ─────────────────────────────────────────────────────────────
// ETL Handlers — thin delegates to ETLService
// ─────────────────────────────────────────────────────────────

import (
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
	ID      string `json:"id"`
	Content string `json:"content"`
}

func (a *App) listPageBlocksByType(pageID, blockType string) ([]PageBlockRef, error) {
	blocks, err := a.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}
	var refs []PageBlockRef
	for _, b := range blocks {
		if b.Type == domain.BlockType(blockType) {
			refs = append(refs, PageBlockRef{ID: b.ID, Content: b.Content})
		}
	}
	return refs, nil
}
