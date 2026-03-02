# RFC 003 — Route Pipeline

**Status**: Draft  
**Date**: 2026-03-01  
**Author**: João + Antigravity  

## Summary

Refactor `ComputeOrthoRoute` from a 190-line monolithic function into a composable pipeline of stages. Each stage operates on a shared `RoutePlan` struct, making individual steps testable, debuggable, and extensible.

## Motivation

1. **Monolithic function**: `ComputeOrthoRoute` does 8 sequential tasks in one 190-line function — obstacle expansion, grid generation, spot filtering, Dijkstra, simplification.
2. **Testability**: Testing spot generation requires running all preceding steps. Isolating a bug in simplification requires reproducing the entire pipeline.
3. **Extensibility**: Adding new routing strategies (curved routing, magnetic snapping) requires modifying the monolith.

## Architecture

```
Current (monolithic):

  func ComputeOrthoRoute(dx, dy, opts) {
    // 190 lines doing everything sequentially
    // antenna → obstacles → rulers → spots → filter → dijkstra → simplify
  }

Proposed (pipeline):

  ComputeOrthoRoute(dx, dy, opts)
    └── RunPipeline(
          StageAntennas,
          StageExpandObstacles,
          StageComputeSpots,
          StageFilterSpots,
          StageDijkstra,
          StageSimplify,
        )
```

### Core types

```go
// RoutePlan holds all intermediate state for a route computation.
type RoutePlan struct {
    Origin, Dest  Vec2
    Opts          RouteOpts
    Antennas      [2]Vec2
    Obstacles     []Rect        // inflated
    OriginalRects []Rect        // non-inflated (for spot filtering)
    Spots         []Vec2        // candidate waypoints
    Path          []Vec2        // raw dijkstra result
    Result        [][]float64   // final simplified output
}

// Stage is a single step in the routing pipeline.
type Stage func(plan *RoutePlan) error

// RunPipeline executes stages in sequence.
func RunPipeline(dx, dy float64, opts RouteOpts, stages ...Stage) [][]float64
```

### Stages

```go
func StageAntennas(plan *RoutePlan) error        // extrude from edge
func StageExpandObstacles(plan *RoutePlan) error  // inflate margins
func StageComputeSpots(plan *RoutePlan) error     // grid intersections + midpoints
func StageFilterSpots(plan *RoutePlan) error      // remove spots inside shapes
func StageDijkstra(plan *RoutePlan) error         // shortest path + bend penalty
func StageSimplify(plan *RoutePlan) error         // dedup + remove collinear
```

## Implementation Plan

### Phase 1 — Define RoutePlan
1. Create `RoutePlan` struct and `Stage` type
2. Implement `RunPipeline` with fallback to `SimpleOrthoRoute`

### Phase 2 — Extract stages
1. Extract each block from `ComputeOrthoRoute` into a named `Stage` function
2. One stage per commit — verify tests pass after each extraction

### Phase 3 — Compose
1. Rewrite `ComputeOrthoRoute` as pipeline composition
2. Delete the old monolithic body
3. Add per-stage unit tests

## Considerations

- **Public API unchanged**: `ComputeOrthoRoute(dx, dy, opts)` signature stays the same. Zero breaking changes.
- **Dijkstra stays internal**: The graph building and priority queue remain in `route.go` — they're implementation details of `StageDijkstra`.
- **Performance**: Pipeline adds negligible overhead (function call per stage).
- **Future stages**: Curved routing, magnetic snapping, or channel routing become new `Stage` functions that can be swapped in.

## Migration Strategy

- Extract one stage at a time, keeping the monolith functional until all stages are extracted.
- `route_test.go` end-to-end tests validate correctness throughout.
- After full migration, add per-stage unit tests for edge cases.

## References

- Current `route.go`: `pkg/drawing/route.go` (566 lines)
- Pipeline pattern: https://go.dev/blog/pipelines
