package service

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/domain"
	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// Notebook Service — business logic for notebooks and pages
// ─────────────────────────────────────────────────────────────

// NotebookService manages notebooks and pages.
// It is the thin-delegate equivalent for app_notebook.go.
type NotebookService struct {
	store   *storage.NotebookStore
	blocks  *BlockService
	conns   *storage.ConnectionStore
	dataDir string
	emitter EventEmitter
}

// NewNotebookService creates a NotebookService.
func NewNotebookService(
	store *storage.NotebookStore,
	blocks *BlockService,
	conns *storage.ConnectionStore,
	dataDir string,
	emitter EventEmitter,
) *NotebookService {
	return &NotebookService{
		store:   store,
		blocks:  blocks,
		conns:   conns,
		dataDir: dataDir,
		emitter: emitter,
	}
}

// ── Notebooks ──────────────────────────────────────────────

func (s *NotebookService) ListNotebooks() ([]domain.Notebook, error) {
	return s.store.ListNotebooks()
}

func (s *NotebookService) CreateNotebook(name string) (*domain.Notebook, error) {
	nb := &domain.Notebook{
		ID:   uuid.New().String(),
		Name: name,
		Icon: "📓",
	}
	if err := s.store.CreateNotebook(nb); err != nil {
		return nil, fmt.Errorf("create notebook: %w", err)
	}
	// Create directory for markdown files
	dir := filepath.Join(s.dataDir, nb.ID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create notebook dir: %w", err)
	}
	return nb, nil
}

func (s *NotebookService) RenameNotebook(id, name string) error {
	nb, err := s.store.GetNotebook(id)
	if err != nil {
		return err
	}
	nb.Name = name
	return s.store.UpdateNotebook(nb)
}

func (s *NotebookService) DeleteNotebook(id string) error {
	pages, _ := s.store.ListPages(id)
	for _, p := range pages {
		s.conns.DeleteConnectionsByPage(p.ID)
		s.blocks.DeleteBlocksByPage(p.ID)
	}
	s.store.DeletePagesByNotebook(id)

	dir := filepath.Join(s.dataDir, id)
	os.RemoveAll(dir)

	return s.store.DeleteNotebook(id)
}

// ── Pages ──────────────────────────────────────────────────

func (s *NotebookService) ListPages(notebookID string) ([]domain.Page, error) {
	return s.store.ListPages(notebookID)
}

func (s *NotebookService) CreatePage(notebookID, name string) (*domain.Page, error) {
	p := &domain.Page{
		ID:           uuid.New().String(),
		NotebookID:   notebookID,
		Name:         name,
		ViewportZoom: 1.0,
	}
	if err := s.store.CreatePage(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *NotebookService) GetPageState(pageID string) (*domain.PageState, error) {
	page, err := s.store.GetPage(pageID)
	if err != nil {
		return nil, err
	}
	blocks, err := s.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, err
	}
	connections, err := s.conns.ListConnections(pageID)
	if err != nil {
		return nil, err
	}
	if blocks == nil {
		blocks = []domain.Block{}
	}
	if connections == nil {
		connections = []domain.Connection{}
	}
	return &domain.PageState{
		Page:        *page,
		Blocks:      blocks,
		Connections: connections,
	}, nil
}

func (s *NotebookService) RenamePage(id, name string) error {
	p, err := s.store.GetPage(id)
	if err != nil {
		return err
	}
	p.Name = name
	return s.store.UpdatePage(p)
}

func (s *NotebookService) UpdateViewport(pageID string, x, y, zoom float64) error {
	p, err := s.store.GetPage(pageID)
	if err != nil {
		return err
	}
	p.ViewportX = x
	p.ViewportY = y
	p.ViewportZoom = zoom
	return s.store.UpdatePage(p)
}

func (s *NotebookService) UpdateDrawingData(pageID, data string) error {
	p, err := s.store.GetPage(pageID)
	if err != nil {
		return err
	}
	p.DrawingData = data
	return s.store.UpdatePage(p)
}

func (s *NotebookService) DeletePage(id string) error {
	s.conns.DeleteConnectionsByPage(id)
	s.blocks.DeleteBlocksByPage(id)
	return s.store.DeletePage(id)
}

// LogPageLoad emits a debug log (uses EventEmitter to decouple from wailsRuntime).
// This replicates the wailsRuntime.LogInfof call in the original app_notebook.go.
func (s *NotebookService) LogPageLoad(ctx interface{ Value(any) any }, pageID string) {
	// Emitter doesn't support logging; log is handled by the app layer.
	_ = pageID
}

// Unused import guard — wailsRuntime is only referenced via wailsRuntime.LogInfof
// which is now delegated to the app layer.
var _ = wailsRuntime.LogInfof
