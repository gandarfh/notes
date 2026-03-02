# RFC 005 — Binary Protocol Abstraction

**Status**: Implemented  
**Date**: 2026-03-01  
**Author**: João + Antigravity  

## Summary

Replace manual Float64Array indexing in binary WASM exports with `BinReader`/`BinWriter` abstractions. This eliminates off-by-one errors, improves readability, and reduces the binary export code from ~180 to ~50 lines.

## Motivation

1. **Manual indexing**: Every binary export hand-codes `f64Buf[0]`, `f64Buf[1]`, `idx += 5`, etc. Off-by-one errors are hard to catch and debug.
2. **Protocol mirroring**: The TypeScript worker has equivalent manual indexing that must stay in sync with Go. No shared source of truth.
3. **Readability**: `f64Buf[idx+3]` tells you nothing about semantics. `r.Side()` is self-documenting.

## Architecture

```
Current (manual indexing):

  Go:    dx := f64Buf[0]; dy := f64Buf[1]; side := sideName(int(f64Buf[2]))
  TS:    const dx = f64In[0]; const dy = f64In[1]; const side = sideNames[f64In[2]]

Proposed (auto-increment readers/writers):

  Go:    r := NewReader(f64Buf[:]); dx, dy := r.F64(), r.F64(); side := r.Side()
  TS:    (mirrors Go reader API — future codegen opportunity)
```

### Core types

```go
// binproto.go

type BinReader struct {
    buf []float64
    pos int
}

func NewReader(buf []float64) *BinReader

func (r *BinReader) F64() float64            // read float64, advance pos
func (r *BinReader) Int() int                // read as int
func (r *BinReader) Bool() bool              // read as bool (1.0 = true)
func (r *BinReader) ShapeType() string       // read int → shape type name
func (r *BinReader) Side() string            // read int → side name
func (r *BinReader) ArrowStyle() string      // read int → arrow style name
func (r *BinReader) Rect() drawing.Rect      // read 4 floats → Rect
func (r *BinReader) OptionalRect() *Rect     // read flag + 4 floats → *Rect or nil
func (r *BinReader) Points() [][2]float64    // read count + pairs → points
func (r *BinReader) Rects(n int) []Rect      // read n rects

type BinWriter struct {
    buf []float64
    pos int
}

func NewWriter(buf []float64) *BinWriter

func (w *BinWriter) F64(v float64)
func (w *BinWriter) Int(v int)
func (w *BinWriter) Bool(v bool)
func (w *BinWriter) Points(pts [][]float64)
func (w *BinWriter) StrokePaths(paths []drawing.StrokePath)
func (w *BinWriter) Len() float64
```

### Usage example

```go
// Before (computeOrthoRouteBin — 50 lines of manual indexing):
dx := f64Buf[0]
dy := f64Buf[1]
startSide := sideName(int(f64Buf[2]))
endSide := sideName(int(f64Buf[3]))
idx := 4
if f64Buf[idx] == 1 {
    opts.StartRect = &drawing.Rect{X: f64Buf[idx+1], Y: f64Buf[idx+2], ...}
}
idx += 5
// ... 20 more lines ...

// After (10 lines):
r := NewReader(f64Buf[:])
dx, dy := r.F64(), r.F64()
opts := drawing.RouteOpts{
    StartSide: r.Side(),
    EndSide:   r.Side(),
    StartRect: r.OptionalRect(),
    EndRect:   r.OptionalRect(),
}
opts.ShapeObstacles = r.Rects(r.Int())
points := drawing.ComputeOrthoRoute(dx, dy, opts)
w := NewWriter(f64ResultBuf[:])
w.Points(points)
```

## Implementation Plan

### Phase 1 — BinReader/BinWriter
1. Create `pkg/drawing/cmd/wasm/binproto.go` with `BinReader` and `BinWriter`
2. Unit test read/write roundtrips

### Phase 2 — Migrate simple exports
1. `hitTestPointBin` (5 reads, 1 write — simplest)
2. `nearestAnchorBin` (5 reads, 4 writes)
3. Verify WASM output is identical

### Phase 3 — Migrate complex exports
1. `computeOrthoRouteBin` (variable-length input with optional rects)
2. `getSketchLinePathsBin`, `getArrowHeadPathsBin`, `getSketchPathsBin` (use `w.StrokePaths()`)
3. Delete old `writeStrokePathsBin` helper

## Considerations

- **Zero protocol change**: Binary format is identical — only the Go implementation changes. Frontend/worker is unaffected.
- **TinyGo compatible**: Uses only basic types (slices, structs). No generics or reflection needed.
- **Foundation for RFC-002**: The `binHandler()` in the dispatcher RFC can use `BinReader`/`BinWriter` internally.
- **Codegen opportunity**: Future tooling could generate matching TS readers from Go struct definitions.

## Migration Strategy

- Migrate one binary export at a time. Each export can be independently migrated and tested.
- Old `writeStrokePathsBin` stays until all consumers are migrated.
- WASM binary output should be bit-identical before and after migration.

## References

- Current binary protocol: `pkg/drawing/cmd/wasm/main.go` (lines 429-730)
- Similar pattern: Protocol Buffers / FlatBuffers reader abstraction
