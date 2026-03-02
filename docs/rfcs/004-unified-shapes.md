# RFC 004 — Unified Shape Definition

**Status**: Implemented  
**Date**: 2026-03-01  
**Author**: João + Antigravity  

## Summary

Move sketch rendering (`SketchOutline`, `SketchFill`) into the `ShapeDef` interface so each shape is fully self-contained in a single file. Currently, adding a new shape requires touching 4 files. After this change, it requires 1.

## Motivation

1. **Scattered definition**: A new shape requires changes in `shapes_custom.go` (struct), `shapes_builtin.go` (register), `sketch.go` (switch cases), and optionally a new `*_geometry.go` file.
2. **Open/Closed violation**: `sketch.go` has switch statements on shape type. Adding a shape means modifying existing code instead of extending.
3. **Inconsistency**: Built-in shapes (rect, ellipse, diamond) use specialized sketch functions, while custom shapes fall through to a generic `sketchFromPathCmds`. The dispatch is implicit and hard to follow.

## Architecture

```
Current (scattered):

  shapes_custom.go   → struct + ShapeDef methods
  shapes_builtin.go  → init() Register calls
  sketch.go          → switch(shapeType) { case "rect": ... case "ellipse": ... }
  *_geometry.go      → Geometry2d implementation

Proposed (self-contained):

  shapes/rectangle.go  → everything for rectangle (struct, register, geometry, sketch)
  shapes/ellipse.go    → everything for ellipse
  shapes/database.go   → everything for database
  sketch.go            → only generic helpers (sketchEdge, hachureFill)
```

### Extended ShapeDef interface

```go
type ShapeDef interface {
    // ... existing methods (Type, Label, Geometry, Anchors, OutlinePath, etc.) ...

    // Sketch rendering — each shape knows how to draw itself sketchy
    SketchOutline(w, h float64, seed int, sw float64) []StrokePath
    SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath
}
```

### Self-contained shape file

```go
// shapes/hexagon.go — one file, everything
package drawing

type hexagonShape struct{}

func init() { DefaultRegistry.Register(&hexagonShape{}) }

func (s *hexagonShape) Type() string           { return "hexagon" }
func (s *hexagonShape) Label() string          { return "Hexagon" }
func (s *hexagonShape) Category() string       { return "basic" }
func (s *hexagonShape) DefaultSize() (float64, float64) { return 120, 100 }
func (s *hexagonShape) Geometry(w, h float64) Geometry2d { ... }
func (s *hexagonShape) OutlinePath(w, h float64) []PathCmd { ... }
func (s *hexagonShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
    return sketchFromPathCmds(s.OutlinePath(w, h), sw, float64(seed))
}
func (s *hexagonShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
    return standardFill(s.OutlinePath(w, h), w, h, seed, fillColor, fillStyle)
}
```

### Simplified sketch.go

```go
// sketch.go — delegates to ShapeDef, no more switches

func SketchOutline(shapeType string, w, h float64, seed int, sw float64) []StrokePath {
    shape := DefaultRegistry.Get(shapeType)
    if shape == nil { return nil }
    return shape.SketchOutline(w, h, seed, sw)
}

// Only generic helpers remain:
func sketchEdge(x1, y1, x2, y2, sw, seed, overshoot float64) []StrokePath
func sketchFromPathCmds(cmds []PathCmd, sw, seed float64) []StrokePath
func standardFill(outline []PathCmd, w, h float64, ...) []StrokePath
```

## Implementation Plan

### Phase 1 — Extend interface
1. Add `SketchOutline()` and `SketchFill()` to `ShapeDef` interface
2. Implement on existing shapes by delegating to current helper functions

### Phase 2 — Migrate built-in shapes
1. Move rect sketch logic into `RectangleShape.SketchOutline()`
2. Move ellipse sketch logic into `EllipseShape.SketchOutline()`
3. Move diamond sketch logic into `DiamondShape.SketchOutline()`

### Phase 3 — Clean up sketch.go
1. Replace switch statements with `shape.SketchOutline()` delegation
2. Remove shape-specific functions from `sketch.go`
3. Keep only generic helpers (`sketchEdge`, `sketchFromPathCmds`, `standardFill`)

### Phase 4 — Consolidate files
1. Move each shape into its own file (optional, can keep current grouping)
2. Merge `shapes_builtin.go` register calls into each shape's `init()`

## Considerations

- **Public API unchanged**: `SketchOutline(shapeType, ...)` and `SketchFill(shapeType, ...)` keep same signatures — they just delegate.
- **Default implementation**: Shapes that don't need custom sketch can use `sketchFromPathCmds(s.OutlinePath(...))` as a one-liner.
- **Backward compatible**: Custom shapes already use the generic path fallback. Adding the methods formalizes what already happens.

## Migration Strategy

- Incremental: add interface methods, implement on one shape at a time, remove switch case.
- Tests: WASM output should be identical before and after (same sketch paths for same inputs).
- No frontend changes needed — StrokePath format is unchanged.

## References

- Current `shape.go`: `pkg/drawing/shape.go` (ShapeDef interface + ShapeRegistry)
- Current `sketch.go`: `pkg/drawing/sketch.go` (462 lines, switch-based dispatch)
- tldraw ShapeUtil pattern: https://tldraw.dev/docs/shapes
