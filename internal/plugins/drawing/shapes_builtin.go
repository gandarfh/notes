package drawing

// ═══════════════════════════════════════════════════════════════
// Built-in Shape Definitions: Rectangle, Ellipse, Diamond
// ═══════════════════════════════════════════════════════════════

// ── Rectangle ──────────────────────────────────────────────

type RectangleShape struct{}

func (s *RectangleShape) Type() string     { return "rectangle" }
func (s *RectangleShape) Label() string    { return "Rectangle" }
func (s *RectangleShape) Category() string { return "basic" }

func (s *RectangleShape) DefaultSize() (float64, float64) { return 160, 80 }
func (s *RectangleShape) MinSize() (float64, float64)     { return 40, 30 }
func (s *RectangleShape) ResizeMode() ResizeMode          { return ResizeFree }
func (s *RectangleShape) IsFilled() bool                  { return true }

func (s *RectangleShape) Geometry(w, h float64) Geometry2d {
	return NewRectGeometry(w, h)
}

func (s *RectangleShape) Anchors(w, h float64) []AnchorPoint {
	return fourSideAnchors(w, h)
}

func (s *RectangleShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *RectangleShape) OutlinePath(w, h float64) []PathCmd {
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{0, 0}},
		{Op: OpLineTo, Args: []float64{w, 0}},
		{Op: OpLineTo, Args: []float64{w, h}},
		{Op: OpLineTo, Args: []float64{0, h}},
		{Op: OpClose},
	}
}

func (s *RectangleShape) IconPath(w, h float64) []PathCmd { return nil }

func (s *RectangleShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchRectOutline(0, 0, w, h, sw, float64(seed))
}

func (s *RectangleShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

// ── Ellipse ────────────────────────────────────────────────

type EllipseShape struct{}

func (s *EllipseShape) Type() string     { return "ellipse" }
func (s *EllipseShape) Label() string    { return "Ellipse" }
func (s *EllipseShape) Category() string { return "basic" }

func (s *EllipseShape) DefaultSize() (float64, float64) { return 120, 80 }
func (s *EllipseShape) MinSize() (float64, float64)     { return 40, 30 }
func (s *EllipseShape) ResizeMode() ResizeMode          { return ResizeFree }
func (s *EllipseShape) IsFilled() bool                  { return true }

func (s *EllipseShape) Geometry(w, h float64) Geometry2d {
	return NewEllipseGeometry(w, h)
}

func (s *EllipseShape) Anchors(w, h float64) []AnchorPoint {
	return fourSideAnchors(w, h)
}

func (s *EllipseShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *EllipseShape) OutlinePath(w, h float64) []PathCmd {
	rx, ry := w/2, h/2
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{rx, 0}},
		{Op: OpArc, Args: []float64{rx, ry, 0, 1, 1, rx, h}},
		{Op: OpArc, Args: []float64{rx, ry, 0, 1, 1, rx, 0}},
	}
}

func (s *EllipseShape) IconPath(w, h float64) []PathCmd { return nil }

func (s *EllipseShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchEllipseOutline(w/2, h/2, w/2, h/2, sw, float64(seed))
}

func (s *EllipseShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

// ── Diamond ────────────────────────────────────────────────

type DiamondShape struct{}

func (s *DiamondShape) Type() string     { return "diamond" }
func (s *DiamondShape) Label() string    { return "Diamond" }
func (s *DiamondShape) Category() string { return "basic" }

func (s *DiamondShape) DefaultSize() (float64, float64) { return 120, 100 }
func (s *DiamondShape) MinSize() (float64, float64)     { return 50, 40 }
func (s *DiamondShape) ResizeMode() ResizeMode          { return ResizeFree }
func (s *DiamondShape) IsFilled() bool                  { return true }

func (s *DiamondShape) Geometry(w, h float64) Geometry2d {
	return NewDiamondGeometry(w, h)
}

func (s *DiamondShape) Anchors(w, h float64) []AnchorPoint {
	return fourSideAnchors(w, h)
}

func (s *DiamondShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *DiamondShape) OutlinePath(w, h float64) []PathCmd {
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{w / 2, 0}},
		{Op: OpLineTo, Args: []float64{w, h / 2}},
		{Op: OpLineTo, Args: []float64{w / 2, h}},
		{Op: OpLineTo, Args: []float64{0, h / 2}},
		{Op: OpClose},
	}
}

func (s *DiamondShape) IconPath(w, h float64) []PathCmd { return nil }

func (s *DiamondShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchDiamondOutline(w/2, h/2, w, h, sw, float64(seed))
}

func (s *DiamondShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

// ── Helpers ────────────────────────────────────────────────

// fourSideAnchors returns 4 anchor points at midpoints of each side.
func fourSideAnchors(w, h float64) []AnchorPoint {
	return []AnchorPoint{
		{Side: SideTop, T: 0.5, X: w / 2, Y: 0},
		{Side: SideBottom, T: 0.5, X: w / 2, Y: h},
		{Side: SideLeft, T: 0.5, X: 0, Y: h / 2},
		{Side: SideRight, T: 0.5, X: w, Y: h / 2},
	}
}

// findNearestAnchor returns the anchor closest to (px, py).
func findNearestAnchor(anchors []AnchorPoint, px, py float64) AnchorPoint {
	best := anchors[0]
	bestDist := Dist(Vec2{px, py}, Vec2{best.X, best.Y})
	for _, a := range anchors[1:] {
		d := Dist(Vec2{px, py}, Vec2{a.X, a.Y})
		if d < bestDist {
			bestDist = d
			best = a
		}
	}
	return best
}

func init() {
	DefaultRegistry.Register(&RectangleShape{})
	DefaultRegistry.Register(&EllipseShape{})
	DefaultRegistry.Register(&DiamondShape{})
}
