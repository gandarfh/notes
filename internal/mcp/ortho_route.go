package mcpserver

import (
	"math"
	"notes/internal/domain"
	"notes/internal/plugins/drawing"
)

// ═══════════════════════════════════════════════════════════════
// Orthogonal Arrow Routing — thin wrapper over pkg/drawing
// ═══════════════════════════════════════════════════════════════

const arrowGap = drawing.ArrowGap
const minArrowDist = 60.0

// point is kept for backward compatibility with tools_drawing.go routeCandidate.
type point struct{ x, y float64 }

// computeOrthoRoute delegates to pkg/drawing.ComputeOrthoRoute.
func computeOrthoRoute(dx, dy float64, srcSide, dstSide string, srcRect, dstRect *rect, shapeObstacles, arrowObstacles []rect) [][]float64 {
	opts := drawing.RouteOpts{
		StartSide: srcSide,
		EndSide:   dstSide,
	}
	if srcRect != nil {
		r := drawing.Rect{X: srcRect.x, Y: srcRect.y, W: srcRect.w, H: srcRect.h}
		opts.StartRect = &r
	}
	if dstRect != nil {
		r := drawing.Rect{X: dstRect.x, Y: dstRect.y, W: dstRect.w, H: dstRect.h}
		opts.EndRect = &r
	}
	for _, o := range shapeObstacles {
		opts.ShapeObstacles = append(opts.ShapeObstacles, drawing.Rect{X: o.x, Y: o.y, W: o.w, H: o.h})
	}
	for _, o := range arrowObstacles {
		opts.ArrowObstacles = append(opts.ArrowObstacles, drawing.Rect{X: o.x, Y: o.y, W: o.w, H: o.h})
	}
	return drawing.ComputeOrthoRoute(dx, dy, opts)
}

// binarySubdivisionT delegates to pkg/drawing.BinarySubdivisionT.
func binarySubdivisionT(index int) float64 {
	return drawing.BinarySubdivisionT(index)
}

// ── MCP-specific helpers using domain types ──

// connectSlot computes the `t` parameter for a new arrow connecting
// to the given element on the given side.
func connectSlot(elements []domain.DrawingElement, elementID, side string) float64 {
	count := 0
	for _, el := range elements {
		if !el.IsArrowElement() {
			continue
		}
		if sc := el.StartConnection; sc != nil {
			if sc.ElementID == elementID && sc.Side == side {
				count++
			}
		}
		if ec := el.EndConnection; ec != nil {
			if ec.ElementID == elementID && ec.Side == side {
				count++
			}
		}
	}
	return binarySubdivisionT(count)
}

// collectObstacleRects returns bounding boxes for all non-arrow, non-group elements,
// converting from world coordinates to arrow-local coordinates.
func collectObstacleRects(elements []domain.DrawingElement, excludeIDs map[string]bool, originX, originY float64) []rect {
	var rects []rect
	for _, el := range elements {
		if el.IsArrowElement() || el.IsGroupElement() {
			continue
		}
		if excludeIDs[el.ID] {
			continue
		}
		rects = append(rects, rect{el.X - originX, el.Y - originY, el.Width, el.Height})
	}
	return rects
}

// elementRect finds the bounding box of an element by ID.
func elementRect(elements []domain.DrawingElement, id string) *rect {
	for _, el := range elements {
		if el.ID == id {
			return &rect{el.X, el.Y, el.Width, el.Height}
		}
	}
	return nil
}

// collectArrowObstacleRects extracts thin rectangles from existing arrow paths.
func collectArrowObstacleRects(elements []domain.DrawingElement, excludeIDs map[string]bool, originX, originY float64) []rect {
	var rects []rect
	for _, el := range elements {
		if !el.IsArrowElement() {
			continue
		}
		if excludeIDs[el.ID] {
			continue
		}
		if len(el.Points) < 2 {
			continue
		}

		type pt struct{ x, y float64 }
		pts := make([]pt, 0, len(el.Points))
		for _, p := range el.Points {
			if len(p) >= 2 {
				pts = append(pts, pt{p[0] + el.X - originX, p[1] + el.Y - originY})
			}
		}

		for i := 0; i < len(pts)-1; i++ {
			p1, p2 := pts[i], pts[i+1]
			segLen := math.Abs(p2.x-p1.x) + math.Abs(p2.y-p1.y)
			if segLen < 5 {
				continue
			}
			if math.Abs(p1.y-p2.y) < 1 {
				minX := min(p1.x, p2.x)
				rects = append(rects, rect{minX, p1.y - arrowGap/2, math.Abs(p2.x - p1.x), arrowGap})
			} else if math.Abs(p1.x-p2.x) < 1 {
				minY := min(p1.y, p2.y)
				rects = append(rects, rect{p1.x - arrowGap/2, minY, arrowGap, math.Abs(p2.y - p1.y)})
			}
		}
	}
	return rects
}

// computeArrowInfo computes the best connection sides and anchor points for an arrow
// between two elements. Returns source/target world coordinates and sides.
type arrowInfo struct {
	srcX, srcY float64
	dstX, dstY float64
	srcSide    string
	dstSide    string
}

func computeArrowInfo(elements []domain.DrawingElement, fromID, toID string) arrowInfo {
	var srcEl, dstEl *domain.DrawingElement
	for i := range elements {
		if elements[i].ID == fromID {
			srcEl = &elements[i]
		}
		if elements[i].ID == toID {
			dstEl = &elements[i]
		}
	}

	if srcEl == nil || dstEl == nil {
		return arrowInfo{}
	}

	srcCX, srcCY := srcEl.CenterX(), srcEl.CenterY()
	dstCX, dstCY := dstEl.CenterX(), dstEl.CenterY()
	dx := dstCX - srcCX
	dy := dstCY - srcCY

	var info arrowInfo
	if math.Abs(dy) > math.Abs(dx) {
		if dy > 0 {
			info.srcSide = "bottom"
			info.dstSide = "top"
			info.srcX = srcEl.CenterX()
			info.srcY = srcEl.Y + srcEl.Height
			info.dstX = dstEl.CenterX()
			info.dstY = dstEl.Y
		} else {
			info.srcSide = "top"
			info.dstSide = "bottom"
			info.srcX = srcEl.CenterX()
			info.srcY = srcEl.Y
			info.dstX = dstEl.CenterX()
			info.dstY = dstEl.Y + dstEl.Height
		}
	} else {
		if dx > 0 {
			info.srcSide = "right"
			info.dstSide = "left"
			info.srcX = srcEl.X + srcEl.Width
			info.srcY = srcEl.CenterY()
			info.dstX = dstEl.X
			info.dstY = dstEl.CenterY()
		} else {
			info.srcSide = "left"
			info.dstSide = "right"
			info.srcX = srcEl.X
			info.srcY = srcEl.CenterY()
			info.dstX = dstEl.X + dstEl.Width
			info.dstY = dstEl.CenterY()
		}
	}
	return info
}
