package mcpserver

import (
	"strings"
	"testing"
)

// ═══════════════════════════════════════════════════════════════
// sanitizeColor — palette validation with fallback
// ═══════════════════════════════════════════════════════════════

func TestSanitizeColor(t *testing.T) {
	tests := []struct {
		color, fallback, want string
	}{
		// Valid palette colors
		{"#e03131", "#000", "#e03131"},
		{"#a5d8ff", "#000", "#a5d8ff"},
		{"transparent", "#000", "transparent"},
		// Case insensitive
		{"#E03131", "#000", "#E03131"}, // returns original case
		// Invalid → fallback
		{"#xyz123", "#000000", "#000000"},
		{"red", "#000000", "#000000"},
		// Empty → fallback
		{"", "#ffffff", "#ffffff"},
		// Whitespace trimmed
		{" #e03131 ", "#000", " #e03131 "}, // returns original (with spaces) since normalized matches
	}
	for _, tc := range tests {
		got := sanitizeColor(tc.color, tc.fallback)
		if got != tc.want {
			t.Errorf("sanitizeColor(%q, %q) = %q, want %q", tc.color, tc.fallback, got, tc.want)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// genDrawingID — uniqueness
// ═══════════════════════════════════════════════════════════════

func TestGenDrawingID_Unique(t *testing.T) {
	ids := make(map[string]bool)
	for range 100 {
		id := genDrawingID()
		if !strings.HasPrefix(id, "el_") {
			t.Errorf("id %q should start with el_", id)
		}
		if ids[id] {
			t.Fatalf("duplicate id: %s", id)
		}
		ids[id] = true
	}
}

// ═══════════════════════════════════════════════════════════════
// findElement — search by ID
// ═══════════════════════════════════════════════════════════════

func TestFindElement(t *testing.T) {
	elements := []drawingElement{
		{"id": "a", "type": "rect"},
		{"id": "b", "type": "ellipse"},
	}

	idx, el := findElement(elements, "b")
	if idx != 1 || el["type"] != "ellipse" {
		t.Errorf("findElement(b) = (%d, %v), want (1, ellipse)", idx, el)
	}

	idx, el = findElement(elements, "missing")
	if idx != -1 || el != nil {
		t.Error("missing should return -1, nil")
	}

	idx, _ = findElement(nil, "any")
	if idx != -1 {
		t.Error("nil slice should return -1")
	}
}

// ═══════════════════════════════════════════════════════════════
// splitIDs — comma-separated parsing with trimming
// ═══════════════════════════════════════════════════════════════

func TestSplitIDs(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"a,b,c", 3},
		{"", 0},
		{" a , b , c ", 3},
		{"single", 1},
		{"a,,b", 2}, // empty parts skipped
	}
	for _, tc := range tests {
		got := splitIDs(tc.input)
		if len(got) != tc.want {
			t.Errorf("splitIDs(%q) len = %d, want %d: %v", tc.input, len(got), tc.want, got)
		}
	}

	// Verify trimming
	ids := splitIDs(" hello , world ")
	if ids[0] != "hello" || ids[1] != "world" {
		t.Errorf("splitIDs should trim spaces: %v", ids)
	}
}

// ═══════════════════════════════════════════════════════════════
// getFloat — fallback behavior
// ═══════════════════════════════════════════════════════════════

func TestGetFloat(t *testing.T) {
	args := map[string]any{"x": 42.0, "name": "test"}

	if v := getFloat(args, "x", 0); v != 42 {
		t.Errorf("x = %v, want 42", v)
	}
	if v := getFloat(args, "missing", 99); v != 99 {
		t.Errorf("missing = %v, want 99 (fallback)", v)
	}
	if v := getFloat(args, "name", 10); v != 10 {
		t.Errorf("name (string) = %v, want 10 (fallback, wrong type)", v)
	}
}

// ═══════════════════════════════════════════════════════════════
// computeArrowInfo — side selection based on relative position
// ═══════════════════════════════════════════════════════════════

func TestComputeArrowInfo_HorizontalRight(t *testing.T) {
	elements := []drawingElement{
		{"id": "a", "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0},
		{"id": "b", "x": 300.0, "y": 0.0, "width": 100.0, "height": 100.0},
	}

	info := computeArrowInfo(elements, "a", "b")
	if info.srcSide != "right" {
		t.Errorf("srcSide = %q, want right", info.srcSide)
	}
	if info.dstSide != "left" {
		t.Errorf("dstSide = %q, want left", info.dstSide)
	}
	// Source anchor: right edge of A
	if info.srcX != 100 {
		t.Errorf("srcX = %v, want 100 (right edge of A)", info.srcX)
	}
	// Dest anchor: left edge of B
	if info.dstX != 300 {
		t.Errorf("dstX = %v, want 300 (left edge of B)", info.dstX)
	}
}

func TestComputeArrowInfo_VerticalDown(t *testing.T) {
	elements := []drawingElement{
		{"id": "a", "x": 0.0, "y": 0.0, "width": 100.0, "height": 50.0},
		{"id": "b", "x": 0.0, "y": 300.0, "width": 100.0, "height": 50.0},
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
	elements := []drawingElement{
		{"id": "a", "x": 0.0, "y": 300.0, "width": 100.0, "height": 50.0},
		{"id": "b", "x": 0.0, "y": 0.0, "width": 100.0, "height": 50.0},
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
	elements := []drawingElement{
		{"id": "a", "x": 300.0, "y": 0.0, "width": 100.0, "height": 100.0},
		{"id": "b", "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0},
	}

	info := computeArrowInfo(elements, "a", "b")
	if info.srcSide != "left" {
		t.Errorf("srcSide = %q, want left", info.srcSide)
	}
	if info.dstSide != "right" {
		t.Errorf("dstSide = %q, want right", info.dstSide)
	}
}

// ═══════════════════════════════════════════════════════════════
// anchorPoint — edge position by side and t
// ═══════════════════════════════════════════════════════════════

func TestAnchorPoint(t *testing.T) {
	r := rect{10, 20, 100, 50}

	tests := []struct {
		side  string
		t     float64
		wantX float64
		wantY float64
	}{
		{"top", 0.5, 60, 20},      // midpoint of top edge
		{"bottom", 0.5, 60, 70},   // midpoint of bottom edge
		{"left", 0.5, 10, 45},     // midpoint of left edge
		{"right", 0.5, 110, 45},   // midpoint of right edge
		{"top", 0.0, 10, 20},      // start of top edge
		{"top", 1.0, 110, 20},     // end of top edge
		{"unknown", 0.5, 60, 45},  // fallback to center
	}
	for _, tc := range tests {
		x, y := anchorPoint(r, tc.side, tc.t)
		if x != tc.wantX || y != tc.wantY {
			t.Errorf("anchorPoint(%q, %.1f) = (%.1f, %.1f), want (%.1f, %.1f)",
				tc.side, tc.t, x, y, tc.wantX, tc.wantY)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// extractPageIDFromURI — URI parsing
// ═══════════════════════════════════════════════════════════════

func TestExtractPageIDFromURI(t *testing.T) {
	tests := []struct {
		uri  string
		want string
	}{
		{"notes://page/abc-123/blocks", "abc-123"},
		{"notes://page/my-page-id/blocks", "my-page-id"},
		{"notes://page//blocks", ""},          // empty ID
		{"notes://notebooks", ""},              // wrong format
		{"other://page/abc-123/blocks", ""},    // wrong prefix
		{"", ""},
	}
	for _, tc := range tests {
		got := extractPageIDFromURI(tc.uri)
		if got != tc.want {
			t.Errorf("extractPageIDFromURI(%q) = %q, want %q", tc.uri, got, tc.want)
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// boolPtr — simple helper
// ═══════════════════════════════════════════════════════════════

func TestBoolPtr(t *testing.T) {
	p := boolPtr(true)
	if p == nil || !*p {
		t.Error("boolPtr(true) should return *true")
	}
	p = boolPtr(false)
	if p == nil || *p {
		t.Error("boolPtr(false) should return *false")
	}
}

// ═══════════════════════════════════════════════════════════════
// rect.intersects — AABB collision
// ═══════════════════════════════════════════════════════════════

func TestRectIntersects(t *testing.T) {
	a := rect{0, 0, 100, 100}

	if !a.intersects(rect{50, 50, 100, 100}) {
		t.Error("overlapping should intersect")
	}
	if a.intersects(rect{200, 200, 50, 50}) {
		t.Error("separated should not intersect")
	}
	// Touching edges (non-overlapping)
	if a.intersects(rect{100, 0, 50, 50}) {
		t.Error("touching edge should not intersect (strict <)")
	}
}
