package drawing

// ── Terminal ───────────────────────────────────────────────

type TerminalShape struct{}

func (s *TerminalShape) Type() string     { return "terminal" }
func (s *TerminalShape) Label() string    { return "Terminal" }
func (s *TerminalShape) Category() string { return "infrastructure" }

func (s *TerminalShape) DefaultSize() (float64, float64) { return 120, 90 }
func (s *TerminalShape) MinSize() (float64, float64)     { return 60, 45 }
func (s *TerminalShape) ResizeMode() ResizeMode          { return ResizeFree }
func (s *TerminalShape) IsFilled() bool                  { return true }

func (s *TerminalShape) Geometry(w, h float64) Geometry2d   { return NewRectGeometry(w, h) }
func (s *TerminalShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *TerminalShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *TerminalShape) OutlinePath(w, h float64) []PathCmd {
	r := w * 0.05
	k := r * 0.5522847
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

func (s *TerminalShape) IconPath(w, h float64) []PathCmd {
	pad := w * 0.15
	chevY := h * 0.55
	chevH := h * 0.12
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{pad, chevY - chevH}},
		{Op: OpLineTo, Args: []float64{pad + w*0.12, chevY}},
		{Op: OpLineTo, Args: []float64{pad, chevY + chevH}},
		{Op: OpMoveTo, Args: []float64{pad + w*0.18, chevY + chevH}},
		{Op: OpLineTo, Args: []float64{pad + w*0.35, chevY + chevH}},
	}
}

func (s *TerminalShape) SketchOutline(w, h float64, seed int, sw float64) []StrokePath {
	return sketchFromPathCmds(s.OutlinePath(w, h), sw, float64(seed))
}

func (s *TerminalShape) SketchFill(w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	return sketchShapeFill(s, w, h, seed, fillColor, fillStyle)
}

func init() { DefaultRegistry.Register(&TerminalShape{}) }
