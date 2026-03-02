//go:build tinygo.wasm

package main

import (
	"encoding/json"
	"notes/pkg/drawing"
	"unsafe"
)

// ── Shared buffer for data exchange ────────────────────────
// TinyGo WASM can only export functions with numeric params.
// We use a shared buffer: JS writes JSON input → Go reads → computes → writes JSON output.

const bufSize = 64 * 1024 // 64KB shared buffer

var buf [bufSize]byte
var resultBuf [bufSize]byte

//export getBuffer
func getBuffer() unsafe.Pointer {
	return unsafe.Pointer(&buf[0])
}

//export getResultBuffer
func getResultBuffer() unsafe.Pointer {
	return unsafe.Pointer(&resultBuf[0])
}

// ── Routing ────────────────────────────────────────────────

type routeInput struct {
	DX             float64        `json:"dx"`
	DY             float64        `json:"dy"`
	StartSide      string         `json:"startSide"`
	EndSide        string         `json:"endSide"`
	StartRect      *drawing.Rect  `json:"startRect,omitempty"`
	EndRect        *drawing.Rect  `json:"endRect,omitempty"`
	ShapeObstacles []drawing.Rect `json:"shapeObstacles,omitempty"`
	ArrowObstacles []drawing.Rect `json:"arrowObstacles,omitempty"`
}

//export computeOrthoRoute
func computeOrthoRoute(inputLen uint32) uint32 {
	var input routeInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}

	opts := drawing.RouteOpts{
		StartSide:      input.StartSide,
		EndSide:        input.EndSide,
		StartRect:      input.StartRect,
		EndRect:        input.EndRect,
		ShapeObstacles: input.ShapeObstacles,
		ArrowObstacles: input.ArrowObstacles,
	}

	points := drawing.ComputeOrthoRoute(input.DX, input.DY, opts)

	out, err := json.Marshal(points)
	if err != nil {
		return writeError(err)
	}
	copy(resultBuf[:], out)
	return uint32(len(out))
}

// ── Geometry queries ───────────────────────────────────────

type hitTestInput struct {
	ShapeType string  `json:"shapeType"` // "rect", "ellipse", "diamond"
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	PX        float64 `json:"px"`
	PY        float64 `json:"py"`
}

//export hitTestPoint
func hitTestPoint(inputLen uint32) uint32 {
	var input hitTestInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeBool(false)
	}

	g := geometryFor(input.ShapeType, input.W, input.H)
	if g == nil {
		return writeBool(false)
	}

	result := g.HitTestPoint(drawing.Vec2{X: input.PX, Y: input.PY})
	return writeBool(result)
}

type nearestPointInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	PX        float64 `json:"px"`
	PY        float64 `json:"py"`
}

//export nearestPoint
func nearestPoint(inputLen uint32) uint32 {
	var input nearestPointInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}

	g := geometryFor(input.ShapeType, input.W, input.H)
	if g == nil {
		return writeError(nil)
	}

	np := g.NearestPoint(drawing.Vec2{X: input.PX, Y: input.PY})
	out, _ := json.Marshal(np)
	copy(resultBuf[:], out)
	return uint32(len(out))
}

//export binarySubdivisionT
func binarySubdivisionT(index uint32) float64 {
	return drawing.BinarySubdivisionT(int(index))
}

// ── Helpers ────────────────────────────────────────────────

func geometryFor(shapeType string, w, h float64) drawing.Geometry2d {
	s := drawing.DefaultRegistry.Get(shapeType)
	if s != nil {
		return s.Geometry(w, h)
	}
	// Legacy fallback for "rect" alias
	if shapeType == "rect" {
		return drawing.NewRectGeometry(w, h)
	}
	return nil
}

func writeError(err error) uint32 {
	msg := `{"error":"unknown"}`
	if err != nil {
		msg = `{"error":"` + err.Error() + `"}`
	}
	copy(resultBuf[:], msg)
	return uint32(len(msg))
}

func writeBool(v bool) uint32 {
	if v {
		copy(resultBuf[:], "true")
		return 4
	}
	copy(resultBuf[:], "false")
	return 5
}

// ── Shape registry queries ─────────────────────────────────

type shapeInfo struct {
	Type     string  `json:"type"`
	Label    string  `json:"label"`
	Category string  `json:"category"`
	DefaultW float64 `json:"defaultW"`
	DefaultH float64 `json:"defaultH"`
	Filled   bool    `json:"filled"`
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
	out, _ := json.Marshal(infos)
	copy(resultBuf[:], out)
	return uint32(len(out))
}

type outlineInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
}

type pathCmdJSON struct {
	Op   int       `json:"op"`
	Args []float64 `json:"args,omitempty"`
}

//export getShapeOutline
func getShapeOutline(inputLen uint32) uint32 {
	var input outlineInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}
	shape := drawing.DefaultRegistry.Get(input.ShapeType)
	if shape == nil {
		return writeError(nil)
	}
	outline := shape.OutlinePath(input.W, input.H)
	icon := shape.IconPath(input.W, input.H)

	result := struct {
		Outline []pathCmdJSON `json:"outline"`
		Icon    []pathCmdJSON `json:"icon,omitempty"`
	}{
		Outline: toPathCmdJSON(outline),
		Icon:    toPathCmdJSON(icon),
	}
	out, _ := json.Marshal(result)
	copy(resultBuf[:], out)
	return uint32(len(out))
}

func toPathCmdJSON(cmds []drawing.PathCmd) []pathCmdJSON {
	if cmds == nil {
		return nil
	}
	result := make([]pathCmdJSON, len(cmds))
	for i, c := range cmds {
		result[i] = pathCmdJSON{Op: int(c.Op), Args: c.Args}
	}
	return result
}

// ── Anchor queries ─────────────────────────────────────────

type anchorInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
}

type anchorJSON struct {
	Side string  `json:"side"`
	T    float64 `json:"t"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

//export getAnchors
func getAnchors(inputLen uint32) uint32 {
	var input anchorInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}
	shape := drawing.DefaultRegistry.Get(input.ShapeType)
	if shape == nil {
		return writeError(nil)
	}
	anchors := shape.Anchors(input.W, input.H)
	out := make([]anchorJSON, len(anchors))
	for i, a := range anchors {
		out[i] = anchorJSON{Side: string(a.Side), T: a.T, X: a.X, Y: a.Y}
	}
	result, _ := json.Marshal(out)
	copy(resultBuf[:], result)
	return uint32(len(result))
}

type nearestAnchorInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	PX        float64 `json:"px"`
	PY        float64 `json:"py"`
}

//export nearestAnchor
func nearestAnchor(inputLen uint32) uint32 {
	var input nearestAnchorInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}
	shape := drawing.DefaultRegistry.Get(input.ShapeType)
	if shape == nil {
		return writeError(nil)
	}
	a := shape.NearestAnchor(input.W, input.H, input.PX, input.PY)
	result, _ := json.Marshal(anchorJSON{Side: string(a.Side), T: a.T, X: a.X, Y: a.Y})
	copy(resultBuf[:], result)
	return uint32(len(result))
}

// ── Sketchy rendering ──────────────────────────────────────

type sketchInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	Seed      int     `json:"seed"`
	SW        float64 `json:"sw"`
	FillColor string  `json:"fillColor,omitempty"`
	FillStyle string  `json:"fillStyle,omitempty"`
}

type strokePathJSON struct {
	Cmds        []pathCmdJSON `json:"cmds"`
	Opacity     float64       `json:"opacity"`
	StrokeWidth float64       `json:"strokeWidth"`
	IsClip      bool          `json:"isClip,omitempty"`
	IsFill      bool          `json:"isFill,omitempty"`
	FillColor   string        `json:"fillColor,omitempty"`
}

//export getSketchPaths
func getSketchPaths(inputLen uint32) uint32 {
	var input sketchInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}

	var allPaths []drawing.StrokePath

	// Generate fill strokes first (they render behind the outline)
	if input.FillColor != "" {
		fillStyle := input.FillStyle
		if fillStyle == "" {
			fillStyle = "hachure"
		}
		fillPaths := drawing.SketchFill(input.ShapeType, input.W, input.H, input.Seed, input.FillColor, fillStyle)
		allPaths = append(allPaths, fillPaths...)
	}

	// Generate outline strokes
	outlinePaths := drawing.SketchOutline(input.ShapeType, input.W, input.H, input.Seed, input.SW)
	allPaths = append(allPaths, outlinePaths...)

	// Also include icon paths if the shape has them
	shape := drawing.DefaultRegistry.Get(input.ShapeType)
	if shape != nil {
		iconCmds := shape.IconPath(input.W, input.H)
		if len(iconCmds) > 0 {
			allPaths = append(allPaths, drawing.StrokePath{
				Cmds:        iconCmds,
				Opacity:     0.7,
				StrokeWidth: input.SW,
			})
		}
	}

	// Convert to JSON-friendly format
	out := make([]strokePathJSON, len(allPaths))
	for i, sp := range allPaths {
		out[i] = strokePathJSON{
			Cmds:        toPathCmdJSON(sp.Cmds),
			Opacity:     sp.Opacity,
			StrokeWidth: sp.StrokeWidth,
			IsClip:      sp.IsClip,
			IsFill:      sp.IsFill,
			FillColor:   sp.FillColor,
		}
	}

	result, _ := json.Marshal(out)
	copy(resultBuf[:], result)
	return uint32(len(result))
}

func main() {}

// ── Arrow rendering WASM exports ───────────────────────────

type sketchLineInput struct {
	Points [][2]float64 `json:"points"`
	Seed   int          `json:"seed"`
	SW     float64      `json:"sw"`
}

//export getSketchLinePaths
func getSketchLinePaths(inputLen uint32) uint32 {
	var input sketchLineInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}
	paths := drawing.SketchLinePaths(input.Points, input.Seed, input.SW)
	out := make([]strokePathJSON, len(paths))
	for i, sp := range paths {
		out[i] = strokePathJSON{
			Cmds:        toPathCmdJSON(sp.Cmds),
			Opacity:     sp.Opacity,
			StrokeWidth: sp.StrokeWidth,
			IsFill:      sp.IsFill,
		}
	}
	result, _ := json.Marshal(out)
	copy(resultBuf[:], result)
	return uint32(len(result))
}

type arrowHeadInput struct {
	Style string  `json:"style"`
	TipX  float64 `json:"tipX"`
	TipY  float64 `json:"tipY"`
	Angle float64 `json:"angle"`
	Size  float64 `json:"size"`
	Seed  int     `json:"seed"`
	SW    float64 `json:"sw"`
}

//export getArrowHeadPaths
func getArrowHeadPaths(inputLen uint32) uint32 {
	var input arrowHeadInput
	if err := json.Unmarshal(buf[:inputLen], &input); err != nil {
		return writeError(err)
	}
	paths := drawing.ArrowHeadPaths(input.Style, input.TipX, input.TipY, input.Angle, input.Size, input.Seed, input.SW)
	out := make([]strokePathJSON, len(paths))
	for i, sp := range paths {
		out[i] = strokePathJSON{
			Cmds:        toPathCmdJSON(sp.Cmds),
			Opacity:     sp.Opacity,
			StrokeWidth: sp.StrokeWidth,
			IsFill:      sp.IsFill,
			FillColor:   sp.FillColor,
		}
	}
	result, _ := json.Marshal(out)
	copy(resultBuf[:], result)
	return uint32(len(result))
}

// ════════════════════════════════════════════════════════════
// Binary Float64 protocol (no JSON — for hot-path 60fps calls)
// ════════════════════════════════════════════════════════════

const f64BufSize = 8192 // 8192 float64s = 64KB

var f64Buf [f64BufSize]float64
var f64ResultBuf [f64BufSize]float64

//export getFloat64Buffer
func getFloat64Buffer() unsafe.Pointer {
	return unsafe.Pointer(&f64Buf[0])
}

//export getFloat64ResultBuffer
func getFloat64ResultBuffer() unsafe.Pointer {
	return unsafe.Pointer(&f64ResultBuf[0])
}

// ── ID Mappings ────────────────────────────────────────────

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

// ── Binary hitTestPoint ────────────────────────────────────
// Input:  [shapeTypeId, w, h, px, py]
// Output: [0 or 1]

//export hitTestPointBin
func hitTestPointBin() {
	st := shapeTypeName(int(f64Buf[0]))
	w, h := f64Buf[1], f64Buf[2]
	px, py := f64Buf[3], f64Buf[4]

	g := geometryFor(st, w, h)
	if g != nil && g.HitTestPoint(drawing.Vec2{X: px, Y: py}) {
		f64ResultBuf[0] = 1
	} else {
		f64ResultBuf[0] = 0
	}
}

// ── Binary nearestAnchor ───────────────────────────────────
// Input:  [shapeTypeId, w, h, px, py]
// Output: [sideId, t, x, y]

//export nearestAnchorBin
func nearestAnchorBin() {
	st := shapeTypeName(int(f64Buf[0]))
	w, h := f64Buf[1], f64Buf[2]
	px, py := f64Buf[3], f64Buf[4]

	shape := drawing.DefaultRegistry.Get(st)
	if shape == nil {
		f64ResultBuf[0] = -1
		return
	}

	anchors := shape.Anchors(w, h)
	if len(anchors) == 0 {
		f64ResultBuf[0] = -1
		return
	}

	bestDist := 1e18
	bestIdx := 0
	for i, a := range anchors {
		dx := a.X - px
		dy := a.Y - py
		d := dx*dx + dy*dy
		if d < bestDist {
			bestDist = d
			bestIdx = i
		}
	}

	best := anchors[bestIdx]
	f64ResultBuf[0] = sideToId(string(best.Side))
	f64ResultBuf[1] = best.T
	f64ResultBuf[2] = best.X
	f64ResultBuf[3] = best.Y
}

// ── Binary computeOrthoRoute ───────────────────────────────
// Input:  [dx, dy, startSideId, endSideId,
//          hasStartRect, sx, sy, sw, sh,
//          hasEndRect,   ex, ey, ew, eh,
//          nObs, ox0, oy0, ow0, oh0, ...]
// Output: [nPoints, x0, y0, x1, y1, ...]

//export computeOrthoRouteBin
func computeOrthoRouteBin() {
	dx := f64Buf[0]
	dy := f64Buf[1]
	startSide := sideName(int(f64Buf[2]))
	endSide := sideName(int(f64Buf[3]))

	opts := drawing.RouteOpts{
		StartSide: startSide,
		EndSide:   endSide,
	}

	idx := 4
	if f64Buf[idx] == 1 {
		opts.StartRect = &drawing.Rect{
			X: f64Buf[idx+1], Y: f64Buf[idx+2],
			W: f64Buf[idx+3], H: f64Buf[idx+4],
		}
	}
	idx += 5

	if f64Buf[idx] == 1 {
		opts.EndRect = &drawing.Rect{
			X: f64Buf[idx+1], Y: f64Buf[idx+2],
			W: f64Buf[idx+3], H: f64Buf[idx+4],
		}
	}
	idx += 5

	nObs := int(f64Buf[idx])
	idx++
	if nObs > 0 {
		obs := make([]drawing.Rect, nObs)
		for i := 0; i < nObs; i++ {
			obs[i] = drawing.Rect{
				X: f64Buf[idx], Y: f64Buf[idx+1],
				W: f64Buf[idx+2], H: f64Buf[idx+3],
			}
			idx += 4
		}
		opts.ShapeObstacles = obs
	}

	points := drawing.ComputeOrthoRoute(dx, dy, opts)

	f64ResultBuf[0] = float64(len(points))
	o := 1
	for _, pt := range points {
		f64ResultBuf[o] = pt[0]
		f64ResultBuf[o+1] = pt[1]
		o += 2
	}
}

// ── Binary StrokePath output helper ────────────────────────
// Format per StrokePath: [nCmds, opacity, strokeWidth, flags, ...cmds]
//   flags: bit0=isClip, bit1=isFill
//   each cmd: [op, nArgs, ...args]

func writeStrokePathsBin(paths []drawing.StrokePath) float64 {
	o := 1 // leave [0] for total count
	for _, sp := range paths {
		nCmds := len(sp.Cmds)
		f64ResultBuf[o] = float64(nCmds)
		f64ResultBuf[o+1] = sp.Opacity
		f64ResultBuf[o+2] = sp.StrokeWidth

		var flags float64
		if sp.IsClip {
			flags += 1
		}
		if sp.IsFill {
			flags += 2
		}
		f64ResultBuf[o+3] = flags
		o += 4

		for _, cmd := range sp.Cmds {
			f64ResultBuf[o] = float64(cmd.Op)
			f64ResultBuf[o+1] = float64(len(cmd.Args))
			o += 2
			for _, a := range cmd.Args {
				f64ResultBuf[o] = a
				o++
			}
		}
	}
	f64ResultBuf[0] = float64(len(paths))
	return float64(o)
}

// ── Binary getSketchLinePaths ──────────────────────────────
// Input:  [nPoints, x0, y0, x1, y1, ..., seed, sw]
// Output: StrokePath binary format

//export getSketchLinePathsBin
func getSketchLinePathsBin() float64 {
	nPts := int(f64Buf[0])
	points := make([][2]float64, nPts)
	idx := 1
	for i := 0; i < nPts; i++ {
		points[i] = [2]float64{f64Buf[idx], f64Buf[idx+1]}
		idx += 2
	}
	seed := int(f64Buf[idx])
	sw := f64Buf[idx+1]

	paths := drawing.SketchLinePaths(points, seed, sw)
	return writeStrokePathsBin(paths)
}

// ── Binary getArrowHeadPaths ───────────────────────────────
// Input:  [styleId, tipX, tipY, angle, size, seed, sw]
// Output: StrokePath binary format

//export getArrowHeadPathsBin
func getArrowHeadPathsBin() float64 {
	style := arrowStyleName(int(f64Buf[0]))
	tipX := f64Buf[1]
	tipY := f64Buf[2]
	angle := f64Buf[3]
	size := f64Buf[4]
	seed := int(f64Buf[5])
	sw := f64Buf[6]

	paths := drawing.ArrowHeadPaths(style, tipX, tipY, angle, size, seed, sw)
	return writeStrokePathsBin(paths)
}

// ── Binary getSketchPaths (shapes) ─────────────────────────
// Input:  [shapeTypeId, w, h, seed, sw, hasFill, fillStyleId]
//   fillStyleId: 0=hachure, 1=solid
// Output: StrokePath binary format

//export getSketchPathsBin
func getSketchPathsBin() float64 {
	st := shapeTypeName(int(f64Buf[0]))
	w, h := f64Buf[1], f64Buf[2]
	seed := int(f64Buf[3])
	sw := f64Buf[4]
	hasFill := f64Buf[5] == 1
	fillStyleId := int(f64Buf[6])

	var allPaths []drawing.StrokePath

	if hasFill {
		fillStyle := "hachure"
		if fillStyleId == 1 {
			fillStyle = "solid"
		}
		fillPaths := drawing.SketchFill(st, w, h, seed, "", fillStyle)
		allPaths = append(allPaths, fillPaths...)
	}

	outlinePaths := drawing.SketchOutline(st, w, h, seed, sw)
	allPaths = append(allPaths, outlinePaths...)

	shape := drawing.DefaultRegistry.Get(st)
	if shape != nil {
		iconCmds := shape.IconPath(w, h)
		if len(iconCmds) > 0 {
			allPaths = append(allPaths, drawing.StrokePath{
				Cmds:        iconCmds,
				Opacity:     0.7,
				StrokeWidth: sw,
			})
		}
	}

	return writeStrokePathsBin(allPaths)
}
