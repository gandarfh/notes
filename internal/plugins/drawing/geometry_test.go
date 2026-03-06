package drawing

import (
	"math"
	"testing"
)

const tolerance = 0.01

func approxEqual(a, b, eps float64) bool {
	return math.Abs(a-b) < eps
}

// ═══════════════════════════════════════════════════════════════
// RectGeometry — non-trivial methods
// ═══════════════════════════════════════════════════════════════

func TestRectGeometry_PointOnPerimeter(t *testing.T) {
	g := NewRectGeometry(100, 50)
	// Perimeter = 300, walks: top(100) → right(50) → bottom(100) → left(50)
	tests := []struct {
		t    float64
		want Vec2
	}{
		{0, Vec2{0, 0}},       // start of top edge
		{0.5, Vec2{100, 50}},  // halfway = top(100) + right(50) = 150/300 → bottom-right corner
		{1.0, Vec2{0, 0}},     // wraps back
		{-0.5, Vec2{100, 50}}, // negative t normalizes
	}
	for _, tc := range tests {
		got := g.PointOnPerimeter(tc.t)
		if !approxEqual(got.X, tc.want.X, 1) || !approxEqual(got.Y, tc.want.Y, 1) {
			t.Errorf("PointOnPerimeter(%.2f) = (%.1f,%.1f), want (%.1f,%.1f)",
				tc.t, got.X, got.Y, tc.want.X, tc.want.Y)
		}
	}
}

func TestRectGeometry_HitTestPoint_BoundaryInclusive(t *testing.T) {
	g := NewRectGeometry(100, 50)
	if !g.HitTestPoint(Vec2{0, 0}) {
		t.Error("origin corner should be inside (boundary inclusive)")
	}
	if !g.HitTestPoint(Vec2{100, 50}) {
		t.Error("far corner should be inside (boundary inclusive)")
	}
	if g.HitTestPoint(Vec2{-0.1, 25}) {
		t.Error("just outside left should be outside")
	}
}

func TestRectGeometry_HitTestSegment(t *testing.T) {
	g := NewRectGeometry(100, 50)
	if !g.HitTestSegment(Vec2{-10, 25}, Vec2{110, 25}) {
		t.Error("horizontal through rect should hit")
	}
	if !g.HitTestSegment(Vec2{50, -10}, Vec2{50, 60}) {
		t.Error("vertical through rect should hit")
	}
	if g.HitTestSegment(Vec2{200, 0}, Vec2{200, 100}) {
		t.Error("far away should not hit")
	}
}

func TestRectGeometry_NearestPoint_AllFourEdges(t *testing.T) {
	g := NewRectGeometry(100, 50)

	// Inside, nearest to each edge (tests all 4 switch branches)
	tests := []struct {
		name    string
		p       Vec2
		wantX   float64
		wantY   float64
	}{
		{"near top", Vec2{50, 5}, 50, 0},
		{"near bottom", Vec2{50, 48}, 50, 50},
		{"near left", Vec2{3, 25}, 0, 25},
		{"near right", Vec2{98, 25}, 100, 25},
		// Outside: clamps to boundary
		{"outside above-left", Vec2{-10, -10}, 0, 0},
		{"outside below-right", Vec2{120, 80}, 100, 50},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			np := g.NearestPoint(tc.p)
			if !approxEqual(np.X, tc.wantX, tolerance) || !approxEqual(np.Y, tc.wantY, tolerance) {
				t.Errorf("NearestPoint(%v) = (%.1f,%.1f), want (%.0f,%.0f)", tc.p, np.X, np.Y, tc.wantX, tc.wantY)
			}
		})
	}
}

func TestRectGeometry_DistanceToPoint(t *testing.T) {
	g := NewRectGeometry(100, 50)
	// Outside: 10 units above top edge
	if d := g.DistanceToPoint(Vec2{50, -10}); !approxEqual(d, 10, tolerance) {
		t.Errorf("distance above = %.2f, want 10", d)
	}
	// On boundary → 0
	if d := g.DistanceToPoint(Vec2{100, 50}); !approxEqual(d, 0, tolerance) {
		t.Errorf("distance on corner = %.2f, want 0", d)
	}
}

// ═══════════════════════════════════════════════════════════════
// EllipseGeometry — parametric math and spatial queries
// ═══════════════════════════════════════════════════════════════

func TestEllipseGeometry_Perimeter_Ramanujan(t *testing.T) {
	// Circle r=50: exact perimeter = 2*pi*50 ≈ 314.16
	g := NewEllipseGeometry(100, 100)
	expected := 2 * math.Pi * 50
	if !approxEqual(g.Perimeter(), expected, 1) {
		t.Errorf("Perimeter(circle) = %.1f, want ~%.1f", g.Perimeter(), expected)
	}
}

func TestEllipseGeometry_PointOnPerimeter(t *testing.T) {
	g := NewEllipseGeometry(100, 100)
	// t=0 → rightmost (cx+rx, cy)
	p := g.PointOnPerimeter(0)
	if !approxEqual(p.X, 100, 0.5) || !approxEqual(p.Y, 50, 0.5) {
		t.Errorf("t=0: %v, want ~(100, 50)", p)
	}
	// t=0.25 → bottom (cx, cy+ry)
	p = g.PointOnPerimeter(0.25)
	if !approxEqual(p.X, 50, 0.5) || !approxEqual(p.Y, 100, 0.5) {
		t.Errorf("t=0.25: %v, want ~(50, 100)", p)
	}
}

func TestEllipseGeometry_HitTestPoint_CornersOutside(t *testing.T) {
	g := NewEllipseGeometry(100, 100)
	for _, c := range []Vec2{{0, 0}, {100, 0}, {100, 100}, {0, 100}} {
		if g.HitTestPoint(c) {
			t.Errorf("corner %v should be outside circle", c)
		}
	}
}

func TestEllipseGeometry_HitTestSegment(t *testing.T) {
	g := NewEllipseGeometry(100, 100)
	if !g.HitTestSegment(Vec2{-10, 50}, Vec2{110, 50}) {
		t.Error("horizontal through center should hit")
	}
	if g.HitTestSegment(Vec2{200, 0}, Vec2{200, 100}) {
		t.Error("far away should not hit")
	}
}

func TestEllipseGeometry_NearestPoint(t *testing.T) {
	g := NewEllipseGeometry(100, 100)
	// Outside right → projects to rightmost perimeter
	np := g.NearestPoint(Vec2{200, 50})
	if !approxEqual(np.X, 100, 1) {
		t.Errorf("NearestPoint(right) X = %.1f, want ~100", np.X)
	}
	// At center → defaults to rightmost (special case in code)
	np = g.NearestPoint(Vec2{50, 50})
	if !approxEqual(np.X, 100, 1) {
		t.Errorf("NearestPoint(center) X = %.1f, want ~100 (default right)", np.X)
	}
}

// ═══════════════════════════════════════════════════════════════
// DiamondGeometry — rhombus math
// ═══════════════════════════════════════════════════════════════

func TestDiamondGeometry_PointOnPerimeter(t *testing.T) {
	g := NewDiamondGeometry(100, 80)
	// Each side = 25% of perimeter
	tests := []struct {
		t     float64
		wantX float64
		wantY float64
	}{
		{0, 50, 0},      // top vertex
		{0.25, 100, 40}, // right vertex
		{0.5, 50, 80},   // bottom vertex
	}
	for _, tc := range tests {
		p := g.PointOnPerimeter(tc.t)
		if !approxEqual(p.X, tc.wantX, tolerance) || !approxEqual(p.Y, tc.wantY, tolerance) {
			t.Errorf("t=%.2f: %v, want ~(%.0f,%.0f)", tc.t, p, tc.wantX, tc.wantY)
		}
	}
}

func TestDiamondGeometry_HitTestSegment(t *testing.T) {
	g := NewDiamondGeometry(100, 80)
	if !g.HitTestSegment(Vec2{-10, 40}, Vec2{110, 40}) {
		t.Error("horizontal through center should hit")
	}
	if g.HitTestSegment(Vec2{200, 0}, Vec2{200, 100}) {
		t.Error("far away should not hit")
	}
}

func TestDiamondGeometry_NearestPoint(t *testing.T) {
	g := NewDiamondGeometry(100, 80)
	// Far above top vertex → should snap to top vertex
	np := g.NearestPoint(Vec2{50, -50})
	if !approxEqual(np.X, 50, 1) || !approxEqual(np.Y, 0, 1) {
		t.Errorf("NearestPoint(above) = %v, want ~(50,0)", np)
	}
	// Far right → should snap to right vertex
	np = g.NearestPoint(Vec2{200, 40})
	if !approxEqual(np.X, 100, 1) || !approxEqual(np.Y, 40, 1) {
		t.Errorf("NearestPoint(right) = %v, want ~(100,40)", np)
	}
}

func TestDiamondGeometry_DistanceToPoint(t *testing.T) {
	g := NewDiamondGeometry(100, 80)
	// On vertex → 0
	if d := g.DistanceToPoint(Vec2{50, 0}); !approxEqual(d, 0, tolerance) {
		t.Errorf("distance at vertex = %.2f, want 0", d)
	}
	// 10 units above vertex
	if d := g.DistanceToPoint(Vec2{50, -10}); d < 9 || d > 11 {
		t.Errorf("distance above = %.2f, want ~10", d)
	}
}

// ═══════════════════════════════════════════════════════════════
// EdgeCrossesRect — epsilon expansion + axis-aligned behavior
// ═══════════════════════════════════════════════════════════════

func TestEdgeCrossesRect(t *testing.T) {
	r := Rect{10, 10, 80, 60}

	tests := []struct {
		name string
		a, b Vec2
		want bool
	}{
		{"horizontal crossing", Vec2{0, 40}, Vec2{100, 40}, true},
		{"horizontal above", Vec2{0, 0}, Vec2{100, 0}, false},
		{"horizontal on boundary (epsilon)", Vec2{0, 10}, Vec2{100, 10}, true},
		{"vertical crossing", Vec2{50, 0}, Vec2{50, 100}, true},
		{"vertical left of rect", Vec2{0, 0}, Vec2{0, 100}, false},
		{"diagonal returns false", Vec2{0, 0}, Vec2{100, 100}, false},
		{"horizontal segment too short (before rect)", Vec2{0, 40}, Vec2{5, 40}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := EdgeCrossesRect(tc.a, tc.b, r); got != tc.want {
				t.Errorf("EdgeCrossesRect(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════
// nearestPointOnSegment — projection + clamping + degenerate
// ═══════════════════════════════════════════════════════════════

func TestNearestPointOnSegment(t *testing.T) {
	// Projects onto middle
	np := nearestPointOnSegment(Vec2{5, 10}, Vec2{0, 0}, Vec2{10, 0})
	if !approxEqual(np.X, 5, tolerance) || !approxEqual(np.Y, 0, tolerance) {
		t.Errorf("projection = %v, want ~(5,0)", np)
	}
	// Before segment → clamps to A
	np = nearestPointOnSegment(Vec2{-5, 0}, Vec2{0, 0}, Vec2{10, 0})
	if !approxEqual(np.X, 0, tolerance) {
		t.Errorf("clamp to A = %v, want X≈0", np)
	}
	// Degenerate (A==B) → returns A
	np = nearestPointOnSegment(Vec2{5, 5}, Vec2{3, 3}, Vec2{3, 3})
	if np.X != 3 || np.Y != 3 {
		t.Errorf("degenerate = %v, want (3,3)", np)
	}
}

// ═══════════════════════════════════════════════════════════════
// Geometry2d contract — all implementations share invariants
// ═══════════════════════════════════════════════════════════════

func TestAllGeometries_CenterIsInside(t *testing.T) {
	geometries := []struct {
		name string
		g    Geometry2d
	}{
		{"rect", NewRectGeometry(100, 50)},
		{"ellipse", NewEllipseGeometry(100, 80)},
		{"diamond", NewDiamondGeometry(100, 80)},
	}
	for _, tc := range geometries {
		t.Run(tc.name, func(t *testing.T) {
			c := tc.g.Center()
			if !tc.g.HitTestPoint(c) {
				t.Error("center should be inside shape")
			}
		})
	}
}
