package drawing

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

func init() { DefaultRegistry.Register(&DiamondShape{}) }
