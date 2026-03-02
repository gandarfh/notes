package drawing

// ── Cloud ──────────────────────────────────────────────────

type CloudShape struct{}

func (s *CloudShape) Type() string     { return "cloud" }
func (s *CloudShape) Label() string    { return "Cloud" }
func (s *CloudShape) Category() string { return "infrastructure" }

func (s *CloudShape) DefaultSize() (float64, float64) { return 140, 90 }
func (s *CloudShape) MinSize() (float64, float64)     { return 70, 45 }
func (s *CloudShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *CloudShape) IsFilled() bool                  { return true }

func (s *CloudShape) Geometry(w, h float64) Geometry2d   { return NewEllipseGeometry(w, h) }
func (s *CloudShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *CloudShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *CloudShape) OutlinePath(w, h float64) []PathCmd {
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{w * 0.15, h * 0.65}},
		{Op: OpCurveTo, Args: []float64{w * -0.05, h * 0.55, w * 0.0, h * 0.20, w * 0.25, h * 0.20}},
		{Op: OpCurveTo, Args: []float64{w * 0.25, h * -0.05, w * 0.55, h * -0.05, w * 0.60, h * 0.15}},
		{Op: OpCurveTo, Args: []float64{w * 0.70, h * 0.05, w * 0.95, h * 0.15, w * 0.90, h * 0.45}},
		{Op: OpCurveTo, Args: []float64{w * 1.0, h * 0.60, w * 0.90, h * 0.80, w * 0.75, h * 0.75}},
		{Op: OpCurveTo, Args: []float64{w * 0.60, h * 0.90, w * 0.35, h * 0.85, w * 0.25, h * 0.78}},
		{Op: OpCurveTo, Args: []float64{w * 0.10, h * 0.85, w * 0.0, h * 0.75, w * 0.15, h * 0.65}},
	}
}

func (s *CloudShape) IconPath(w, h float64) []PathCmd { return nil }

func (s *CloudShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchFromPathCmds(s.OutlinePath(w, h), sw, float64(seed))
}

func (s *CloudShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

func init() { DefaultRegistry.Register(&CloudShape{}) }
