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
	cx, cy := w/2, h/2
	// Standard 4-quadrant Bézier approximation of an ellipse (kappa ≈ 0.5522847)
	k := 0.5522847
	kx, ky := cx*k, cy*k
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{cx, 0}},
		{Op: OpCurveTo, Args: []float64{cx + kx, 0, w, cy - ky, w, cy}},
		{Op: OpCurveTo, Args: []float64{w, cy + ky, cx + kx, h, cx, h}},
		{Op: OpCurveTo, Args: []float64{cx - kx, h, 0, cy + ky, 0, cy}},
		{Op: OpCurveTo, Args: []float64{0, cy - ky, cx - kx, 0, cx, 0}},
		{Op: OpClose},
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
