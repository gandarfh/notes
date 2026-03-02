# RFC 002 — WASM Bridge Dispatcher

**Status**: Implemented  
**Date**: 2026-03-01  
**Author**: João + Antigravity  

## Summary

Replace the repetitive boilerplate in `pkg/drawing/cmd/wasm/main.go` with a generic dispatcher pattern. Each WASM export currently repeats the same 7-step sequence (unmarshal → call logic → marshal → copy buffer → return length). A centralized dispatcher eliminates this duplication, reducing `main.go` from 730 to ~250 lines.

## Motivation

1. **Boilerplate**: 13 WASM exports repeat the same unmarshal/marshal/buffer-copy pattern, accounting for ~50% of `main.go`.
2. **Error-prone**: Buffer management (`copy(resultBuf[:], result)`) is manually repeated — a missed copy or wrong variable is hard to catch.
3. **Onboarding**: Adding a new WASM function requires copying 20+ lines of boilerplate, knowing the buffer protocol, and matching the exact pattern.

## Architecture

```
Current (per-export boilerplate):

  //export foo                    //export bar
  func foo(inputLen uint32) {     func bar(inputLen uint32) {
    unmarshal(buf[:inputLen])       unmarshal(buf[:inputLen])
    result := logic(input)          result := logic(input)
    out := json.Marshal(result)     out := json.Marshal(result)
    copy(resultBuf, out)            copy(resultBuf, out)
    return len(out)                 return len(out)
  }                               }

Proposed (centralized dispatcher):

  func init() {
    jsonHandler("foo", func(in FooInput) (FooOutput, error) {
      return logic(in), nil
    })
    jsonHandler("bar", func(in BarInput) (BarOutput, error) {
      return logic(in), nil
    })
  }
```

### Dispatcher implementation

```go
// dispatch.go — handles marshal/unmarshal, errors, and buffers generically

func jsonHandler[In, Out any](name string, fn func(In) (Out, error)) {
    // Registers a handler that:
    // 1. Unmarshals buf[:inputLen] → In
    // 2. Calls fn(input) → (Out, error)
    // 3. Marshals Out → resultBuf
    // 4. Returns length
}
```

> **TinyGo note**: If generics aren't fully supported, use `func([]byte) ([]byte, error)` wrappers with typed closures.

## Implementation Plan

### Phase 1 — Dispatcher core
1. Create `dispatch.go` with `jsonHandler()` and `binHandler()` helpers
2. Centralize buffer management and error handling

### Phase 2 — Migrate JSON exports
1. Migrate one export at a time (e.g. `computeOrthoRoute` first)
2. Keep `//export` directives unchanged — protocol doesn't change
3. Remove per-export boilerplate after each migration

### Phase 3 — Migrate binary exports
1. Apply same pattern via `binHandler()` for hot-path binary functions
2. Integrates with RFC-005 (Binary Protocol Abstraction)

## Considerations

- **TinyGo generics**: TinyGo's generics support may be limited. Fallback to interface-based dispatch if needed.
- **Zero breaking changes**: WASM export signatures remain identical. Frontend is unaffected.
- **Testability**: Handlers can be unit tested without WASM by calling the registered function directly.

## Migration Strategy

- Incremental: migrate 1 export per commit
- Existing tests (`go test ./pkg/drawing/...`) validate each step
- Old and new patterns can coexist during migration

## References

- Current `main.go`: `pkg/drawing/cmd/wasm/main.go` (730 lines, 13 exports)
- TinyGo generics support: https://tinygo.org/docs/reference/lang-support/
