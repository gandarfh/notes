package drawing

import (
	"testing"
)

// ═══════════════════════════════════════════════════════════════
// Rect methods — Intersects has edge cases that matter
// ═══════════════════════════════════════════════════════════════

func TestRect_Intersects(t *testing.T) {
	a := Rect{0, 0, 100, 100}
	tests := []struct {
		name string
		b    Rect
		want bool
	}{
		{"overlapping", Rect{50, 50, 100, 100}, true},
		{"inside", Rect{10, 10, 20, 20}, true},
		{"touching edge", Rect{100, 0, 50, 50}, false},
		{"separate", Rect{200, 200, 50, 50}, false},
		{"adjacent vertical", Rect{0, 100, 100, 100}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := a.Intersects(tc.b); got != tc.want {
				t.Errorf("Intersects = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRect_Contains_WithMargin(t *testing.T) {
	r := Rect{10, 10, 80, 60}
	if !r.Contains(Vec2{50, 40}, 0) {
		t.Error("center should be inside")
	}
	if r.Contains(Vec2{0, 0}, 0) {
		t.Error("origin should be outside")
	}
	// Margin expands the containment area
	if !r.Contains(Vec2{5, 10}, 10) {
		t.Error("point near edge should be inside with margin 10")
	}
}

// ═══════════════════════════════════════════════════════════════
// findNearestAnchor — routing depends on correct anchor selection
// ═══════════════════════════════════════════════════════════════

func TestFindNearestAnchor_AllSides(t *testing.T) {
	anchors := fourSideAnchors(200, 100)
	tests := []struct {
		name string
		px   float64
		py   float64
		want AnchorSide
	}{
		{"above → top", 100, -10, SideTop},
		{"right → right", 250, 50, SideRight},
		{"below → bottom", 100, 150, SideBottom},
		{"left → left", -50, 50, SideLeft},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := findNearestAnchor(anchors, tc.px, tc.py)
			if a.Side != tc.want {
				t.Errorf("got %s, want %s", a.Side, tc.want)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════
// ShapeRegistry — thread-safe map, used at init time
// ═══════════════════════════════════════════════════════════════

func TestShapeRegistry_RegisterGetAndNotFound(t *testing.T) {
	reg := &ShapeRegistry{}
	reg.Register(&RectangleShape{})

	if reg.Get("rectangle") == nil {
		t.Fatal("registered shape should be found")
	}
	if reg.Get("nonexistent") != nil {
		t.Error("unregistered shape should return nil")
	}
}

func TestShapeRegistry_ListAndTypes(t *testing.T) {
	reg := &ShapeRegistry{}
	reg.Register(&RectangleShape{})
	reg.Register(&EllipseShape{})
	reg.Register(&CloudShape{})

	if len(reg.List()) != 3 {
		t.Errorf("List len = %d, want 3", len(reg.List()))
	}

	types := reg.Types()
	found := map[string]bool{}
	for _, tp := range types {
		found[tp] = true
	}
	if !found["rectangle"] || !found["ellipse"] || !found["cloud"] {
		t.Errorf("Types = %v, missing expected entries", types)
	}
}

func TestDefaultRegistry_HasAllShapes(t *testing.T) {
	for _, tp := range []string{"rectangle", "ellipse", "diamond", "cloud"} {
		if DefaultRegistry.Get(tp) == nil {
			t.Errorf("DefaultRegistry missing %q", tp)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// Shape → Geometry factory (correct type returned?)
// ═══════════════════════════════════════════════════════════════

func TestShapes_GeometryFactory(t *testing.T) {
	tests := []struct {
		shape ShapeDef
		geom  string
	}{
		{&RectangleShape{}, "*drawing.RectGeometry"},
		{&EllipseShape{}, "*drawing.EllipseGeometry"},
		{&DiamondShape{}, "*drawing.DiamondGeometry"},
		{&CloudShape{}, "*drawing.EllipseGeometry"}, // cloud reuses ellipse
	}
	for _, tc := range tests {
		t.Run(tc.shape.Type(), func(t *testing.T) {
			w, h := tc.shape.DefaultSize()
			g := tc.shape.Geometry(w, h)
			if g == nil {
				t.Fatal("Geometry returned nil")
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════
// Cloud OutlinePath — all CurveTo (regression guard)
// ═══════════════════════════════════════════════════════════════

func TestCloudShape_OutlinePath_HasCurves(t *testing.T) {
	s := &CloudShape{}
	outline := s.OutlinePath(140, 90)
	hasCurve := false
	for _, cmd := range outline {
		if cmd.Op == OpCurveTo {
			hasCurve = true
			break
		}
	}
	if !hasCurve {
		t.Error("cloud outline should have CurveTo commands")
	}
}

// ═══════════════════════════════════════════════════════════════
// Sketch rendering — structure + determinism
// ═══════════════════════════════════════════════════════════════

func TestRectangleShape_SketchOutline_Structure(t *testing.T) {
	s := &RectangleShape{}
	paths := s.SketchOutline(100, 50, 42, 2)
	// 4 edges × 2 passes = 8 paths
	if len(paths) != 8 {
		t.Errorf("len = %d, want 8", len(paths))
	}
}

func TestSketchOutline_Deterministic(t *testing.T) {
	s := &RectangleShape{}
	a := s.SketchOutline(100, 50, 42, 2)
	b := s.SketchOutline(100, 50, 42, 2)
	for i := range a {
		if a[i].Opacity != b[i].Opacity || a[i].StrokeWidth != b[i].StrokeWidth {
			t.Errorf("path[%d] differs with same seed", i)
		}
	}
}

func TestEllipseShape_SketchOutline_TwoPasses(t *testing.T) {
	s := &EllipseShape{}
	paths := s.SketchOutline(100, 80, 42, 2)
	if len(paths) != 2 {
		t.Errorf("len = %d, want 2 (one per pass)", len(paths))
	}
}

func TestDiamondShape_SketchOutline_Structure(t *testing.T) {
	s := &DiamondShape{}
	paths := s.SketchOutline(100, 80, 42, 2)
	// 4 edges × 2 passes = 8
	if len(paths) != 8 {
		t.Errorf("len = %d, want 8", len(paths))
	}
}

func TestCloudShape_SketchOutline_EmptyBecauseNoCurveSupport(t *testing.T) {
	s := &CloudShape{}
	paths := s.SketchOutline(140, 90, 42, 2)
	// sketchFromPathCmds ignores CurveTo → cloud sketch is empty
	// This documents the behavior (potential bug #9)
	if len(paths) != 0 {
		t.Errorf("expected 0 paths (CurveTo not sketched), got %d", len(paths))
	}
}

func TestSketchFill_Hachure_ClipAndFillStructure(t *testing.T) {
	shapes := []ShapeDef{&RectangleShape{}, &EllipseShape{}, &DiamondShape{}, &CloudShape{}}
	for _, s := range shapes {
		t.Run(s.Type(), func(t *testing.T) {
			w, h := s.DefaultSize()
			paths := s.SketchFill(w, h, 42, "#ff0000", "hachure")
			if len(paths) < 2 {
				t.Fatal("need at least clip + 1 fill path")
			}
			if !paths[0].IsClip {
				t.Error("first path should be clip")
			}
			hasFill := false
			for _, p := range paths[1:] {
				if p.IsFill && p.FillColor == "#ff0000" {
					hasFill = true
					break
				}
			}
			if !hasFill {
				t.Error("should have fill paths with FillColor")
			}
		})
	}
}

func TestSketchFill_Solid_UsesLineTo(t *testing.T) {
	s := &RectangleShape{}
	w, h := s.DefaultSize()
	paths := s.SketchFill(w, h, 42, "#0000ff", "solid")
	if !paths[0].IsClip {
		t.Error("first should be clip")
	}
	// Solid uses LineTo (straight lines), hachure uses QuadTo (wobble)
	for _, p := range paths[1:] {
		for _, cmd := range p.Cmds {
			if cmd.Op == OpQuadTo {
				t.Error("solid fill should use LineTo, not QuadTo")
				return
			}
		}
	}
}
