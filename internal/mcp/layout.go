package mcpserver

import (
	"math"

	"notes/internal/domain"
)

const (
	GridSize = 30.0 // matches frontend GRID_SIZE
	Padding  = 60.0 // 2 grid cells between blocks
	MaxRowW  = 1800.0
)

// LayoutEngine handles automatic placement of blocks on the canvas
// so that MCP-created blocks don't overlap existing ones.
type LayoutEngine struct {
	gridSize float64
	padding  float64
	maxRowW  float64
}

func NewLayoutEngine() *LayoutEngine {
	return &LayoutEngine{
		gridSize: GridSize,
		padding:  Padding,
		maxRowW:  MaxRowW,
	}
}

// snap rounds v to the nearest grid point.
func (le *LayoutEngine) snap(v float64) float64 {
	return math.Round(v/le.gridSize) * le.gridSize
}

// rect is a simple axis-aligned bounding box.
type rect struct {
	x, y, w, h float64
}

func (a rect) intersects(b rect) bool {
	return a.x < b.x+b.w && a.x+a.w > b.x &&
		a.y < b.y+b.h && a.y+a.h > b.y
}

// NextPosition finds the next non-overlapping grid position for a block
// of size (newW, newH) given the existing blocks on the page.
func (le *LayoutEngine) NextPosition(existing []domain.Block, newW, newH float64) (float64, float64) {
	if len(existing) == 0 {
		return 0, 0
	}

	// Build occupancy set from existing blocks
	occupied := make([]rect, len(existing))
	for i, b := range existing {
		occupied[i] = rect{b.X, b.Y, b.Width, b.Height}
	}

	// Scan rows top-to-bottom, columns left-to-right
	candidate := rect{w: newW, h: newH}
	for y := 0.0; y < 100000; y += le.gridSize {
		for x := 0.0; x < le.maxRowW; x += le.gridSize {
			candidate.x = le.snap(x)
			candidate.y = le.snap(y)

			overlaps := false
			for _, occ := range occupied {
				// Add padding around existing blocks
				padded := rect{
					x: occ.x - le.padding,
					y: occ.y - le.padding,
					w: occ.w + le.padding*2,
					h: occ.h + le.padding*2,
				}
				if candidate.intersects(padded) {
					overlaps = true
					break
				}
			}
			if !overlaps {
				return candidate.x, candidate.y
			}
		}
	}

	// Fallback: place below all existing blocks
	maxY := 0.0
	for _, b := range existing {
		if b.Y+b.Height > maxY {
			maxY = b.Y + b.Height
		}
	}
	return 0, le.snap(maxY + le.padding)
}

// ArrangeGroup places a slice of blocks in a grid layout starting from (startX, startY).
// It modifies block positions in-place and returns them.
func (le *LayoutEngine) ArrangeGroup(blocks []domain.Block, startX, startY float64) []domain.Block {
	x := le.snap(startX)
	y := le.snap(startY)
	rowHeight := 0.0

	for i := range blocks {
		blocks[i].X = x
		blocks[i].Y = y

		if blocks[i].Height > rowHeight {
			rowHeight = blocks[i].Height
		}

		x += le.snap(blocks[i].Width + le.padding)

		// Wrap to next row
		if x+blocks[i].Width > le.maxRowW {
			x = le.snap(startX)
			y += le.snap(rowHeight + le.padding)
			rowHeight = 0
		}
	}

	return blocks
}
