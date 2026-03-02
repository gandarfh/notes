// Package drawing provides shared geometry, shape definitions, and
// orthogonal routing for the Notes drawing engine.
// It is consumed natively by the Go backend and compiled to WASM
// via TinyGo for the frontend.
package drawing

import "math"

// ── Core types ─────────────────────────────────────────────

// Vec2 is a 2D point/vector.
type Vec2 struct{ X, Y float64 }

// Rect is an axis-aligned bounding box.
type Rect struct{ X, Y, W, H float64 }

// Intersects returns true if two rects overlap.
func (a Rect) Intersects(b Rect) bool {
	return a.X < b.X+b.W && a.X+a.W > b.X &&
		a.Y < b.Y+b.H && a.Y+a.H > b.Y
}

// Contains returns true if point p is inside r (with optional margin).
func (r Rect) Contains(p Vec2, margin float64) bool {
	return p.X >= r.X-margin && p.X <= r.X+r.W+margin &&
		p.Y >= r.Y-margin && p.Y <= r.Y+r.H+margin
}

// Center returns the center of the rect.
func (r Rect) Center() Vec2 {
	return Vec2{r.X + r.W/2, r.Y + r.H/2}
}

// ── Distance helpers ───────────────────────────────────────

// Manhattan returns the Manhattan distance between two points.
func Manhattan(a, b Vec2) float64 {
	return math.Abs(a.X-b.X) + math.Abs(a.Y-b.Y)
}

// Dist returns the Euclidean distance between two points.
func Dist(a, b Vec2) float64 {
	return math.Hypot(a.X-b.X, a.Y-b.Y)
}

// ── Anchor types ───────────────────────────────────────────

// AnchorSide identifies which side of an element an anchor is on.
type AnchorSide string

const (
	SideTop    AnchorSide = "top"
	SideBottom AnchorSide = "bottom"
	SideLeft   AnchorSide = "left"
	SideRight  AnchorSide = "right"
)

// AnchorPoint is a connection point on a shape's perimeter.
type AnchorPoint struct {
	Side AnchorSide
	T    float64 // parametric position on the side (0–1)
	X, Y float64 // absolute position (computed)
}

// ── Path commands ──────────────────────────────────────────

// PathOp identifies a drawing operation.
type PathOp int

const (
	OpMoveTo  PathOp = iota // M x y
	OpLineTo                // L x y
	OpCurveTo               // C cx1 cy1 cx2 cy2 x y
	OpQuadTo                // Q cx cy x y
	OpArc                   // A rx ry rotation largeArc sweep x y
	OpClose                 // Z
)

// PathCmd is a single drawing command (SVG-like).
type PathCmd struct {
	Op   PathOp
	Args []float64
}

// ── Resize modes ───────────────────────────────────────────

// ResizeMode controls how a shape responds to resize operations.
type ResizeMode int

const (
	ResizeFree   ResizeMode = iota // Free resize (rectangle)
	ResizeAspect                   // Maintain aspect ratio (database icon, image)
	ResizeFixed                    // Fixed size (emoji, small icons)
)
