package app

import (
	"notes/internal/domain"
	"notes/internal/storage"
)

// ============================================================
// Undo Tree
// ============================================================

func (a *App) LoadUndoTree(pageID string) (*storage.UndoTree, error) {
	return a.undos.LoadTree(pageID)
}

func (a *App) PushUndoNode(pageID, nodeID, parentID, label, snapshotJSON string) (*storage.UndoNode, error) {
	return a.undos.PushNode(pageID, nodeID, parentID, label, snapshotJSON)
}

func (a *App) GoToUndoNode(pageID, nodeID string) error {
	return a.undos.GoTo(pageID, nodeID)
}

// RestorePageBlocks fully replaces all blocks for a page (used by undo/redo).
func (a *App) RestorePageBlocks(pageID string, blocks []domain.Block) error {
	return a.blocks.ReplacePageBlocks(pageID, blocks)
}
