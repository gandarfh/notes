package drawing

import (
	"math"
	"testing"
)

func TestComputeOrthoRoute_StraightLine(t *testing.T) {
	// Straight horizontal: right→left, same Y
	pts := ComputeOrthoRoute(200, 0, RouteOpts{
		StartSide: "right",
		EndSide:   "left",
	})
	if len(pts) < 2 {
		t.Fatalf("expected at least 2 points, got %d", len(pts))
	}
	// Start at origin
	if pts[0][0] != 0 || pts[0][1] != 0 {
		t.Errorf("expected start at (0,0), got (%.1f,%.1f)", pts[0][0], pts[0][1])
	}
	// End at destination
	last := pts[len(pts)-1]
	if last[0] != 200 || last[1] != 0 {
		t.Errorf("expected end at (200,0), got (%.1f,%.1f)", last[0], last[1])
	}
	// Should be a straight line (no bends)
	for _, p := range pts {
		if math.Abs(p[1]) > 0.5 {
			t.Errorf("expected all Y=0 for straight line, got Y=%.1f", p[1])
		}
	}
}

func TestComputeOrthoRoute_WithObstacles(t *testing.T) {
	srcRect := Rect{-80, -40, 160, 80}
	dstRect := Rect{400, -40, 160, 80}
	obstacle := Rect{200, -60, 100, 120} // obstacle between src and dst

	pts := ComputeOrthoRoute(480, 0, RouteOpts{
		StartSide:      "right",
		EndSide:        "left",
		StartRect:      &srcRect,
		EndRect:        &dstRect,
		ShapeObstacles: []Rect{obstacle},
	})

	if len(pts) < 2 {
		t.Fatalf("expected path, got %d points", len(pts))
	}
	// Verify all segments are orthogonal (no diagonals)
	for i := 0; i < len(pts)-1; i++ {
		a, b := pts[i], pts[i+1]
		dx := math.Abs(a[0] - b[0])
		dy := math.Abs(a[1] - b[1])
		if dx > 0.5 && dy > 0.5 {
			t.Errorf("diagonal segment detected: (%.1f,%.1f)→(%.1f,%.1f)", a[0], a[1], b[0], b[1])
		}
	}
}

func TestSimpleOrthoRoute_LShape(t *testing.T) {
	pts := SimpleOrthoRoute(200, 300, "right", "top")
	if len(pts) < 2 {
		t.Fatalf("expected at least 2 points, got %d", len(pts))
	}
	// All segments should be orthogonal
	for i := 0; i < len(pts)-1; i++ {
		a, b := pts[i], pts[i+1]
		dx := math.Abs(a[0] - b[0])
		dy := math.Abs(a[1] - b[1])
		if dx > 0.5 && dy > 0.5 {
			t.Errorf("diagonal segment: (%.1f,%.1f)→(%.1f,%.1f)", a[0], a[1], b[0], b[1])
		}
	}
}

func TestBinarySubdivisionT(t *testing.T) {
	expected := []float64{0.5, 0.25, 0.75, 0.125, 0.375}
	for i, want := range expected {
		got := BinarySubdivisionT(i)
		if math.Abs(got-want) > 0.001 {
			t.Errorf("BinarySubdivisionT(%d) = %.3f, want %.3f", i, got, want)
		}
	}
}

// ── Geometry tests ─────────────────────────────────────────

func TestRectGeometry_HitTestPoint(t *testing.T) {
	g := NewRectGeometry(100, 50)
	if !g.HitTestPoint(Vec2{50, 25}) {
		t.Error("center should be inside")
	}
	if g.HitTestPoint(Vec2{-1, 25}) {
		t.Error("left of rect should be outside")
	}
	if g.HitTestPoint(Vec2{101, 25}) {
		t.Error("right of rect should be outside")
	}
}

func TestRectGeometry_NearestPoint(t *testing.T) {
	g := NewRectGeometry(100, 50)
	// Point above rect center
	np := g.NearestPoint(Vec2{50, -20})
	if math.Abs(np.X-50) > 0.5 || math.Abs(np.Y) > 0.5 {
		t.Errorf("expected nearest ~(50,0), got (%.1f,%.1f)", np.X, np.Y)
	}
}

func TestEllipseGeometry_HitTestPoint(t *testing.T) {
	g := NewEllipseGeometry(100, 100) // circle
	if !g.HitTestPoint(Vec2{50, 50}) {
		t.Error("center should be inside")
	}
	if g.HitTestPoint(Vec2{0, 0}) {
		t.Error("corner should be outside circle")
	}
}

func TestDiamondGeometry_HitTestPoint(t *testing.T) {
	g := NewDiamondGeometry(100, 100)
	if !g.HitTestPoint(Vec2{50, 50}) {
		t.Error("center should be inside")
	}
	if g.HitTestPoint(Vec2{0, 0}) {
		t.Error("corner should be outside diamond")
	}
}

func TestSideDir(t *testing.T) {
	tests := []struct {
		side  string
		wantX float64
		wantY float64
	}{
		{"top", 0, -1},
		{"bottom", 0, 1},
		{"left", -1, 0},
		{"right", 1, 0},
	}
	for _, tt := range tests {
		dx, dy := SideDir(tt.side)
		if dx != tt.wantX || dy != tt.wantY {
			t.Errorf("SideDir(%q) = (%.0f,%.0f), want (%.0f,%.0f)", tt.side, dx, dy, tt.wantX, tt.wantY)
		}
	}
}
