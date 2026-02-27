package app

// ─────────────────────────────────────────────────────────────
// Block Handlers — thin delegates to BlockService
// ─────────────────────────────────────────────────────────────
//
// This file ONLY contains Wails-bound methods that are NOT already
// declared in the pre-existing app/*.go files (app_terminal.go handles
// OpenBlockInEditor/CloseEditor; app_undo.go handles RestorePageBlocks).

import (
	"notes/internal/domain"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) CreateBlock(pageID, blockType string, x, y, width, height float64) (*domain.Block, error) {
	b, err := a.blocks.CreateBlock(pageID, blockType, x, y, width, height)
	if err != nil {
		return nil, err
	}
	// Dispatch plugin lifecycle event (e.g. creates LocalDatabase for "localdb" blocks)
	if pluginErr := a.pluginRegistry.OnCreate(b.ID, pageID, blockType); pluginErr != nil {
		wailsRuntime.LogWarningf(a.ctx, "plugin OnCreate for %s: %v", blockType, pluginErr)
	}
	return b, nil
}

func (a *App) UpdateBlockPosition(id string, x, y, width, height float64) error {
	return a.blocks.UpdateBlockPosition(id, x, y, width, height)
}

func (a *App) UpdateBlockContent(id, content string) error {
	return a.blocks.UpdateBlockContent(id, content)
}

func (a *App) DeleteBlock(id string) error {
	b, err := a.blocks.GetBlock(id)
	if err != nil {
		return err
	}
	// Dispatch plugin lifecycle event before deletion
	if err := a.pluginRegistry.OnDelete(id, string(b.Type)); err != nil {
		wailsRuntime.LogWarningf(a.ctx, "plugin OnDelete for %s: %v", b.Type, err)
	}
	return a.blocks.DeleteBlock(a.ctx, id)
}

func (a *App) SaveImageFile(blockID, dataURL string) (string, error) {
	return a.blocks.SaveImageFile(blockID, dataURL)
}

func (a *App) GetImageData(blockID string) (string, error) {
	return a.blocks.GetImageData(blockID)
}

func (a *App) UpdateBlockFilePath(blockID, filePath string) (string, error) {
	return a.blocks.UpdateBlockFilePath(blockID, filePath)
}

func (a *App) ChangeBlockFileExt(blockID, newExt string) (string, error) {
	return a.blocks.ChangeBlockFileExt(blockID, newExt)
}

// PickTextFile opens a native file picker and returns the selected path.
func (a *App) PickTextFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select file",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Text / Code", Pattern: "*.txt;*.md;*.go;*.py;*.js;*.ts;*.json;*.yaml;*.toml"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	return path, nil
}
