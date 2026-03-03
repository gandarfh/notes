package mcpserver

import (
	"testing"

	"notes/internal/domain"
)

func TestNextPosition_EmptyCanvas(t *testing.T) {
	le := NewLayoutEngine()
	x, y := le.NextPosition(nil, 480, 360)
	if x != 0 || y != 0 {
		t.Errorf("expected (0, 0) for empty canvas, got (%.0f, %.0f)", x, y)
	}
}

func TestNextPosition_AvoidsExistingBlock(t *testing.T) {
	le := NewLayoutEngine()
	existing := []domain.Block{
		{X: 0, Y: 0, Width: 480, Height: 360},
	}
	x, y := le.NextPosition(existing, 480, 360)

	// Should not overlap the existing block (including padding)
	if x < 480+Padding || y < 0 {
		// It placed to the right or below — both are valid
		if x == 0 && y < 360+Padding {
			t.Errorf("position (%.0f, %.0f) overlaps existing block", x, y)
		}
	}
}

func TestNextPosition_MultipleBlocks(t *testing.T) {
	le := NewLayoutEngine()
	existing := []domain.Block{
		{X: 0, Y: 0, Width: 480, Height: 360},
		{X: 540, Y: 0, Width: 480, Height: 360},
	}
	x, y := le.NextPosition(existing, 480, 360)

	// Should find a position that doesn't overlap either block
	for _, b := range existing {
		r := rect{x, y, 480, 360}
		padded := rect{b.X - Padding, b.Y - Padding, b.Width + Padding*2, b.Height + Padding*2}
		if r.intersects(padded) {
			t.Errorf("position (%.0f, %.0f) overlaps block at (%.0f, %.0f)", x, y, b.X, b.Y)
		}
	}
}

func TestArrangeGroup(t *testing.T) {
	le := NewLayoutEngine()
	blocks := []domain.Block{
		{ID: "1", Width: 300, Height: 200},
		{ID: "2", Width: 300, Height: 200},
		{ID: "3", Width: 300, Height: 200},
	}

	arranged := le.ArrangeGroup(blocks, 0, 0)

	if len(arranged) != 3 {
		t.Fatalf("expected 3 blocks, got %d", len(arranged))
	}

	// No overlaps
	for i := range len(arranged) {
		for j := i + 1; j < len(arranged); j++ {
			a := rect{arranged[i].X, arranged[i].Y, arranged[i].Width, arranged[i].Height}
			b := rect{arranged[j].X, arranged[j].Y, arranged[j].Width, arranged[j].Height}
			if a.intersects(b) {
				t.Errorf("blocks %d and %d overlap: (%.0f,%.0f) and (%.0f,%.0f)",
					i, j, a.x, a.y, b.x, b.y)
			}
		}
	}
}

func TestArrangeGroup_RowWrapping(t *testing.T) {
	le := NewLayoutEngine()
	// 4 blocks of 600px width each. MaxRowW=1800, so after 2 blocks (~1260px with padding)
	// the 3rd block would exceed 1800, so it should wrap to the next row.
	blocks := []domain.Block{
		{ID: "1", Width: 600, Height: 200},
		{ID: "2", Width: 600, Height: 200},
		{ID: "3", Width: 600, Height: 300}, // taller block
		{ID: "4", Width: 600, Height: 200},
	}

	arranged := le.ArrangeGroup(blocks, 0, 0)

	// First row: block 1 and 2 side by side
	if arranged[0].Y != arranged[1].Y {
		t.Error("blocks 1 and 2 should be on the same row")
	}

	// At least one block should have a different Y (wrapped row)
	hasWrap := false
	for i := 1; i < len(arranged); i++ {
		if arranged[i].Y > arranged[0].Y {
			hasWrap = true
			break
		}
	}
	if !hasWrap {
		t.Error("expected row wrapping for wide blocks")
	}
}

func TestNextPosition_SnapsToGrid(t *testing.T) {
	le := NewLayoutEngine()
	existing := []domain.Block{
		{X: 0, Y: 0, Width: 100, Height: 100},
	}
	x, y := le.NextPosition(existing, 100, 100)

	// Position should be snapped to grid (multiples of GridSize=30)
	xMod := int(x) % int(GridSize)
	yMod := int(y) % int(GridSize)
	if xMod != 0 || yMod != 0 {
		t.Errorf("position (%.0f, %.0f) not snapped to grid (%v)", x, y, GridSize)
	}
}

func TestSnap(t *testing.T) {
	le := NewLayoutEngine()
	tests := []struct {
		input, want float64
	}{
		{0, 0},
		{15, 30},
		{29, 30},
		{30, 30},
		{45, 60},
		{100, 90}, // rounds to nearest grid: 3*30=90
	}
	for _, tt := range tests {
		got := le.snap(tt.input)
		if got != tt.want {
			t.Errorf("snap(%.0f) = %.0f, want %.0f", tt.input, got, tt.want)
		}
	}
}
