package drawing

import (
	"testing"
)

func TestStageAntennas(t *testing.T) {
	tests := []struct {
		name      string
		startSide string
		endSide   string
		dest      Vec2
		wantAnt0  Vec2
		wantAnt1  Vec2
	}{
		{
			name:      "right to left",
			startSide: "right", endSide: "left",
			dest:     Vec2{200, 0},
			wantAnt0: Vec2{RouteMargin, 0},
			wantAnt1: Vec2{200 - RouteMargin, 0},
		},
		{
			name:      "bottom to top",
			startSide: "bottom", endSide: "top",
			dest:     Vec2{0, 150},
			wantAnt0: Vec2{0, RouteMargin},
			wantAnt1: Vec2{0, 150 - RouteMargin},
		},
		{
			name:      "left to right",
			startSide: "left", endSide: "right",
			dest:     Vec2{-200, 50},
			wantAnt0: Vec2{-RouteMargin, 0},
			wantAnt1: Vec2{-200 + RouteMargin, 50},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := &RoutePlan{
				Dest:   tc.dest,
				Opts:   RouteOpts{StartSide: tc.startSide, EndSide: tc.endSide},
				Margin: RouteMargin,
			}
			StageAntennas(p)
			if p.Antennas[0] != tc.wantAnt0 {
				t.Errorf("antenna[0] = %v, want %v", p.Antennas[0], tc.wantAnt0)
			}
			if p.Antennas[1] != tc.wantAnt1 {
				t.Errorf("antenna[1] = %v, want %v", p.Antennas[1], tc.wantAnt1)
			}
		})
	}
}

func TestStageExpandObstacles(t *testing.T) {
	startRect := Rect{X: -50, Y: -20, W: 100, H: 40}
	endRect := Rect{X: 150, Y: -20, W: 100, H: 40}

	p := &RoutePlan{
		Opts:   RouteOpts{StartRect: &startRect, EndRect: &endRect},
		Margin: RouteMargin,
	}
	StageExpandObstacles(p)

	if len(p.Obstacles) != 2 {
		t.Fatalf("expected 2 obstacles, got %d", len(p.Obstacles))
	}
	if len(p.OriginalRects) != 2 {
		t.Fatalf("expected 2 original rects, got %d", len(p.OriginalRects))
	}

	// Inflated rect should be larger by Margin on each side
	inflated := p.Obstacles[0]
	if inflated.X != startRect.X-RouteMargin || inflated.W != startRect.W+RouteMargin*2 {
		t.Errorf("inflated X/W = %.0f/%.0f, want %.0f/%.0f",
			inflated.X, inflated.W, startRect.X-RouteMargin, startRect.W+RouteMargin*2)
	}

	// Original rects should be unchanged
	if p.OriginalRects[0] != startRect {
		t.Errorf("original rect[0] = %v, want %v", p.OriginalRects[0], startRect)
	}
}

func TestStageFilterSpots(t *testing.T) {
	rect := Rect{X: 0, Y: 0, W: 100, H: 100}
	ant1 := Vec2{50, 50} // inside rect but is antenna — should be kept
	ant2 := Vec2{200, 200}

	p := &RoutePlan{
		Antennas:      [2]Vec2{ant1, ant2},
		OriginalRects: []Rect{rect},
		Spots: []Vec2{
			{50, 50},   // inside rect, but is ant1 → keep
			{25, 25},   // inside rect → remove
			{-10, -10}, // outside → keep
			{200, 200}, // ant2 → keep
			{150, 150}, // outside → keep
			{150, 150}, // duplicate → remove
		},
	}
	StageFilterSpots(p)

	// Should keep: ant1, outside, ant2, 150,150 = 4
	if len(p.Spots) != 4 {
		t.Errorf("expected 4 spots, got %d: %v", len(p.Spots), p.Spots)
	}
}

func TestStageSimplify(t *testing.T) {
	p := &RoutePlan{
		Origin: Vec2{0, 0},
		Dest:   Vec2{200, 100},
		Path: []Vec2{
			{0, 0},     // same as origin → dedup
			{100, 0},   // keep (turn point)
			{100, 50},  // collinear with prev and next → remove
			{100, 100}, // keep (turn point)
		},
	}
	StageSimplify(p)

	if len(p.Result) < 3 {
		t.Fatalf("expected at least 3 points, got %d: %v", len(p.Result), p.Result)
	}

	// First should be origin, last should be dest
	if p.Result[0][0] != 0 || p.Result[0][1] != 0 {
		t.Errorf("first point = %v, want [0 0]", p.Result[0])
	}
	last := p.Result[len(p.Result)-1]
	if last[0] != 200 || last[1] != 100 {
		t.Errorf("last point = %v, want [200 100]", last)
	}
}
