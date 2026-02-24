package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/domain"
)

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

	switch b.Type {
	case domain.BlockTypeMarkdown:
		filePath, err := a.createBlockFile(pageID, blockID, ".md", "# New Note\n\n")
		if err != nil {
			return nil, err
		}
		b.FilePath = filePath
		b.Content = "# New Note\n\n"

	case domain.BlockTypeCode:
		ext := ".txt"
		if b.Content != "" {
			var cfg struct {
				Ext string `json:"ext"`
			}
			if json.Unmarshal([]byte(b.Content), &cfg) == nil && cfg.Ext != "" {
				ext = "." + strings.TrimPrefix(cfg.Ext, ".")
			}
		}
		filePath, err := a.createBlockFile(pageID, blockID, ext, "")
		if err != nil {
			return nil, err
		}
		b.FilePath = filePath
		b.Content = ""
	}

	if err := a.blocks.CreateBlock(b); err != nil {
		return nil, err
	}

	return b, nil
}

// createBlockFile creates a file on disk for a block, returning the absolute path.
// It looks up the page's notebook to determine the directory.
func (a *App) createBlockFile(pageID, blockID, ext, initialContent string) (string, error) {
	page, err := a.notebooks.GetPage(pageID)
	if err != nil {
		return "", err
	}
	filePath := filepath.Join(a.db.DataDir(), page.NotebookID, blockID+ext)
	if err := os.WriteFile(filePath, []byte(initialContent), 0644); err != nil {
		return "", fmt.Errorf("create block file: %w", err)
	}
	return filePath, nil
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

// ============================================================
// Image I/O
// ============================================================

// GetImageData reads an image file and returns it as a base64 data URL.
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
// and updates the block's filePath.
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
