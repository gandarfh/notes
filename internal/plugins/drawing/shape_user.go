package drawing

// ── User (Person) ──────────────────────────────────────────

type UserShape struct{}

func (s *UserShape) Type() string     { return "user" }
func (s *UserShape) Label() string    { return "User" }
func (s *UserShape) Category() string { return "people" }

func (s *UserShape) DefaultSize() (float64, float64) { return 80, 100 }
func (s *UserShape) MinSize() (float64, float64)     { return 40, 50 }
func (s *UserShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *UserShape) IsFilled() bool                  { return true }

func (s *UserShape) Geometry(w, h float64) Geometry2d   { return NewRectGeometry(w, h) }
func (s *UserShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *UserShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *UserShape) OutlinePath(w, h float64) []PathCmd {
	cx := w / 2
	headR := w * 0.22
	headY := h * 0.25
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{cx + headR, headY}},
		{Op: OpArc, Args: []float64{headR, headR, 0, 1, 1, cx + headR, headY}},
		{Op: OpMoveTo, Args: []float64{cx - w*0.35, h}},
		{Op: OpLineTo, Args: []float64{cx - w*0.15, h * 0.50}},
		{Op: OpLineTo, Args: []float64{cx + w*0.15, h * 0.50}},
		{Op: OpLineTo, Args: []float64{cx + w*0.35, h}},
		{Op: OpClose},
	}
}

func (s *UserShape) IconPath(w, h float64) []PathCmd { return nil }

func (s *UserShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchFromPathCmds(s.OutlinePath(w, h), sw, float64(seed))
}

func (s *UserShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

func init() { DefaultRegistry.Register(&UserShape{}) }
