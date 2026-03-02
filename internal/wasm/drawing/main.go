//go:build tinygo.wasm

// Package main is the TinyGo WASM entrypoint for the drawing engine.
//
// Files:
//
//	bridge.go           — shared buffers, JSON dispatch helpers
//	binproto.go         — BinReader/BinWriter for binary Float64 protocol
//	mappings.go         — ID ↔ string mappings, geometry helper
//	types.go            — JSON wire format types and converters
//	exports_geometry.go — geometry & shape WASM exports
//	exports_routing.go  — routing WASM exports
//	exports_sketch.go   — sketch rendering WASM exports
package main

func main() {}
