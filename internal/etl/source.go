package etl

import (
	"context"
	"fmt"
	"sync"
)

// ── Source ──────────────────────────────────────────────────
// A Source extracts data from an external system.
// Implementations live in etl/sources/ — one file per source type.
//
// Pattern: Airbyte connector protocol (spec → discover → read).

// SourceConfig is an opaque configuration map parsed per source type.
type SourceConfig map[string]any

// ConfigField describes a single configuration input for a source.
// The frontend auto-renders the form from this spec.
type ConfigField struct {
	Key      string   `json:"key"`
	Label    string   `json:"label"`
	Type     string   `json:"type"` // "string" | "select" | "textarea" | "password" | "file"
	Required bool     `json:"required"`
	Options  []string `json:"options,omitempty"` // for "select" type
	Default  string   `json:"default,omitempty"`
	Help     string   `json:"help,omitempty"`
}

// SourceSpec describes a source type: its label, icon, and required config fields.
type SourceSpec struct {
	Type         string        `json:"type"`
	Label        string        `json:"label"`
	Icon         string        `json:"icon"` // Tabler icon name
	ConfigFields []ConfigField `json:"configFields"`
}

// Source is the interface every data source must implement.
type Source interface {
	// Spec returns metadata about this source type.
	Spec() SourceSpec

	// Discover introspects the source and returns the expected schema.
	Discover(ctx context.Context, cfg SourceConfig) (*Schema, error)

	// Read streams records from the source into a channel.
	// The channel is closed when all records have been read or ctx is cancelled.
	// Errors are sent on the error channel (buffered size 1).
	Read(ctx context.Context, cfg SourceConfig) (<-chan Record, <-chan error)
}

// ── Source Registry ────────────────────────────────────────
// Compile-time registration via init() in each source file.

var (
	registryMu sync.RWMutex
	registry   = map[string]Source{}
)

// RegisterSource registers a source by its spec type.
// Called from init() in each source implementation file.
func RegisterSource(s Source) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[s.Spec().Type] = s
}

// GetSource returns a registered source by type, or an error if not found.
func GetSource(typ string) (Source, error) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	s, ok := registry[typ]
	if !ok {
		return nil, fmt.Errorf("unknown source type: %q", typ)
	}
	return s, nil
}

// ListSources returns the specs of all registered sources.
func ListSources() []SourceSpec {
	registryMu.RLock()
	defer registryMu.RUnlock()
	specs := make([]SourceSpec, 0, len(registry))
	for _, s := range registry {
		specs = append(specs, s.Spec())
	}
	return specs
}
