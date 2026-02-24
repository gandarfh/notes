package app

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

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

// onEditorExit is called when the Neovim process exits.
// It reads the final file content and pushes it to the frontend.
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

// terminalDataCallback returns the callback used to forward PTY output to the frontend.
func terminalDataCallback(a *App) func(data []byte) {
	return func(data []byte) {
		encoded := base64.StdEncoding.EncodeToString(data)
		wailsRuntime.EventsEmit(a.ctx, "terminal:data", encoded)
	}
}

// terminalExitCallback returns the callback used when the editor process exits.
func terminalExitCallback(a *App) func(exitLine int) {
	return func(exitLine int) {
		if a.editingBlockID != "" {
			a.onEditorExit(a.editingBlockID)
		}
		wailsRuntime.EventsEmit(a.ctx, "terminal:exit", map[string]int{
			"cursorLine": exitLine,
		})
	}
}
