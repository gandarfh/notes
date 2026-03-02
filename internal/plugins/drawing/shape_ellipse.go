package drawing

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

func init() { DefaultRegistry.Register(&EllipseShape{}) }
