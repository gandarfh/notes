package plugins

import (
	"fmt"

	"notes/internal/service"
	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// LocalDB Block Plugin (Go-side)
// ─────────────────────────────────────────────────────────────

// localDBPlugin implements service.GoBlockPlugin for the "localdb" block type.
// It automatically creates/deletes the LocalDatabase record when a block is
// created or deleted, keeping data in sync without requiring manual wiring in App.
type localDBPlugin struct {
	service *service.LocalDBService
}

// NewLocalDBPlugin creates the LocalDB block plugin.
func NewLocalDBPlugin(svc *service.LocalDBService) service.GoBlockPlugin {
	return &localDBPlugin{service: svc}
}

func (p *localDBPlugin) BlockType() string { return "localdb" }

func (p *localDBPlugin) OnCreate(blockID, _ string) error {
	_, err := p.service.CreateDatabase(blockID, "New Database")
	if err != nil {
		return fmt.Errorf("localdb plugin: OnCreate: %w", err)
	}
	return nil
}

func (p *localDBPlugin) OnDelete(blockID string) error {
	db, err := p.service.GetDatabase(blockID)
	if err != nil {
		// Database may already not exist, treat as success
		return nil
	}
	return p.service.DeleteDatabase(db.ID)
}

// ─────────────────────────────────────────────────────────────
// HTTP Block Plugin (placeholder, no automatic data creation)
// ─────────────────────────────────────────────────────────────

type httpPlugin struct {
	blockStore *storage.BlockStore
}

func NewHTTPPlugin(blockStore *storage.BlockStore) service.GoBlockPlugin {
	return &httpPlugin{blockStore: blockStore}
}

func (p *httpPlugin) BlockType() string { return "http" }
func (p *httpPlugin) OnCreate(blockID, _ string) error {
	// HTTP blocks have no server-side initialization; config is stored in block.content
	return nil
}
func (p *httpPlugin) OnDelete(blockID string) error {
	return nil
}
