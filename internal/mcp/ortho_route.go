package mcpserver

import (
	"notes/internal/plugins/drawing"
)

// ═══════════════════════════════════════════════════════════════
// Orthogonal Arrow Routing — thin wrapper over pkg/drawing
// ═══════════════════════════════════════════════════════════════

const routeMargin = drawing.RouteMargin
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

// simpleOrthoRoute delegates to pkg/drawing.SimpleOrthoRoute.
func simpleOrthoRoute(dx, dy float64, srcSide, dstSide string) [][]float64 {
	return drawing.SimpleOrthoRoute(dx, dy, srcSide, dstSide)
}

// sideDirF delegates to pkg/drawing.SideDir.
func sideDirF(side string) (float64, float64) {
	return drawing.SideDir(side)
}

// simplifyOrtho delegates to pkg/drawing.SimplifyOrtho.
func simplifyOrtho(pts [][]float64) [][]float64 {
	return drawing.SimplifyOrtho(pts)
}

// binarySubdivisionT delegates to pkg/drawing.BinarySubdivisionT.
func binarySubdivisionT(index int) float64 {
	return drawing.BinarySubdivisionT(index)
}

// ── MCP-specific helpers (stay here — they use drawingElement) ──

// connectSlot computes the `t` parameter for a new arrow connecting
// to the given element on the given side.
func connectSlot(elements []drawingElement, elementID, side string) float64 {
	count := 0
	for _, el := range elements {
		if isArrow(el) {
			if sc, ok := el["startConnection"].(map[string]any); ok {
				if sc["elementId"] == elementID && sc["side"] == side {
					count++
				}
			}
			if ec, ok := el["endConnection"].(map[string]any); ok {
				if ec["elementId"] == elementID && ec["side"] == side {
					count++
				}
			}
		}
	}
	return binarySubdivisionT(count)
}

func isArrow(el drawingElement) bool {
	t, _ := el["type"].(string)
	return t == "ortho-arrow" || t == "arrow"
}

func isGroup(el drawingElement) bool {
	t, _ := el["type"].(string)
	if t == "group" {
		return true
	}
	g, _ := el["isGroup"].(bool)
	return g
}

// collectObstacleRects returns bounding boxes for all non-arrow elements,
// converting from world coordinates to arrow-local coordinates.
func collectObstacleRects(elements []drawingElement, excludeIDs map[string]bool, originX, originY float64) []rect {
	var rects []rect
	for _, el := range elements {
		if isArrow(el) || isGroup(el) {
			continue
		}
		id, _ := el["id"].(string)
		if excludeIDs[id] {
			continue
		}
		x, _ := el["x"].(float64)
		y, _ := el["y"].(float64)
		w, _ := el["width"].(float64)
		h, _ := el["height"].(float64)
		rects = append(rects, rect{x - originX, y - originY, w, h})
	}
	return rects
}

// collectWorldObstacleRects returns bounding boxes in world coordinates.
func collectWorldObstacleRects(elements []drawingElement, excludeIDs map[string]bool) []rect {
	var rects []rect
	for _, el := range elements {
		if isArrow(el) || isGroup(el) {
			continue
		}
		id, _ := el["id"].(string)
		if excludeIDs[id] {
			continue
		}
		x, _ := el["x"].(float64)
		y, _ := el["y"].(float64)
		w, _ := el["width"].(float64)
		h, _ := el["height"].(float64)
		rects = append(rects, rect{x, y, w, h})
	}
	return rects
}

// elementRect finds the bounding box of an element by ID.
func elementRect(elements []drawingElement, id string) *rect {
	for _, el := range elements {
		elID, _ := el["id"].(string)
		if elID == id {
			x, _ := el["x"].(float64)
			y, _ := el["y"].(float64)
			w, _ := el["width"].(float64)
			h, _ := el["height"].(float64)
			return &rect{x, y, w, h}
		}
	}
	return nil
}

// collectArrowObstacleRects extracts thin rectangles from existing arrow paths.
func collectArrowObstacleRects(elements []drawingElement, excludeIDs map[string]bool, originX, originY float64) []rect {
	var rects []rect
	for _, el := range elements {
		if !isArrow(el) {
			continue
		}
		id, _ := el["id"].(string)
		if excludeIDs[id] {
			continue
		}
		ax, _ := el["x"].(float64)
		ay, _ := el["y"].(float64)
		rawPts, ok := el["points"].([]any)
		if !ok || len(rawPts) < 2 {
			continue
		}

		type pt struct{ x, y float64 }
		pts := make([]pt, 0, len(rawPts))
		for _, rp := range rawPts {
			switch v := rp.(type) {
			case []any:
				if len(v) >= 2 {
					px, _ := v[0].(float64)
					py, _ := v[1].(float64)
					pts = append(pts, pt{px + ax - originX, py + ay - originY})
				}
			case []float64:
				if len(v) >= 2 {
					pts = append(pts, pt{v[0] + ax - originX, v[1] + ay - originY})
				}
			}
		}

		for i := 0; i < len(pts)-1; i++ {
			p1, p2 := pts[i], pts[i+1]
			segLen := abs(p2.x-p1.x) + abs(p2.y-p1.y)
			if segLen < 5 {
				continue
			}
			if abs(p1.y-p2.y) < 1 {
				minX := min(p1.x, p2.x)
				rects = append(rects, rect{minX, p1.y - arrowGap/2, abs(p2.x - p1.x), arrowGap})
			} else if abs(p1.x-p2.x) < 1 {
				minY := min(p1.y, p2.y)
				rects = append(rects, rect{p1.x - arrowGap/2, minY, arrowGap, abs(p2.y - p1.y)})
			}
		}
	}
	return rects
}
