//go:build tinygo.wasm

package main

import "notes/internal/plugins/drawing"

// ── Geometry & Shape WASM exports ──────────────────────────

//export hitTestPoint
func hitTestPoint(inputLen uint32) uint32 {
	in, err := unmarshal[shapePointInput](inputLen)
	if err != nil {
		return writeBool(false)
	}
	g := geometryFor(in.ShapeType, in.W, in.H)
	if g == nil {
		return writeBool(false)
	}
	return writeBool(g.HitTestPoint(drawing.Vec2{X: in.PX, Y: in.PY}))
}

//export nearestPoint
func nearestPoint(inputLen uint32) uint32 {
	in, err := unmarshal[shapePointInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	g := geometryFor(in.ShapeType, in.W, in.H)
	if g == nil {
		return writeError(nil)
	}
	return jsonResult(g.NearestPoint(drawing.Vec2{X: in.PX, Y: in.PY}))
}

//export binarySubdivisionT
func binarySubdivisionT(index uint32) float64 {
	return drawing.BinarySubdivisionT(int(index))
}

//export listShapes
func listShapes() uint32 {
	shapes := drawing.DefaultRegistry.List()
	infos := make([]shapeInfo, len(shapes))
	for i, s := range shapes {
		w, h := s.DefaultSize()
		infos[i] = shapeInfo{
			Type: s.Type(), Label: s.Label(), Category: s.Category(),
			DefaultW: w, DefaultH: h, Filled: s.IsFilled(),
		}
	}
	return jsonResult(infos)
}

//export getShapeOutline
func getShapeOutline(inputLen uint32) uint32 {
	in, err := unmarshal[shapeInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	shape := drawing.DefaultRegistry.Get(in.ShapeType)
	if shape == nil {
		return writeError(nil)
	}
	return jsonResult(struct {
		Outline []pathCmdJSON `json:"outline"`
		Icon    []pathCmdJSON `json:"icon,omitempty"`
	}{
		Outline: toPathCmdJSON(shape.OutlinePath(in.W, in.H)),
		Icon:    toPathCmdJSON(shape.IconPath(in.W, in.H)),
	})
}

//export getAnchors
func getAnchors(inputLen uint32) uint32 {
	in, err := unmarshal[shapeInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	shape := drawing.DefaultRegistry.Get(in.ShapeType)
	if shape == nil {
		return writeError(nil)
	}
	return jsonResult(convertAnchors(shape.Anchors(in.W, in.H)))
}

//export nearestAnchor
func nearestAnchor(inputLen uint32) uint32 {
	in, err := unmarshal[shapePointInput](inputLen)
	if err != nil {
		return writeError(err)
	}
	shape := drawing.DefaultRegistry.Get(in.ShapeType)
	if shape == nil {
		return writeError(nil)
	}
	a := shape.NearestAnchor(in.W, in.H, in.PX, in.PY)
	return jsonResult(anchorJSON{Side: string(a.Side), T: a.T, X: a.X, Y: a.Y})
}

// ── Binary exports (hot-path) ──────────────────────────────

//export hitTestPointBin
func hitTestPointBin() {
	r := newReader()
	g := geometryFor(r.ShapeType(), r.F64(), r.F64())
	w := newWriter()
	w.Bool(g != nil && g.HitTestPoint(drawing.Vec2{X: r.F64(), Y: r.F64()}))
}

//export nearestAnchorBin
func nearestAnchorBin() {
	r := newReader()
	st, sw, sh := r.ShapeType(), r.F64(), r.F64()
	px, py := r.F64(), r.F64()

	shape := drawing.DefaultRegistry.Get(st)
	if shape == nil {
		w := newWriter()
		w.F64(-1)
		return
	}

	best := shape.NearestAnchor(sw, sh, px, py)
	w := newWriter()
	w.SideId(string(best.Side))
	w.F64(best.T)
	w.F64(best.X)
	w.F64(best.Y)
}
