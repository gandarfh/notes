//go:build tinygo.wasm

package main

import "notes/internal/plugins/drawing"

// ── JSON transport types ───────────────────────────────────
// These types define the JSON wire format between JS and Go.
// They exist because the drawing package types use Go-specific
// types (PathOp enums, AnchorSide) that need JSON-friendly wrappers.

// Input types (JS → Go)

type shapeInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
}

type shapePointInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	PX        float64 `json:"px"`
	PY        float64 `json:"py"`
}

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

type sketchInput struct {
	ShapeType string  `json:"shapeType"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	Seed      int     `json:"seed"`
	SW        float64 `json:"sw"`
	FillColor string  `json:"fillColor,omitempty"`
	FillStyle string  `json:"fillStyle,omitempty"`
}

type sketchLineInput struct {
	Points [][2]float64 `json:"points"`
	Seed   int          `json:"seed"`
	SW     float64      `json:"sw"`
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

// Output types (Go → JS)

type pathCmdJSON struct {
	Op   int       `json:"op"`
	Args []float64 `json:"args,omitempty"`
}

type strokePathJSON struct {
	Cmds        []pathCmdJSON `json:"cmds"`
	Opacity     float64       `json:"opacity"`
	StrokeWidth float64       `json:"strokeWidth"`
	IsClip      bool          `json:"isClip,omitempty"`
	IsFill      bool          `json:"isFill,omitempty"`
	FillColor   string        `json:"fillColor,omitempty"`
}

type anchorJSON struct {
	Side string  `json:"side"`
	T    float64 `json:"t"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

type shapeInfo struct {
	Type     string  `json:"type"`
	Label    string  `json:"label"`
	Category string  `json:"category"`
	DefaultW float64 `json:"defaultW"`
	DefaultH float64 `json:"defaultH"`
	Filled   bool    `json:"filled"`
}

// ── Converters ─────────────────────────────────────────────

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

func convertStrokePaths(paths []drawing.StrokePath) []strokePathJSON {
	out := make([]strokePathJSON, len(paths))
	for i, sp := range paths {
		out[i] = strokePathJSON{
			Cmds:        toPathCmdJSON(sp.Cmds),
			Opacity:     sp.Opacity,
			StrokeWidth: sp.StrokeWidth,
			IsClip:      sp.IsClip,
			IsFill:      sp.IsFill,
			FillColor:   sp.FillColor,
		}
	}
	return out
}

func convertAnchors(anchors []drawing.AnchorPoint) []anchorJSON {
	out := make([]anchorJSON, len(anchors))
	for i, a := range anchors {
		out[i] = anchorJSON{Side: string(a.Side), T: a.T, X: a.X, Y: a.Y}
	}
	return out
}

// sketchAllPaths combines fill + outline + icon paths for a shape.
func sketchAllPaths(shapeType string, w, h float64, seed int, sw float64, fillColor, fillStyle string) []drawing.StrokePath {
	var all []drawing.StrokePath

	if fillColor != "" {
		if fillStyle == "" {
			fillStyle = "hachure"
		}
		all = append(all, drawing.SketchFill(shapeType, w, h, seed, fillColor, fillStyle)...)
	}

	all = append(all, drawing.SketchOutline(shapeType, w, h, seed, sw)...)

	shape := drawing.DefaultRegistry.Get(shapeType)
	if shape != nil {
		if iconCmds := shape.IconPath(w, h); len(iconCmds) > 0 {
			all = append(all, drawing.StrokePath{
				Cmds: iconCmds, Opacity: 0.7, StrokeWidth: sw,
			})
		}
	}
	return all
}
