package drawing

// ═══════════════════════════════════════════════════════════════
// Custom Shape Definitions: Database, VM, Terminal, User, Cloud
// These become available in the drawing shape library.
// ═══════════════════════════════════════════════════════════════

// ── Database (Cylinder) ────────────────────────────────────

type DatabaseShape struct{}

func (s *DatabaseShape) Type() string     { return "database" }
func (s *DatabaseShape) Label() string    { return "Database" }
func (s *DatabaseShape) Category() string { return "infrastructure" }

func (s *DatabaseShape) DefaultSize() (float64, float64) { return 100, 120 }
func (s *DatabaseShape) MinSize() (float64, float64)     { return 50, 60 }
func (s *DatabaseShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *DatabaseShape) IsFilled() bool                  { return true }

func (s *DatabaseShape) Geometry(w, h float64) Geometry2d {
	return NewRectGeometry(w, h)
}

func (s *DatabaseShape) Anchors(w, h float64) []AnchorPoint {
	return fourSideAnchors(w, h)
}

func (s *DatabaseShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *DatabaseShape) OutlinePath(w, h float64) []PathCmd {
	// Cylinder: top ellipse → vertical sides → bottom ellipse
	ry := h * 0.15 // ellipse height = 15% of total
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{0, ry}},
		{Op: OpArc, Args: []float64{w / 2, ry, 0, 0, 1, w, ry}},
		{Op: OpLineTo, Args: []float64{w, h - ry}},
		{Op: OpArc, Args: []float64{w / 2, ry, 0, 0, 1, 0, h - ry}},
		{Op: OpClose},
		// Top cap (full ellipse)
		{Op: OpMoveTo, Args: []float64{0, ry}},
		{Op: OpArc, Args: []float64{w / 2, ry, 0, 0, 0, w, ry}},
	}
}

func (s *DatabaseShape) IconPath(w, h float64) []PathCmd {
	// Middle line for "data rows" effect
	ry := h * 0.15
	midY := h * 0.45
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{0, midY}},
		{Op: OpArc, Args: []float64{w / 2, ry * 0.6, 0, 0, 0, w, midY}},
	}
}

// ── VM (Server) ────────────────────────────────────────────

type VMShape struct{}

func (s *VMShape) Type() string     { return "vm" }
func (s *VMShape) Label() string    { return "Server" }
func (s *VMShape) Category() string { return "infrastructure" }

func (s *VMShape) DefaultSize() (float64, float64) { return 100, 130 }
func (s *VMShape) MinSize() (float64, float64)     { return 50, 65 }
func (s *VMShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *VMShape) IsFilled() bool                  { return true }

func (s *VMShape) Geometry(w, h float64) Geometry2d {
	return NewRectGeometry(w, h)
}

func (s *VMShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *VMShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *VMShape) OutlinePath(w, h float64) []PathCmd {
	r := w * 0.06 // rounded corners
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{r, 0}},
		{Op: OpLineTo, Args: []float64{w - r, 0}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, w, r}},
		{Op: OpLineTo, Args: []float64{w, h - r}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, w - r, h}},
		{Op: OpLineTo, Args: []float64{r, h}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, 0, h - r}},
		{Op: OpLineTo, Args: []float64{0, r}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, r, 0}},
	}
}

func (s *VMShape) IconPath(w, h float64) []PathCmd {
	// Three horizontal lines simulating drive bays
	y1, y2, y3 := h*0.30, h*0.55, h*0.80
	pad := w * 0.15
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{pad, y1}}, {Op: OpLineTo, Args: []float64{w - pad, y1}},
		{Op: OpMoveTo, Args: []float64{pad, y2}}, {Op: OpLineTo, Args: []float64{w - pad, y2}},
		{Op: OpMoveTo, Args: []float64{pad, y3}}, {Op: OpLineTo, Args: []float64{w - pad, y3}},
	}
}

// ── Terminal ───────────────────────────────────────────────

type TerminalShape struct{}

func (s *TerminalShape) Type() string     { return "terminal" }
func (s *TerminalShape) Label() string    { return "Terminal" }
func (s *TerminalShape) Category() string { return "infrastructure" }

func (s *TerminalShape) DefaultSize() (float64, float64) { return 120, 90 }
func (s *TerminalShape) MinSize() (float64, float64)     { return 60, 45 }
func (s *TerminalShape) ResizeMode() ResizeMode          { return ResizeFree }
func (s *TerminalShape) IsFilled() bool                  { return true }

func (s *TerminalShape) Geometry(w, h float64) Geometry2d {
	return NewRectGeometry(w, h)
}

func (s *TerminalShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *TerminalShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *TerminalShape) OutlinePath(w, h float64) []PathCmd {
	r := w * 0.05
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{r, 0}},
		{Op: OpLineTo, Args: []float64{w - r, 0}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, w, r}},
		{Op: OpLineTo, Args: []float64{w, h - r}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, w - r, h}},
		{Op: OpLineTo, Args: []float64{r, h}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, 0, h - r}},
		{Op: OpLineTo, Args: []float64{0, r}},
		{Op: OpArc, Args: []float64{r, r, 0, 0, 1, r, 0}},
	}
}

func (s *TerminalShape) IconPath(w, h float64) []PathCmd {
	// "> _" prompt icon
	pad := w * 0.15
	chevY := h * 0.55
	chevH := h * 0.12
	return []PathCmd{
		// ">"
		{Op: OpMoveTo, Args: []float64{pad, chevY - chevH}},
		{Op: OpLineTo, Args: []float64{pad + w*0.12, chevY}},
		{Op: OpLineTo, Args: []float64{pad, chevY + chevH}},
		// "_"
		{Op: OpMoveTo, Args: []float64{pad + w*0.18, chevY + chevH}},
		{Op: OpLineTo, Args: []float64{pad + w*0.35, chevY + chevH}},
	}
}

// ── User (Person) ──────────────────────────────────────────

type UserShape struct{}

func (s *UserShape) Type() string     { return "user" }
func (s *UserShape) Label() string    { return "User" }
func (s *UserShape) Category() string { return "people" }

func (s *UserShape) DefaultSize() (float64, float64) { return 80, 100 }
func (s *UserShape) MinSize() (float64, float64)     { return 40, 50 }
func (s *UserShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *UserShape) IsFilled() bool                  { return true }

func (s *UserShape) Geometry(w, h float64) Geometry2d {
	return NewRectGeometry(w, h) // bounding box for hit testing
}

func (s *UserShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *UserShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *UserShape) OutlinePath(w, h float64) []PathCmd {
	// Person silhouette: head (circle) + body (trapezoid)
	cx := w / 2
	headR := w * 0.22
	headY := h * 0.25
	return []PathCmd{
		// Head
		{Op: OpMoveTo, Args: []float64{cx + headR, headY}},
		{Op: OpArc, Args: []float64{headR, headR, 0, 1, 1, cx + headR, headY}},
		// Body
		{Op: OpMoveTo, Args: []float64{cx - w*0.35, h}},
		{Op: OpLineTo, Args: []float64{cx - w*0.15, h * 0.50}},
		{Op: OpLineTo, Args: []float64{cx + w*0.15, h * 0.50}},
		{Op: OpLineTo, Args: []float64{cx + w*0.35, h}},
		{Op: OpClose},
	}
}

func (s *UserShape) IconPath(w, h float64) []PathCmd { return nil }

// ── Cloud ──────────────────────────────────────────────────

type CloudShape struct{}

func (s *CloudShape) Type() string     { return "cloud" }
func (s *CloudShape) Label() string    { return "Cloud" }
func (s *CloudShape) Category() string { return "infrastructure" }

func (s *CloudShape) DefaultSize() (float64, float64) { return 140, 90 }
func (s *CloudShape) MinSize() (float64, float64)     { return 70, 45 }
func (s *CloudShape) ResizeMode() ResizeMode          { return ResizeAspect }
func (s *CloudShape) IsFilled() bool                  { return true }

func (s *CloudShape) Geometry(w, h float64) Geometry2d {
	return NewEllipseGeometry(w, h) // approximate cloud as ellipse for hit testing
}

func (s *CloudShape) Anchors(w, h float64) []AnchorPoint { return fourSideAnchors(w, h) }
func (s *CloudShape) NearestAnchor(w, h, px, py float64) AnchorPoint {
	return findNearestAnchor(fourSideAnchors(w, h), px, py)
}

func (s *CloudShape) OutlinePath(w, h float64) []PathCmd {
	// Cloud shape: 3 bumps on top, flat bottom curve
	return []PathCmd{
		{Op: OpMoveTo, Args: []float64{w * 0.15, h * 0.65}},
		// Left bump
		{Op: OpCurveTo, Args: []float64{w * -0.05, h * 0.55, w * 0.0, h * 0.20, w * 0.25, h * 0.20}},
		// Center bump (tallest)
		{Op: OpCurveTo, Args: []float64{w * 0.25, h * -0.05, w * 0.55, h * -0.05, w * 0.60, h * 0.15}},
		// Right bump
		{Op: OpCurveTo, Args: []float64{w * 0.70, h * 0.05, w * 0.95, h * 0.15, w * 0.90, h * 0.45}},
		// Bottom right curve
		{Op: OpCurveTo, Args: []float64{w * 1.0, h * 0.60, w * 0.90, h * 0.80, w * 0.75, h * 0.75}},
		// Bottom center
		{Op: OpCurveTo, Args: []float64{w * 0.60, h * 0.90, w * 0.35, h * 0.85, w * 0.25, h * 0.78}},
		// Bottom left back to start
		{Op: OpCurveTo, Args: []float64{w * 0.10, h * 0.85, w * 0.0, h * 0.75, w * 0.15, h * 0.65}},
	}
}

func (s *CloudShape) IconPath(w, h float64) []PathCmd { return nil }

func init() {
	DefaultRegistry.Register(&DatabaseShape{})
	DefaultRegistry.Register(&VMShape{})
	DefaultRegistry.Register(&TerminalShape{})
	DefaultRegistry.Register(&UserShape{})
	DefaultRegistry.Register(&CloudShape{})
}
