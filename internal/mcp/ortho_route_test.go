package mcpserver

import (
	"notes/internal/domain"
	"testing"
)

func TestConnectSlot_Distribution(t *testing.T) {
	shape := domain.DrawingElement{ID: "s1", Type: domain.DrawingTypeRectangle}

	// No existing arrows → first slot (index 0)
	t0 := connectSlot([]domain.DrawingElement{shape}, "s1", "right")

	// One arrow already on right side → second slot (index 1)
	arrow1 := domain.DrawingElement{
		Type: domain.DrawingTypeOrtho,
		StartConnection: &domain.DrawingConnection{
			ElementID: "s1",
			Side:      "right",
		},
	}
	t1 := connectSlot([]domain.DrawingElement{shape, arrow1}, "s1", "right")

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
	shape := domain.DrawingElement{ID: "s1", Type: domain.DrawingTypeRectangle}
	// Arrow starting from s1.right
	a1 := domain.DrawingElement{
		Type:            domain.DrawingTypeOrtho,
		StartConnection: &domain.DrawingConnection{ElementID: "s1", Side: "right"},
	}
	// Arrow ending at s1.right
	a2 := domain.DrawingElement{
		Type:          domain.DrawingTypeOrtho,
		EndConnection: &domain.DrawingConnection{ElementID: "s1", Side: "right"},
	}

	// Both arrows connect to s1.right → count=2, next slot=index 2
	tVal := connectSlot([]domain.DrawingElement{shape, a1, a2}, "s1", "right")

	// Should return BinarySubdivisionT(2), different from index 0 and 1
	t0 := connectSlot([]domain.DrawingElement{shape}, "s1", "right")
	if tVal == t0 {
		t.Error("slot with 2 existing should differ from slot with 0")
	}
}

func TestCollectObstacleRects(t *testing.T) {
	elements := []domain.DrawingElement{
		{ID: "s1", Type: domain.DrawingTypeRectangle, X: 100, Y: 100, Width: 200, Height: 150},
		{ID: "s2", Type: domain.DrawingTypeEllipse, X: 400, Y: 100, Width: 100, Height: 100},
		{ID: "a1", Type: domain.DrawingTypeOrtho},  // arrows are skipped
		{ID: "g1", Type: domain.DrawingTypeGroup},   // groups are skipped
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
	elements := []domain.DrawingElement{
		{ID: "s1", Type: domain.DrawingTypeRectangle, X: 300, Y: 200, Width: 100, Height: 50},
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
	elements := []domain.DrawingElement{
		{ID: "s1", Type: domain.DrawingTypeRectangle, X: 300, Y: 200, Width: 100, Height: 50},
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
	elements := []domain.DrawingElement{
		{ID: "s1", Type: domain.DrawingTypeRectangle, X: 10, Y: 20, Width: 100, Height: 50},
		{ID: "s2", Type: domain.DrawingTypeEllipse, X: 200, Y: 300, Width: 80, Height: 60},
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
	elements := []domain.DrawingElement{
		{
			ID:   "a1",
			Type: domain.DrawingTypeOrtho,
			X:    0, Y: 0,
			Points: [][]float64{
				{0, 0},
				{100, 0},   // horizontal segment, length=100
				{100, 100}, // vertical segment, length=100
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
	elements := []domain.DrawingElement{
		{
			ID:   "a1",
			Type: domain.DrawingTypeOrtho,
			X:    0, Y: 0,
			Points: [][]float64{
				{0, 0},
				{100, 0},
			},
		},
	}

	rects := collectArrowObstacleRects(elements, map[string]bool{"a1": true}, 0, 0)
	if len(rects) != 0 {
		t.Errorf("excluded arrow should produce no rects, got %d", len(rects))
	}
}

func TestComputeArrowInfo_HorizontalRight(t *testing.T) {
	elements := []domain.DrawingElement{
		{ID: "a", X: 0, Y: 0, Width: 100, Height: 100},
		{ID: "b", X: 300, Y: 0, Width: 100, Height: 100},
	}

	info := computeArrowInfo(elements, "a", "b")
	if info.srcSide != "right" {
		t.Errorf("srcSide = %q, want right", info.srcSide)
	}
	if info.dstSide != "left" {
		t.Errorf("dstSide = %q, want left", info.dstSide)
	}
	if info.srcX != 100 {
		t.Errorf("srcX = %v, want 100 (right edge of A)", info.srcX)
	}
	if info.dstX != 300 {
		t.Errorf("dstX = %v, want 300 (left edge of B)", info.dstX)
	}
}

func TestComputeArrowInfo_VerticalDown(t *testing.T) {
	elements := []domain.DrawingElement{
		{ID: "a", X: 0, Y: 0, Width: 100, Height: 50},
		{ID: "b", X: 0, Y: 300, Width: 100, Height: 50},
	}

	info := computeArrowInfo(elements, "a", "b")
	if info.srcSide != "bottom" {
		t.Errorf("srcSide = %q, want bottom", info.srcSide)
	}
	if info.dstSide != "top" {
		t.Errorf("dstSide = %q, want top", info.dstSide)
	}
}

func TestComputeArrowInfo_VerticalUp(t *testing.T) {
	elements := []domain.DrawingElement{
		{ID: "a", X: 0, Y: 300, Width: 100, Height: 50},
		{ID: "b", X: 0, Y: 0, Width: 100, Height: 50},
	}

	info := computeArrowInfo(elements, "a", "b")
	if info.srcSide != "top" {
		t.Errorf("srcSide = %q, want top", info.srcSide)
	}
	if info.dstSide != "bottom" {
		t.Errorf("dstSide = %q, want bottom", info.dstSide)
	}
}

func TestComputeArrowInfo_HorizontalLeft(t *testing.T) {
	elements := []domain.DrawingElement{
		{ID: "a", X: 300, Y: 0, Width: 100, Height: 100},
		{ID: "b", X: 0, Y: 0, Width: 100, Height: 100},
	}

	info := computeArrowInfo(elements, "a", "b")
	if info.srcSide != "left" {
		t.Errorf("srcSide = %q, want left", info.srcSide)
	}
	if info.dstSide != "right" {
		t.Errorf("dstSide = %q, want right", info.dstSide)
	}
}

func TestComputeArrowInfo_NotFound(t *testing.T) {
	elements := []domain.DrawingElement{
		{ID: "a", X: 0, Y: 0, Width: 100, Height: 100},
	}

	info := computeArrowInfo(elements, "a", "missing")
	if info.srcSide != "" || info.dstSide != "" {
		t.Errorf("missing element should return empty arrowInfo, got srcSide=%q dstSide=%q", info.srcSide, info.dstSide)
	}
}
