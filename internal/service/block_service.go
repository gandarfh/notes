package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"notes/internal/domain"
	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// Block Service — business logic for canvas blocks
// ─────────────────────────────────────────────────────────────

// BlockService manages the lifecycle of canvas blocks.
type BlockService struct {
	store   *storage.BlockStore
	dataDir string
	emitter EventEmitter
}

// NewBlockService creates a BlockService.
func NewBlockService(store *storage.BlockStore, dataDir string, emitter EventEmitter) *BlockService {
	return &BlockService{store: store, dataDir: dataDir, emitter: emitter}
}

// CreateBlock creates a new block on a page.
func (s *BlockService) CreateBlock(pageID, blockType string, x, y, width, height float64) (*domain.Block, error) {
	b := &domain.Block{
		PageID:  pageID,
		Type:    domain.BlockType(blockType),
		X:       x,
		Y:       y,
		Width:   width,
		Height:  height,
		Content: "{}",
	}
	if err := s.store.CreateBlock(b); err != nil {
		return nil, fmt.Errorf("create block: %w", err)
	}
	return b, nil
}

// GetBlock returns a block by ID.
func (s *BlockService) GetBlock(id string) (*domain.Block, error) {
	return s.store.GetBlock(id)
}

// ListBlocks returns all blocks for a page.
func (s *BlockService) ListBlocks(pageID string) ([]domain.Block, error) {
	return s.store.ListBlocks(pageID)
}

// UpdateBlockPosition updates the position and size of a block.
func (s *BlockService) UpdateBlockPosition(id string, x, y, width, height float64) error {
	b, err := s.store.GetBlock(id)
	if err != nil {
		return err
	}
	b.X, b.Y, b.Width, b.Height = x, y, width, height
	return s.store.UpdateBlock(b)
}

// UpdateBlockContent updates the content of a block.
func (s *BlockService) UpdateBlockContent(id, content string) error {
	b, err := s.store.GetBlock(id)
	if err != nil {
		return err
	}
	b.Content = content
	return s.store.UpdateBlock(b)
}

// UpdateBlock updates an existing block directly (used by app_terminal.go and app_http.go).
func (s *BlockService) UpdateBlock(b *domain.Block) error {
	return s.store.UpdateBlock(b)
}

// DeleteBlock removes a block and any associated files.
func (s *BlockService) DeleteBlock(_ context.Context, id string) error {
	b, err := s.store.GetBlock(id)
	if err != nil {
		return err
	}
	if b.FilePath != "" {
		_ = os.Remove(b.FilePath)
	}
	return s.store.DeleteBlock(id)
}

// DeleteBlocksByPage removes all blocks for a page and their associated files.
// Accepts pageID only — compatible with existing callers.
func (s *BlockService) DeleteBlocksByPage(pageID string) error {
	blocks, _ := s.store.ListBlocks(pageID)
	for _, b := range blocks {
		if b.FilePath != "" {
			_ = os.Remove(b.FilePath)
		}
	}
	return s.store.DeleteBlocksByPage(pageID)
}

// SaveImageFile saves base64-encoded image data to disk and updates the block's FilePath.
func (s *BlockService) SaveImageFile(blockID, dataURL string) (string, error) {
	b, err := s.store.GetBlock(blockID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(s.dataDir, b.PageID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("mkdir for image: %w", err)
	}
	filePath := filepath.Join(dir, blockID+".png")
	data, err := decodeBase64Image(dataURL)
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return "", fmt.Errorf("write image: %w", err)
	}
	b.FilePath = filePath
	if err := s.store.UpdateBlock(b); err != nil {
		return "", err
	}
	return filePath, nil
}

// GetImageData returns base64-encoded PNG data for an image block.
func (s *BlockService) GetImageData(blockID string) (string, error) {
	b, err := s.store.GetBlock(blockID)
	if err != nil {
		return "", err
	}
	if b.FilePath == "" {
		return "", nil
	}
	return readBase64File(b.FilePath)
}

// UpdateBlockFilePath links a local file to a block and reads its content.
func (s *BlockService) UpdateBlockFilePath(blockID, filePath string) (string, error) {
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}
	if _, err := os.Stat(absPath); err != nil {
		return "", fmt.Errorf("file not found: %w", err)
	}
	b, err := s.store.GetBlock(blockID)
	if err != nil {
		return "", err
	}
	b.FilePath = absPath
	content, _ := os.ReadFile(absPath)
	b.Content = string(content)
	if err := s.store.UpdateBlock(b); err != nil {
		return "", err
	}
	return absPath, nil
}

// ChangeBlockFileExt renames the extension of a block's linked file.
func (s *BlockService) ChangeBlockFileExt(blockID, newExt string) (string, error) {
	b, err := s.store.GetBlock(blockID)
	if err != nil {
		return "", err
	}
	if b.FilePath == "" {
		return "", fmt.Errorf("block %s has no linked file", blockID)
	}
	dir := filepath.Dir(b.FilePath)
	base := filepath.Base(b.FilePath)
	oldExt := filepath.Ext(base)
	newName := strings.TrimSuffix(base, oldExt) + newExt
	newPath := filepath.Join(dir, newName)
	if err := os.Rename(b.FilePath, newPath); err != nil {
		return "", fmt.Errorf("rename file: %w", err)
	}
	b.FilePath = newPath
	if err := s.store.UpdateBlock(b); err != nil {
		return "", err
	}
	return newPath, nil
}

// RestorePageBlocks atomically replaces all blocks on a page with the given list.
func (s *BlockService) RestorePageBlocks(_ context.Context, pageID string, blocks []domain.Block) error {
	if err := s.store.DeleteBlocksByPage(pageID); err != nil {
		return fmt.Errorf("restore: clear page: %w", err)
	}
	for i := range blocks {
		if err := s.store.CreateBlock(&blocks[i]); err != nil {
			return fmt.Errorf("restore: insert block %s: %w", blocks[i].ID, err)
		}
	}
	return nil
}

// ReplacePageBlocks is an alias for RestorePageBlocks (used by app_undo.go).
func (s *BlockService) ReplacePageBlocks(pageID string, blocks []domain.Block) error {
	return s.RestorePageBlocks(context.Background(), pageID, blocks)
}

// ── helpers ────────────────────────────────────────────────

func decodeBase64Image(dataURL string) ([]byte, error) {
	const prefix = "data:image/png;base64,"
	encoded := dataURL
	if strings.HasPrefix(dataURL, prefix) {
		encoded = dataURL[len(prefix):]
	}
	return base64.StdEncoding.DecodeString(encoded)
}

func readBase64File(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}
