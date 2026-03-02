package drawing

// ── Database (Cylinder) ────────────────────────────────────

type DatabaseShape struct{}

func (s *DatabaseShape) Type() string     { return "database" }
func (s *DatabaseShape) Label() string    { return "Database" }
func (s *DatabaseShape) Category() string { return "infrastructure" }

func (s *DatabaseShape) DefaultSize() (float64, float64) { return 100, 120 }
func (s *DatabaseShape) MinSize() (float64, float64)     { return 50, 60 }
func (s *DatabaseShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *DatabaseShape) IsFilled() bool                  { return true }

func (s *DatabaseShape) Geometry(w, h float64) Geometry2d { return NewRectGeometry(w, h) }

func (s *DatabaseShape) Anchors(w, h float64) []AnchorPoint {
	return fourSideAnchors(w, h)
}

func (s *DatabaseShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *DatabaseShape) OutlinePath(w, h float64) []PathCmd {
	ry := h * 0.15
	cx := w / 2
	kx := cx * 0.5522847
	ky := ry * 0.5522847
	return []PathCmd{
		// Body: left side down, bottom ellipse arc, right side up, top ellipse arc
		{Op: OpMoveTo, Args: []float64{0, ry}},
		// Top ellipse (front arc — curves downward)
		{Op: OpCurveTo, Args: []float64{0, ry - ky, cx - kx, 0, cx, 0}},
		{Op: OpCurveTo, Args: []float64{cx + kx, 0, w, ry - ky, w, ry}},
		// Right side down
		{Op: OpLineTo, Args: []float64{w, h - ry}},
		// Bottom ellipse arc
		{Op: OpCurveTo, Args: []float64{w, h - ry + ky, cx + kx, h, cx, h}},
		{Op: OpCurveTo, Args: []float64{cx - kx, h, 0, h - ry + ky, 0, h - ry}},
		{Op: OpClose},
	}
}

func (s *DatabaseShape) IconPath(w, h float64) []PathCmd {
	ry := h * 0.15
	midY := h * 0.45
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{0, midY}},
		{Op: OpArc, Args: []float64{w / 2, ry * 0.6, 0, 0, 0, w, midY}},
	}
}

func (s *DatabaseShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchFromPathCmds(s.OutlinePath(w, h), sw, float64(seed))
}

func (s *DatabaseShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

func init() { DefaultRegistry.Register(&DatabaseShape{}) }
