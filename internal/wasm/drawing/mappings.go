//go:build tinygo.wasm

package main

import "notes/internal/plugins/drawing"

// ── ID ↔ string mappings for binary protocol ───────────────
// The binary protocol uses integer IDs to avoid string overhead.
// These mappings must match the frontend drawing-worker.ts constants.

var shapeTypeNames = []string{
	"rectangle", "ellipse", "diamond",
	"database", "vm", "terminal", "user", "cloud",
}

func shapeTypeName(id int) string {
	if id >= 0 && id < len(shapeTypeNames) {
		return shapeTypeNames[id]
	}
	return "rectangle"
}

var sideNames = []string{"top", "right", "bottom", "left"}

func sideName(id int) string {
	if id >= 0 && id < len(sideNames) {
		return sideNames[id]
	}
	return ""
}

func sideToId(s string) float64 {
	switch s {
	case "top":
		return 0
	case "right":
		return 1
	case "bottom":
		return 2
	case "left":
		return 3
	}
	return -1
}

var arrowStyleNames = []string{"none", "dot", "arrow", "triangle", "bar", "diamond"}

func arrowStyleName(id int) string {
	if id >= 0 && id < len(arrowStyleNames) {
		return arrowStyleNames[id]
	}
	return "arrow"
}

// ── Geometry helper ────────────────────────────────────────

func geometryFor(shapeType string, w, h float64) drawing.Geometry2d {
	s := drawing.DefaultRegistry.Get(shapeType)
	if s != nil {
		return s.Geometry(w, h)
	}
	if shapeType == "rect" {
		return drawing.NewRectGeometry(w, h)
	}
	return nil
}
