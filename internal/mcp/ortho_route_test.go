package mcpserver

import (
	"testing"
)

func TestIsArrow(t *testing.T) {
	tests := []struct {
		el   drawingElement
		want bool
	}{
		{drawingElement{"type": "ortho-arrow"}, true},
		{drawingElement{"type": "arrow"}, true},
		{drawingElement{"type": "rectangle"}, false},
		{drawingElement{"type": "text"}, false},
		{drawingElement{}, false}, // no type field
	}
	for _, tc := range tests {
		if got := isArrow(tc.el); got != tc.want {
			t.Errorf("isArrow(%v) = %v, want %v", tc.el["type"], got, tc.want)
		}
	}
}

func TestIsGroup(t *testing.T) {
	tests := []struct {
		el   drawingElement
		want bool
	}{
		{drawingElement{"type": "group"}, true},
		{drawingElement{"type": "rectangle", "isGroup": true}, true},
		{drawingElement{"type": "rectangle"}, false},
		{drawingElement{"type": "rectangle", "isGroup": false}, false},
	}
	for _, tc := range tests {
		if got := isGroup(tc.el); got != tc.want {
			t.Errorf("isGroup(%v) = %v, want %v", tc.el, got, tc.want)
		}
	}
}

func TestConnectSlot_Distribution(t *testing.T) {
	shape := drawingElement{"id": "s1", "type": "rectangle"}

	// No existing arrows → first slot (index 0)
	t0 := connectSlot([]drawingElement{shape}, "s1", "right")

	// One arrow already on right side → second slot (index 1)
	arrow1 := drawingElement{
		"type": "ortho-arrow",
		"startConnection": map[string]any{
			"elementId": "s1",
			"side":      "right",
		},
	}
	t1 := connectSlot([]drawingElement{shape, arrow1}, "s1", "right")

	// t values should be different (BinarySubdivisionT distributes them)
	if t0 == t1 {
		t.Errorf("same t for 0 and 1 arrows: %v", t0)
	}

	// Both should be in valid range [0.1, 0.9]
	if t0 < 0.1 || t0 > 0.9 {
		t.Errorf("t0 = %v, out of [0.1, 0.9]", t0)
	}
	if t1 < 0.1 || t1 > 0.9 {
		t.Errorf("t1 = %v, out of [0.1, 0.9]", t1)
	}
}

func TestConnectSlot_CountsBothEnds(t *testing.T) {
	shape := drawingElement{"id": "s1", "type": "rectangle"}
	// Arrow starting from s1.right
	a1 := drawingElement{
		"type":            "ortho-arrow",
		"startConnection": map[string]any{"elementId": "s1", "side": "right"},
	}
	// Arrow ending at s1.right
	a2 := drawingElement{
		"type":          "ortho-arrow",
		"endConnection": map[string]any{"elementId": "s1", "side": "right"},
	}

	// Both arrows connect to s1.right → count=2, next slot=index 2
	tVal := connectSlot([]drawingElement{shape, a1, a2}, "s1", "right")

	// Should return BinarySubdivisionT(2), different from index 0 and 1
	t0 := connectSlot([]drawingElement{shape}, "s1", "right")
	if tVal == t0 {
		t.Error("slot with 2 existing should differ from slot with 0")
	}
}

func TestCollectObstacleRects(t *testing.T) {
	elements := []drawingElement{
		{"id": "s1", "type": "rectangle", "x": 100.0, "y": 100.0, "width": 200.0, "height": 150.0},
		{"id": "s2", "type": "ellipse", "x": 400.0, "y": 100.0, "width": 100.0, "height": 100.0},
		{"id": "a1", "type": "ortho-arrow"}, // arrows are skipped
		{"id": "g1", "type": "group"},        // groups are skipped
	}

	// Exclude s1 (source), origin at (0,0)
	rects := collectObstacleRects(elements, map[string]bool{"s1": true}, 0, 0)

	// Should only contain s2
	if len(rects) != 1 {
		t.Fatalf("len = %d, want 1 (only s2)", len(rects))
	}
	if rects[0].x != 400 || rects[0].w != 100 {
		t.Errorf("s2 rect = %+v, want x=400, w=100", rects[0])
	}
}

func TestCollectObstacleRects_LocalCoords(t *testing.T) {
	elements := []drawingElement{
		{"id": "s1", "type": "rectangle", "x": 300.0, "y": 200.0, "width": 100.0, "height": 50.0},
	}

	// Origin at (100, 100) → s1 should be at (200, 100) in local coords
	rects := collectObstacleRects(elements, nil, 100, 100)
	if len(rects) != 1 {
		t.Fatal("expected 1 rect")
	}
	if rects[0].x != 200 || rects[0].y != 100 {
		t.Errorf("local coords = (%v, %v), want (200, 100)", rects[0].x, rects[0].y)
	}
}

func TestCollectObstacleRects_ZeroOriginIsWorldCoords(t *testing.T) {
	elements := []drawingElement{
		{"id": "s1", "type": "rectangle", "x": 300.0, "y": 200.0, "width": 100.0, "height": 50.0},
	}

	// Origin (0,0) = world coordinates (no subtraction)
	rects := collectObstacleRects(elements, nil, 0, 0)
	if len(rects) != 1 {
		t.Fatal("expected 1 rect")
	}
	if rects[0].x != 300 || rects[0].y != 200 {
		t.Errorf("world coords = (%v, %v), want (300, 200)", rects[0].x, rects[0].y)
	}
}

func TestElementRect(t *testing.T) {
	elements := []drawingElement{
		{"id": "s1", "type": "rectangle", "x": 10.0, "y": 20.0, "width": 100.0, "height": 50.0},
		{"id": "s2", "type": "ellipse", "x": 200.0, "y": 300.0, "width": 80.0, "height": 60.0},
	}

	r := elementRect(elements, "s1")
	if r == nil {
		t.Fatal("s1 not found")
	}
	if r.x != 10 || r.y != 20 || r.w != 100 || r.h != 50 {
		t.Errorf("s1 rect = %+v", r)
	}

	// Not found
	if elementRect(elements, "nonexistent") != nil {
		t.Error("nonexistent should return nil")
	}
}

func TestCollectArrowObstacleRects_ExtractsSegments(t *testing.T) {
	elements := []drawingElement{
		{
			"id":   "a1",
			"type": "ortho-arrow",
			"x":    0.0,
			"y":    0.0,
			"points": []any{
				[]any{0.0, 0.0},
				[]any{100.0, 0.0}, // horizontal segment, length=100
				[]any{100.0, 100.0}, // vertical segment, length=100
			},
		},
	}

	rects := collectArrowObstacleRects(elements, nil, 0, 0)

	// Should produce 2 rects (one horizontal, one vertical)
	if len(rects) < 2 {
		t.Fatalf("len = %d, want >= 2", len(rects))
	}
}

func TestCollectArrowObstacleRects_ExcludesID(t *testing.T) {
	elements := []drawingElement{
		{
			"id":   "a1",
			"type": "ortho-arrow",
			"x":    0.0,
			"y":    0.0,
			"points": []any{
				[]any{0.0, 0.0},
				[]any{100.0, 0.0},
			},
		},
	}

	rects := collectArrowObstacleRects(elements, map[string]bool{"a1": true}, 0, 0)
	if len(rects) != 0 {
		t.Errorf("excluded arrow should produce no rects, got %d", len(rects))
	}
}
