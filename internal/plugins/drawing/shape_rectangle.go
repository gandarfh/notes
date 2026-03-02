package drawing

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

func init() { DefaultRegistry.Register(&RectangleShape{}) }
