//go:build tinygo.wasm

package main

import "notes/internal/plugins/drawing"

// ── Sketch rendering WASM exports ──────────────────────────

//export getSketchPaths
func getSketchPaths(inputLen uint32) uint32 {
	in, err := unmarshal[sketchInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	paths := sketchAllPaths(in.ShapeType, in.W, in.H, in.Seed, in.SW, in.FillColor, in.FillStyle)
	return jsonResult(convertStrokePaths(paths))
}

//export getSketchLinePaths
func getSketchLinePaths(inputLen uint32) uint32 {
	in, err := unmarshal[sketchLineInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	return jsonResult(convertStrokePaths(drawing.SketchLinePaths(in.Points, in.Seed, in.SW)))
}

//export getArrowHeadPaths
func getArrowHeadPaths(inputLen uint32) uint32 {
	in, err := unmarshal[arrowHeadInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	return jsonResult(convertStrokePaths(
		drawing.ArrowHeadPaths(in.Style, in.TipX, in.TipY, in.Angle, in.Size, in.Seed, in.SW),
	))
}

// ── Binary exports (hot-path 60fps) ────────────────────────

//export getSketchPathsBin
func getSketchPathsBin() float64 {
	r := newReader()
	st := r.ShapeType()
	sw, sh := r.F64(), r.F64()
	seed := r.Int()
	strokeW := r.F64()
	hasFill := r.Bool()
	fillStyleId := r.Int()

	fillColor := ""
	fillStyle := "hachure"
	if hasFill {
		fillColor = " "
		if fillStyleId == 1 {
			fillStyle = "solid"
		}
	}

	paths := sketchAllPaths(st, sw, sh, seed, strokeW, fillColor, fillStyle)
	w := newWriter()
	w.StrokePaths(paths)
	return w.Len()
}

//export getSketchLinePathsBin
func getSketchLinePathsBin() float64 {
	r := newReader()
	points := r.Points()
	seed := r.Int()
	sw := r.F64()

	paths := drawing.SketchLinePaths(points, seed, sw)
	w := newWriter()
	w.StrokePaths(paths)
	return w.Len()
}

//export getArrowHeadPathsBin
func getArrowHeadPathsBin() float64 {
	r := newReader()
	style := r.ArrowStyle()
	tipX, tipY := r.F64(), r.F64()
	angle, size := r.F64(), r.F64()
	seed := r.Int()
	sw := r.F64()

	paths := drawing.ArrowHeadPaths(style, tipX, tipY, angle, size, seed, sw)
	w := newWriter()
	w.StrokePaths(paths)
	return w.Len()
}
