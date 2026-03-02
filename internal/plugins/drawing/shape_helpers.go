package drawing

// ── Shared Shape Helpers ───────────────────────────────────
// Used by all shape definitions for anchors and nearest-anchor logic.

// fourSideAnchors returns 4 anchor points at midpoints of each side.
func fourSideAnchors(w, h float64) []AnchorPoint {
	return []AnchorPoint{
		{Side: SideTop, T: 0.5, X: w / 2, Y: 0},
		{Side: SideBottom, T: 0.5, X: w / 2, Y: h},
		{Side: SideLeft, T: 0.5, X: 0, Y: h / 2},
		{Side: SideRight, T: 0.5, X: w, Y: h / 2},
	}
}

// findNearestAnchor returns the anchor closest to (px, py).
func findNearestAnchor(anchors []AnchorPoint, px, py float64) AnchorPoint {
	best := anchors[0]
	bestDist := Dist(Vec2{px, py}, Vec2{best.X, best.Y})
	for _, a := range anchors[1:] {
		d := Dist(Vec2{px, py}, Vec2{a.X, a.Y})
		if d < bestDist {
			bestDist = d
			best = a
		}
	}
	return best
}
