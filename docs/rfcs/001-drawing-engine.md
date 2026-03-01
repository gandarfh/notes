# RFC 001 — Shared Drawing Engine (TinyGo + WASM)

**Status**: Approved  
**Date**: 2026-03-01  
**Author**: João + Antigravity  

## Summary

Extract drawing logic (routing, geometry, hit testing, shape definitions) into a standalone Go package (`pkg/drawing`) that is consumed **natively** by the Go backend and compiled to **WASM** via TinyGo for the frontend. This eliminates code duplication between `internal/mcp/ortho_route.go` (784 lines) and `frontend/src/drawing/ortho.ts` (372 lines) and creates an extensible foundation for custom shape libraries.

## Motivation

1. **Duplicated logic**: Backend and frontend have separate implementations of the same routing algorithm that drift apart. Fixes applied to one side don't propagate.
2. **Extensibility**: Adding custom shapes (database, VM, terminal, user icons) requires changes in both Go and TS with no shared contract.
3. **Quality**: Iterating on routing heuristics is slow because every change must be validated in two codebases.

## Architecture

```
                    pkg/drawing/ (Go puro)
                         │
              ┌──────────┴──────────┐
              │                     │
         Go backend             TinyGo → WASM
       (import nativo)         (compilado para browser)
              │                     │
     MCP tools/services      Frontend canvas
```

### Key principle
- Go backend **imports** `pkg/drawing` as a regular Go package — zero overhead
- Frontend **loads** `drawing.wasm` (compiled by TinyGo) — near-native performance, ~150-300KB

## Interface Design

Inspired by research on tldraw (Geometry2d + ShapeUtil), draw.io (stencils), and Excalidraw.

### Layer 1 — Geometry (pure math)

```go
type Vec2 struct{ X, Y float64 }
type Rect struct{ X, Y, W, H float64 }

type Geometry2d interface {
    Bounds() Rect
    Center() Vec2
    Vertices() []Vec2
    Perimeter() float64
    PointOnPerimeter(t float64) Vec2
    HitTestPoint(p Vec2) bool
    HitTestSegment(a, b Vec2) bool
    NearestPoint(p Vec2) Vec2
    DistanceToPoint(p Vec2) float64
    SVGPath() string
}
```

Built-in implementations: `RectGeometry`, `EllipseGeometry`, `DiamondGeometry`, `PolygonGeometry`, `GroupGeometry`.

### Layer 2 — Shape Definition (behavior)

```go
type ShapeDef interface {
    Type() string
    DefaultSize() (w, h float64)
    Geometry(w, h float64) Geometry2d
    Anchors(w, h float64) []AnchorPoint
    NearestAnchor(w, h, px, py float64) AnchorPoint
    ResizeMode() ResizeMode
    MinSize() (w, h float64)
    OutlinePath(w, h float64) []PathCmd
    IconPath(w, h float64) []PathCmd
    IsFilled() bool
}
```

### Layer 3 — Path Commands (declarative rendering)

```go
type PathCmd struct {
    Op   PathOp    // MoveTo, LineTo, CurveTo, QuadTo, Arc, Close
    Args []float64
}
```

New shapes are defined as **data** (path commands), not code. Frontend renders PathCmds directly to Canvas2D.

### Layer 4 — Routing

```go
type RouteOpts struct {
    StartSide, EndSide string
    StartRect, EndRect *Rect
    Obstacles          []Rect
    ArrowRects         []Rect
}

func ComputeOrthoRoute(dx, dy float64, opts RouteOpts) []Vec2
```

### Layer 5 — Shape Registry

```go
var Registry = &ShapeRegistry{}

func init() {
    Registry.Register(&RectangleShape{})
    Registry.Register(&EllipseShape{})
    Registry.Register(&DiamondShape{})
    Registry.Register(&DatabaseShape{})
    Registry.Register(&VMShape{})
    Registry.Register(&TerminalShape{})
    Registry.Register(&UserShape{})
    Registry.Register(&CloudShape{})
}
```

## WASM Interface (JS ↔ Go)

The WASM module exports functions callable from JS:

```go
//export computeOrthoRoute
func computeOrthoRoute(inputJSON *byte, inputLen int32) (resultPtr *byte, resultLen int32)

//export getShapeGeometry
func getShapeGeometry(shapeType *byte, w, h float64) (resultPtr *byte, resultLen int32)

//export hitTestPoint
func hitTestPoint(shapeType *byte, w, h, px, py float64) bool

//export nearestAnchor
func nearestAnchor(shapeType *byte, w, h, px, py float64) (resultPtr *byte, resultLen int32)
```

Frontend wrapper (`drawing.ts`):
```typescript
import { loadDrawingWASM } from './drawing-wasm'

const engine = await loadDrawingWASM()

// Routing
const points = engine.computeOrthoRoute(dx, dy, opts)

// Hit testing
const hit = engine.hitTestPoint('database', w, h, px, py)

// Anchors
const anchor = engine.nearestAnchor('ellipse', w, h, mouseX, mouseY)
```

## Implementation Plan

### Phase 1 — Foundation (this session)
1. Create `pkg/drawing/` with core types (`Vec2`, `Rect`, `PathCmd`)
2. Define `Geometry2d` interface + `RectGeometry` implementation
3. Move routing from `internal/mcp/ortho_route.go` → `pkg/drawing/route.go`
4. Wire backend MCP tools to use `pkg/drawing`
5. Verify all existing functionality works

### Phase 2 — WASM Bridge
1. Set up TinyGo WASM build
2. Create WASM exports (`main_wasm.go`)
3. Create JS wrapper (`drawing-wasm.ts`)
4. Replace `frontend/src/drawing/ortho.ts` with WASM calls
5. Delete duplicated frontend routing code

### Phase 3 — Geometry Primitives
1. Implement `EllipseGeometry`, `DiamondGeometry`, `PolygonGeometry`
2. Implement `ShapeDef` for built-in shapes
3. Implement `ShapeRegistry`
4. Wire frontend rendering to use `ShapeDef.OutlinePath()`

### Phase 4 — Custom Shapes
1. Implement `DatabaseShape` (cylinder)
2. Implement `VMShape`, `TerminalShape`, `UserShape`, `CloudShape`
3. Frontend renders custom shapes from PathCmds
4. MCP tools use shapes from registry

## TinyGo Considerations

- **Supported**: structs, interfaces, maps, slices, math, sort — all needed ✅
- **Limitations**: limited reflection, no `encoding/json` (use manual serialization or `tinygo-json`)
- **Binary size**: ~150-300KB for this use case
- **Build**: `tinygo build -o drawing.wasm -target wasm ./pkg/drawing/cmd/wasm/`

## Migration Strategy

- **No big bang**: Backend continues using Go package natively. Frontend migrates incrementally.
- **Feature flag**: Frontend can fallback to old `ortho.ts` while WASM stabilizes.
- **Testing**: `go test ./pkg/drawing/...` covers both backend and WASM behavior.

## References

- tldraw Geometry2d: https://tldraw.dev/docs/shapes#geometry
- draw.io stencils: https://drawio.com/doc/faq/custom-shapes
- TinyGo WASM: https://tinygo.org/docs/guides/webassembly/
- gopher-lua (alternative): https://github.com/yuin/gopher-lua
