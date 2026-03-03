package drawing

import (
	"math"
	"testing"
)

// ═══════════════════════════════════════════════════════════════
// sr (seeded random) — determinism is critical for rendering
// ═══════════════════════════════════════════════════════════════

func TestSr_Deterministic(t *testing.T) {
	a := sr(1, 2, 3)
	b := sr(1, 2, 3)
	if a != b {
		t.Errorf("sr not deterministic: %v != %v", a, b)
	}
}

func TestSr_Range(t *testing.T) {
	for i := range 100 {
		v := sr(float64(i)*12.3, float64(i)*45.6, i)
		if v < 0 || v >= 1 {
			t.Errorf("sr(%d) = %v, out of [0,1)", i, v)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// SketchLinePaths — used for arrow line rendering
// ═══════════════════════════════════════════════════════════════

func TestSketchLinePaths_Structure(t *testing.T) {
	// Single segment → 2 passes (main + shadow)
	paths := SketchLinePaths([][2]float64{{0, 0}, {100, 0}}, 42, 2)
	if len(paths) != 2 {
		t.Fatalf("single segment: len = %d, want 2", len(paths))
	}
	// Each pass: MoveTo + CurveTo
	for i, p := range paths {
		if p.Cmds[0].Op != OpMoveTo || p.Cmds[1].Op != OpCurveTo {
			t.Errorf("pass[%d] should be MoveTo+CurveTo", i)
		}
	}

	// 3 segments → 6 passes
	paths = SketchLinePaths([][2]float64{{0, 0}, {100, 0}, {100, 100}, {0, 100}}, 42, 2)
	if len(paths) != 6 {
		t.Errorf("3 segments: len = %d, want 6", len(paths))
	}
}

func TestSketchLinePaths_EdgeCases(t *testing.T) {
	if SketchLinePaths(nil, 42, 2) != nil {
		t.Error("nil should return nil")
	}
	if SketchLinePaths([][2]float64{{0, 0}}, 42, 2) != nil {
		t.Error("single point should return nil")
	}
}

func TestSketchLinePaths_Deterministic(t *testing.T) {
	pts := [][2]float64{{0, 0}, {100, 50}}
	a := SketchLinePaths(pts, 42, 2)
	b := SketchLinePaths(pts, 42, 2)
	for i := range a {
		if a[i].Opacity != b[i].Opacity {
			t.Errorf("path[%d] opacity differs with same seed", i)
		}
	}
	// Different seed → different result
	c := SketchLinePaths(pts, 99, 2)
	if a[0].Opacity == c[0].Opacity && a[0].StrokeWidth == c[0].StrokeWidth {
		t.Error("different seeds should produce different paths")
	}
}

// ═══════════════════════════════════════════════════════════════
// sketchLine — zero-length + 2-pass opacity behavior
// ═══════════════════════════════════════════════════════════════

func TestSketchLine_ZeroLength(t *testing.T) {
	path := sketchLine(50, 50, 50, 50, 2, 42, 0, 6)
	if path.Opacity != 0 {
		t.Errorf("zero-length should have opacity 0, got %v", path.Opacity)
	}
}

func TestSketchLine_MainVsShadowOpacity(t *testing.T) {
	main := sketchLine(0, 0, 100, 0, 2, 42, 0, 6)
	shadow := sketchLine(0, 0, 100, 0, 2, 42, 1, 6)
	if main.Opacity < shadow.Opacity {
		t.Errorf("main opacity (%v) should be > shadow opacity (%v)", main.Opacity, shadow.Opacity)
	}
}

// ═══════════════════════════════════════════════════════════════
// sketchFromPathCmds — only processes LineTo
// ═══════════════════════════════════════════════════════════════

func TestSketchFromPathCmds_Empty(t *testing.T) {
	if sketchFromPathCmds(nil, 2, 42) != nil {
		t.Error("nil cmds should return nil")
	}
}

func TestSketchFromPathCmds_Triangle(t *testing.T) {
	cmds := []PathCmd{
		{Op: OpMoveTo, Args: []float64{50, 0}},
		{Op: OpLineTo, Args: []float64{100, 100}},
		{Op: OpLineTo, Args: []float64{0, 100}},
		{Op: OpClose},
	}
	paths := sketchFromPathCmds(cmds, 2, 42)
	// 2 LineTo segments × 2 passes = 4
	if len(paths) != 4 {
		t.Errorf("len = %d, want 4", len(paths))
	}
}

// ═══════════════════════════════════════════════════════════════
// ArrowHeadPaths — 5 styles with distinct geometries
// ═══════════════════════════════════════════════════════════════

func TestArrowHeadPaths_AllStyles(t *testing.T) {
	tests := []struct {
		style  string
		minLen int
	}{
		{"dot", 2},      // 2 circle passes
		{"arrow", 2},    // fill + outline
		{"triangle", 6}, // 3 edges × 2 passes
		{"bar", 2},      // 1 edge × 2 passes
		{"diamond", 4},  // 4 edges × 1 pass each
	}
	for _, tc := range tests {
		t.Run(tc.style, func(t *testing.T) {
			paths := ArrowHeadPaths(tc.style, 0, 0, 0, 10, 42, 2)
			if len(paths) < tc.minLen {
				t.Errorf("len = %d, want >= %d", len(paths), tc.minLen)
			}
		})
	}
}

func TestArrowHeadPaths_UnknownStyle(t *testing.T) {
	if ArrowHeadPaths("unknown", 0, 0, 0, 10, 42, 2) != nil {
		t.Error("unknown style should return nil")
	}
}

func TestArrowDot_IsFilled(t *testing.T) {
	paths := ArrowHeadPaths("dot", 50, 50, 0, 10, 42, 2)
	for i, p := range paths {
		if !p.IsFill {
			t.Errorf("dot pass[%d] should be filled", i)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// SimplifyOrtho — removes collinear waypoints
// ═══════════════════════════════════════════════════════════════

func TestSimplifyOrtho(t *testing.T) {
	// (0,0)→(0,50)→(0,100) collinear, (0,100)→(50,100)→(100,100) collinear
	pts := [][]float64{{0, 0}, {0, 50}, {0, 100}, {50, 100}, {100, 100}}
	result := SimplifyOrtho(pts)
	if len(result) != 3 {
		t.Errorf("len = %d, want 3 (collinears removed): %v", len(result), result)
	}

	// No collinear → unchanged
	pts = [][]float64{{0, 0}, {100, 0}, {100, 100}}
	if len(SimplifyOrtho(pts)) != 3 {
		t.Error("no collinear should keep all 3")
	}

	// Too short → unchanged
	pts = [][]float64{{0, 0}, {100, 0}}
	if len(SimplifyOrtho(pts)) != 2 {
		t.Error("2 points should stay")
	}
}

// ═══════════════════════════════════════════════════════════════
// BinarySubdivisionT — clamping to [0.1, 0.9]
// ═══════════════════════════════════════════════════════════════

func TestBinarySubdivisionT_Clamping(t *testing.T) {
	for i := range 100 {
		v := BinarySubdivisionT(i)
		if v < 0.1 || v > 0.9 {
			t.Errorf("index %d: %v out of [0.1, 0.9]", i, v)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// dedupVec2s — used in route pipeline
// ═══════════════════════════════════════════════════════════════

func TestDedupVec2s(t *testing.T) {
	pts := []Vec2{{0, 0}, {0, 0.1}, {10, 20}, {10, 20}, {30, 40}}
	result := dedupVec2s(pts)
	// (0,0)≈(0,0.1) → 1, (10,20)=(10,20) → 1, (30,40) → 1
	if len(result) != 3 {
		t.Errorf("len = %d, want 3", len(result))
	}
	result = dedupVec2s(nil)
	if len(result) != 0 {
		t.Error("nil should return empty")
	}
}

// ═══════════════════════════════════════════════════════════════
// Route fallback + full pipeline with obstacles
// ═══════════════════════════════════════════════════════════════

func TestLShapeFallback(t *testing.T) {
	// Same X → straight line (2 points)
	if len(lShapeFallback(Vec2{0, 0}, Vec2{0, 100})) != 2 {
		t.Error("same X should be straight")
	}
	// Same Y → straight line
	if len(lShapeFallback(Vec2{0, 0}, Vec2{100, 0})) != 2 {
		t.Error("same Y should be straight")
	}
	// Different X,Y → L-shape (3 points: origin → corner → dest)
	p := lShapeFallback(Vec2{0, 0}, Vec2{100, 50})
	if len(p) != 3 {
		t.Fatalf("L-shape: len = %d, want 3", len(p))
	}
	if p[1].X != 100 || p[1].Y != 0 {
		t.Errorf("L corner = %v, want (100, 0)", p[1])
	}
}

func TestComputeOrthoRoute_AllSideCombinations(t *testing.T) {
	sides := []string{"top", "bottom", "left", "right"}
	for _, src := range sides {
		for _, dst := range sides {
			t.Run(src+"_to_"+dst, func(t *testing.T) {
				pts := ComputeOrthoRoute(200, 150, RouteOpts{StartSide: src, EndSide: dst})
				if len(pts) < 2 {
					t.Fatalf("got %d points", len(pts))
				}
				if pts[0][0] != 0 || pts[0][1] != 0 {
					t.Errorf("start = %v, want [0 0]", pts[0])
				}
				last := pts[len(pts)-1]
				if last[0] != 200 || last[1] != 150 {
					t.Errorf("end = %v, want [200 150]", last)
				}
				// All segments must be orthogonal
				for i := 0; i < len(pts)-1; i++ {
					a, b := pts[i], pts[i+1]
					if math.Abs(a[0]-b[0]) > 0.5 && math.Abs(a[1]-b[1]) > 0.5 {
						t.Errorf("diagonal: %v → %v", a, b)
					}
				}
			})
		}
	}
}

func TestObstacleDetour(t *testing.T) {
	t.Run("vertical", func(t *testing.T) {
		result := obstacleDetour(0, 200, RouteOpts{
			StartSide:      "bottom",
			EndSide:        "top",
			ShapeObstacles: []Rect{{-50, 50, 100, 100}},
		})
		if result == nil || len(result) < 2 {
			t.Fatal("expected detour path")
		}
	})
	t.Run("horizontal", func(t *testing.T) {
		result := obstacleDetour(200, 0, RouteOpts{
			StartSide:      "right",
			EndSide:        "left",
			ShapeObstacles: []Rect{{50, -50, 100, 100}},
		})
		if result == nil || len(result) < 2 {
			t.Fatal("expected detour path")
		}
	})
}

// ═══════════════════════════════════════════════════════════════
// Priority Queue — min-heap correctness
// ═══════════════════════════════════════════════════════════════

func TestPriorityQueue_Ordering(t *testing.T) {
	pq := &priorityQ{}
	dists := []float64{10, 3, 7, 1, 5}
	for _, d := range dists {
		pq.push(&pqItem{&gNode{dist: d}})
	}

	expected := []float64{1, 3, 5, 7, 10}
	for i, want := range expected {
		item := pq.pop()
		if item == nil {
			t.Fatalf("pop[%d] nil", i)
		}
		if item.node.dist != want {
			t.Errorf("pop[%d] = %v, want %v", i, item.node.dist, want)
		}
	}
	if pq.pop() != nil {
		t.Error("empty pop should return nil")
	}
}

// ═══════════════════════════════════════════════════════════════
// buildGraphAndRoute — Dijkstra integration
// ═══════════════════════════════════════════════════════════════

func TestBuildGraphAndRoute_UnblockedGrid(t *testing.T) {
	spots := []Vec2{{0, 0}, {100, 0}, {100, 100}, {0, 100}}
	path := buildGraphAndRoute(spots, Vec2{0, 0}, Vec2{100, 100}, nil, nil)
	if len(path) < 2 {
		t.Fatalf("expected path, got %d points", len(path))
	}
	last := path[len(path)-1]
	if !approxEqual(last.X, 100, 1) || !approxEqual(last.Y, 100, 1) {
		t.Errorf("end = %v, want ~(100,100)", last)
	}
}

func TestBuildGraphAndRoute_WithBlocker(t *testing.T) {
	spots := []Vec2{{0, 0}, {100, 0}, {200, 0}}
	blocker := Rect{80, -10, 40, 20}
	path := buildGraphAndRoute(spots, Vec2{0, 0}, Vec2{200, 0}, []Rect{blocker}, nil)
	// Should still return something (L-shape fallback)
	if len(path) < 2 {
		t.Fatal("should fallback, not return empty")
	}
}
