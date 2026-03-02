package drawing

// ── VM (Server) ────────────────────────────────────────────

type VMShape struct{}

func (s *VMShape) Type() string     { return "vm" }
func (s *VMShape) Label() string    { return "Server" }
func (s *VMShape) Category() string { return "infrastructure" }

func (s *VMShape) DefaultSize() (float64, float64) { return 100, 130 }
func (s *VMShape) MinSize() (float64, float64)     { return 50, 65 }
func (s *VMShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *VMShape) IsFilled() bool                  { return true }

func (s *VMShape) Geometry(w, h float64) Geometry2d   { return NewRectGeometry(w, h) }
func (s *VMShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *VMShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *VMShape) OutlinePath(w, h float64) []PathCmd {
	r := w * 0.06
	k := r * 0.5522847 // kappa for quarter-circle Bézier
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{r, 0}},
		{Op: OpLineTo, Args: []float64{w - r, 0}},
		{Op: OpCurveTo, Args: []float64{w - r + k, 0, w, r - k, w, r}},
		{Op: OpLineTo, Args: []float64{w, h - r}},
		{Op: OpCurveTo, Args: []float64{w, h - r + k, w - r + k, h, w - r, h}},
		{Op: OpLineTo, Args: []float64{r, h}},
		{Op: OpCurveTo, Args: []float64{r - k, h, 0, h - r + k, 0, h - r}},
		{Op: OpLineTo, Args: []float64{0, r}},
		{Op: OpCurveTo, Args: []float64{0, r - k, r - k, 0, r, 0}},
		{Op: OpClose},
	}
}

func (s *VMShape) IconPath(w, h float64) []PathCmd {
	y1, y2, y3 := h*0.30, h*0.55, h*0.80
	pad := w * 0.15
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{pad, y1}}, {Op: OpLineTo, Args: []float64{w - pad, y1}},
		{Op: OpMoveTo, Args: []float64{pad, y2}}, {Op: OpLineTo, Args: []float64{w - pad, y2}},
		{Op: OpMoveTo, Args: []float64{pad, y3}}, {Op: OpLineTo, Args: []float64{w - pad, y3}},
	}
}

func (s *VMShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchFromPathCmds(s.OutlinePath(w, h), sw, float64(seed))
}

func (s *VMShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

func init() { DefaultRegistry.Register(&VMShape{}) }
