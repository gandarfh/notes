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

// MCPToolDef describes a tool that a plugin exposes to the MCP server.
type MCPToolDef struct {
	Name        string                                   // e.g. "mywidget_refresh"
	Description string                                   // shown to agents
	InputSchema map[string]any                           // JSON Schema for parameters
	Destructive bool                                     // requires human approval
	Handler     func(params map[string]any) (any, error) // executes the tool
}

// MCPCapablePlugin extends GoBlockPlugin with MCP tool declarations.
// Plugins that implement this interface will have their tools auto-registered
// with the MCP server on startup.
type MCPCapablePlugin interface {
	GoBlockPlugin
	MCPTools() []MCPToolDef
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

// ForEach iterates all registered plugins. Used by the MCP server to
// auto-register tools for each plugin type.
func (r *GoPluginRegistry) ForEach(fn func(GoBlockPlugin)) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range r.plugins {
		fn(p)
	}
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
