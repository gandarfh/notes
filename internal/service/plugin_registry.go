package service

import (
	"fmt"
	"sync"
)

// ─────────────────────────────────────────────────────────────
// Go Plugin Registry — pluggable block backends
// ─────────────────────────────────────────────────────────────

// GoBlockPlugin is the Go-side contract for block type plugins.
// Implement this interface to hook into block Create/Delete lifecycle events.
type GoBlockPlugin interface {
	// BlockType returns the block type string this plugin handles (e.g. "localdb").
	BlockType() string
	// OnCreate is called after a block of this type is created.
	OnCreate(blockID, pageID string) error
	// OnDelete is called before a block of this type is deleted.
	OnDelete(blockID string) error
}

// GoPluginRegistry manages registered Go-side block plugins.
type GoPluginRegistry struct {
	mu      sync.RWMutex
	plugins map[string]GoBlockPlugin
}

// NewGoPluginRegistry creates an empty plugin registry.
func NewGoPluginRegistry() *GoPluginRegistry {
	return &GoPluginRegistry{plugins: make(map[string]GoBlockPlugin)}
}

// Register adds a plugin to the registry. Panics on duplicate registration.
func (r *GoPluginRegistry) Register(p GoBlockPlugin) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := p.BlockType()
	if _, exists := r.plugins[t]; exists {
		panic(fmt.Sprintf("go plugin registry: duplicate registration for block type %q", t))
	}
	r.plugins[t] = p
}

// OnCreate dispatches a create lifecycle event to the relevant plugin (if any).
func (r *GoPluginRegistry) OnCreate(blockID, pageID, blockType string) error {
	r.mu.RLock()
	p, ok := r.plugins[blockType]
	r.mu.RUnlock()
	if !ok {
		return nil // not managed by a plugin
	}
	return p.OnCreate(blockID, pageID)
}

// OnDelete dispatches a delete lifecycle event to the relevant plugin (if any).
func (r *GoPluginRegistry) OnDelete(blockID, blockType string) error {
	r.mu.RLock()
	p, ok := r.plugins[blockType]
	r.mu.RUnlock()
	if !ok {
		return nil
	}
	return p.OnDelete(blockID)
}
