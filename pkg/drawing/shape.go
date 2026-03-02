package drawing

import "sync"

// ═══════════════════════════════════════════════════════════════
// Layer 2 — Shape Definition (behavior)
// ═══════════════════════════════════════════════════════════════

// ShapeDef describes the behavior and appearance of a shape type.
// It combines geometry (math) with visual definition (paths, anchors, sizing).
type ShapeDef interface {
	// Identity
	Type() string     // e.g. "rectangle", "database", "cloud"
	Label() string    // human name: "Rectangle", "Database", "Cloud"
	Category() string // grouping: "basic", "infrastructure", "people"

	// Sizing
	DefaultSize() (w, h float64)
	MinSize() (w, h float64)
	ResizeMode() ResizeMode

	// Geometry — creates the math model for given dimensions
	Geometry(w, h float64) Geometry2d

	// Anchors — connection points on the shape perimeter
	Anchors(w, h float64) []AnchorPoint
	NearestAnchor(w, h, px, py float64) AnchorPoint

	// Rendering
	OutlinePath(w, h float64) []PathCmd // shape border
	IconPath(w, h float64) []PathCmd    // interior icon (optional, e.g. DB lines)
	IsFilled() bool                     // true = solid fill, false = stroke only
}

// ═══════════════════════════════════════════════════════════════
// Layer 5 — Shape Registry
// ═══════════════════════════════════════════════════════════════

// ShapeRegistry maintains a map of shape type → ShapeDef.
// It's the central extension point for adding new shapes.
type ShapeRegistry struct {
	mu     sync.RWMutex
	shapes map[string]ShapeDef
}

// Register adds a shape definition to the registry.
func (r *ShapeRegistry) Register(s ShapeDef) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.shapes == nil {
		r.shapes = make(map[string]ShapeDef)
	}
	r.shapes[s.Type()] = s
}

// Get returns the shape definition for a given type, or nil if not found.
func (r *ShapeRegistry) Get(shapeType string) ShapeDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.shapes[shapeType]
}

// List returns all registered shape types.
func (r *ShapeRegistry) List() []ShapeDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]ShapeDef, 0, len(r.shapes))
	for _, s := range r.shapes {
		result = append(result, s)
	}
	return result
}

// Types returns all registered type strings.
func (r *ShapeRegistry) Types() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]string, 0, len(r.shapes))
	for t := range r.shapes {
		result = append(result, t)
	}
	return result
}

// DefaultRegistry is the global shape registry, populated at init time.
var DefaultRegistry = &ShapeRegistry{}
