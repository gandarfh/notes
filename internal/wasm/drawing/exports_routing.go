//go:build tinygo.wasm

package main

import "notes/internal/plugins/drawing"

// ── Routing WASM exports ───────────────────────────────────

//export computeOrthoRoute
func computeOrthoRoute(inputLen uint32) uint32 {
	in, err := unmarshal[routeInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	points := drawing.ComputeOrthoRoute(in.DX, in.DY, drawing.RouteOpts{
		StartSide: in.StartSide, EndSide: in.EndSide,
		StartRect: in.StartRect, EndRect: in.EndRect,
		ShapeObstacles: in.ShapeObstacles, ArrowObstacles: in.ArrowObstacles,
	})
	return jsonResult(points)
}

// ── Binary export (hot-path) ───────────────────────────────

//export computeOrthoRouteBin
func computeOrthoRouteBin() {
	r := newReader()
	dx, dy := r.F64(), r.F64()
	opts := drawing.RouteOpts{
		StartSide: r.Side(),
		EndSide:   r.Side(),
		StartRect: r.OptionalRect(),
		EndRect:   r.OptionalRect(),
	}
	nObs := r.Int()
	if nObs > 0 {
		opts.ShapeObstacles = r.Rects(nObs)
	}

	points := drawing.ComputeOrthoRoute(dx, dy, opts)

	w := newWriter()
	w.Points(points)
}
