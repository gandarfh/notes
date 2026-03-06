package drawing

import "math"

// ═══════════════════════════════════════════════════════════════
// Orthogonal Arrow Routing with Obstacle Avoidance
// Pipeline-based: antennas → expand → spots → filter → dijkstra → simplify
//
// Files:
//   route.go         — types, pipeline composition, fallback routing, helpers
//   route_stages.go  — each Stage function implementation
//   route_graph.go   — Dijkstra graph building, priority queue
// ═══════════════════════════════════════════════════════════════

const (
	RouteMargin  = 60.0  // inflation margin around obstacles
	ArrowGap     = 15.0  // gap between parallel arrows
	ArrowPenalty = 150.0 // soft penalty for crossing existing arrows
)

// RouteOpts configures an orthogonal route computation.
type RouteOpts struct {
	StartSide      string // "top", "bottom", "left", "right"
	EndSide        string
	StartRect      *Rect  // bounding box of source element (arrow-local coords)
	EndRect        *Rect  // bounding box of destination element (arrow-local coords)
	ShapeObstacles []Rect // other shape bounding boxes (arrow-local coords)
	ArrowObstacles []Rect // existing arrow segment rects (soft penalty)
}

// ── Pipeline types ─────────────────────────────────────────

// RoutePlan holds intermediate state passed between pipeline stages.
type RoutePlan struct {
	Origin, Dest  Vec2
	Opts          RouteOpts
	Margin        float64
	Antennas      [2]Vec2 // start/end antenna points
	Obstacles     []Rect  // inflated obstacle rects
	OriginalRects []Rect  // non-inflated (for spot filtering)
	BlockRects    []Rect  // for Dijkstra edge blocking
	Spots         []Vec2  // candidate waypoints (deduplicated)
	Path          []Vec2  // raw dijkstra result
	Result        [][]float64
}

// Stage is a single step in the routing pipeline.
type Stage func(p *RoutePlan)

// ── Pipeline composition ───────────────────────────────────

// ComputeOrthoRoute computes an obstacle-aware orthogonal path.
// dx, dy: displacement from arrow start to arrow end.
// All output points are relative to arrow origin (0,0).
func ComputeOrthoRoute(dx, dy float64, opts RouteOpts) [][]float64 {
	if opts.StartRect == nil && opts.EndRect == nil {
		return SimpleOrthoRoute(dx, dy, opts.StartSide, opts.EndSide)
	}

	plan := &RoutePlan{
		Origin: Vec2{0, 0},
		Dest:   Vec2{dx, dy},
		Opts:   opts,
		Margin: RouteMargin,
	}

	for _, stage := range []Stage{
		StageAntennas,
		StageExpandObstacles,
		StageComputeSpots,
		StageFilterSpots,
		StageDijkstra,
		StageSimplify,
	} {
		stage(plan)
	}

	if len(plan.Result) >= 2 {
		return plan.Result
	}

	// Pipeline failed — try obstacle-aware fallback detour
	if len(opts.ShapeObstacles) > 0 {
		if detour := obstacleDetour(dx, dy, opts); detour != nil {
			return detour
		}
	}
	return SimpleOrthoRoute(dx, dy, opts.StartSide, opts.EndSide)
}

// ── Simple fallback routing ────────────────────────────────

// SimpleOrthoRoute is the fallback L/Z-shaped routing without obstacle avoidance.
func SimpleOrthoRoute(dx, dy float64, srcSide, dstSide string) [][]float64 {
	isVertSrc := srcSide == "top" || srcSide == "bottom"
	isVertDst := dstSide == "top" || dstSide == "bottom"

	sdx, sdy := SideDir(srcSide)
	ddx, ddy := SideDir(dstSide)
	a1x := sdx * RouteMargin
	a1y := sdy * RouteMargin
	a2x := dx + ddx*RouteMargin
	a2y := dy + ddy*RouteMargin

	var points [][]float64
	if isVertSrc && isVertDst {
		midY := (a1y + a2y) / 2
		points = [][]float64{{0, 0}, {0, a1y}, {0, midY}, {dx, midY}, {dx, a2y}, {dx, dy}}
	} else if !isVertSrc && !isVertDst {
		midX := (a1x + a2x) / 2
		points = [][]float64{{0, 0}, {a1x, 0}, {midX, 0}, {midX, dy}, {a2x, dy}, {dx, dy}}
	} else if isVertSrc {
		points = [][]float64{{0, 0}, {0, a1y}, {0, dy}, {dx, dy}}
	} else {
		points = [][]float64{{0, 0}, {a1x, 0}, {dx, 0}, {dx, dy}}
	}
	return SimplifyOrtho(points)
}

// obstacleDetour produces a U-shaped path around obstacles when the Dijkstra fails.
// It finds the combined bounding box of all obstacles between origin and dest,
// then routes around the nearest clear edge with proper antenna margins.
func obstacleDetour(dx, dy float64, opts RouteOpts) [][]float64 {
	m := RouteMargin

	// Combine all obstacle rects into a union bounding box
	allRects := opts.ShapeObstacles
	if opts.StartRect != nil {
		allRects = append(allRects, *opts.StartRect)
	}
	if opts.EndRect != nil {
		allRects = append(allRects, *opts.EndRect)
	}
	if len(allRects) == 0 {
		return nil
	}

	// Find bounding box of all obstacles
	minX, minY := allRects[0].X, allRects[0].Y
	maxX, maxY := allRects[0].X+allRects[0].W, allRects[0].Y+allRects[0].H
	for _, r := range allRects[1:] {
		if r.X < minX {
			minX = r.X
		}
		if r.Y < minY {
			minY = r.Y
		}
		if r.X+r.W > maxX {
			maxX = r.X + r.W
		}
		if r.Y+r.H > maxY {
			maxY = r.Y + r.H
		}
	}

	// Compute antenna extensions (outward from connection sides)
	sdx, sdy := SideDir(opts.StartSide)
	ddx, ddy := SideDir(opts.EndSide)
	a1x, a1y := sdx*m, sdy*m       // start antenna offset
	a2x, a2y := dx+ddx*m, dy+ddy*m // end antenna offset

	isVert := opts.StartSide == "top" || opts.StartSide == "bottom"

	if isVert {
		// Vertical path blocked — detour horizontally around obstacle cluster
		leftEdge := minX - m
		rightEdge := maxX + m
		detourX := rightEdge
		if math.Abs(leftEdge) < math.Abs(rightEdge) {
			detourX = leftEdge
		}
		// U-shape with antennas: origin → antenna → detour → antenna → dest
		return SimplifyOrtho([][]float64{
			{0, 0},
			{0, a1y},
			{detourX, a1y},
			{detourX, a2y},
			{dx, a2y},
			{dx, dy},
		})
	}

	// Horizontal path blocked — detour vertically around obstacle cluster
	topEdge := minY - m
	bottomEdge := maxY + m
	detourY := bottomEdge
	if math.Abs(topEdge) < math.Abs(bottomEdge) {
		detourY = topEdge
	}
	return SimplifyOrtho([][]float64{
		{0, 0},
		{a1x, 0},
		{a1x, detourY},
		{a2x, detourY},
		{a2x, dy},
		{dx, dy},
	})
}

// SideDir returns the directional unit vector for a side.
func SideDir(side string) (float64, float64) {
	switch side {
	case "top":
		return 0, -1
	case "bottom":
		return 0, 1
	case "left":
		return -1, 0
	case "right":
		return 1, 0
	}
	return 0, 1
}

// SimplifyOrtho removes collinear waypoints from an ortho path.
func SimplifyOrtho(pts [][]float64) [][]float64 {
	if len(pts) < 3 {
		return pts
	}
	result := [][]float64{pts[0]}
	for i := 1; i < len(pts)-1; i++ {
		prev, cur, next := pts[i-1], pts[i], pts[i+1]
		sameX := math.Abs(prev[0]-cur[0]) < 0.5 && math.Abs(cur[0]-next[0]) < 0.5
		sameY := math.Abs(prev[1]-cur[1]) < 0.5 && math.Abs(cur[1]-next[1]) < 0.5
		if !sameX && !sameY {
			result = append(result, cur)
		}
	}
	result = append(result, pts[len(pts)-1])
	return result
}

// BinarySubdivisionT returns the t-value for the nth connection slot.
// Pattern: 0.5, 0.25, 0.75, 0.125, 0.875, 0.375, 0.625...
func BinarySubdivisionT(index int) float64 {
	k := 0
	threshold := 1
	remaining := index
	for remaining >= threshold {
		remaining -= threshold
		k++
		threshold *= 2
	}
	denom := 1 << uint(k+1)
	num := 2*remaining + 1
	t := float64(num) / float64(denom)
	if t < 0.1 {
		t = 0.1
	}
	if t > 0.9 {
		t = 0.9
	}
	return t
}

// ── Internal helpers ───────────────────────────────────────

func vecKey(p Vec2) int64 {
	rx := int64(math.Round(p.X * 100))
	ry := int64(math.Round(p.Y * 100))
	return rx*10000000 + ry
}

func dedupVec2s(pts []Vec2) []Vec2 {
	if len(pts) == 0 {
		return pts
	}
	result := []Vec2{pts[0]}
	for i := 1; i < len(pts); i++ {
		if math.Abs(pts[i].X-result[len(result)-1].X) > 0.5 ||
			math.Abs(pts[i].Y-result[len(result)-1].Y) > 0.5 {
			result = append(result, pts[i])
		}
	}
	return result
}

func uniqSortF(arr []float64) []float64 {
	seen := map[int64]bool{}
	var out []float64
	for _, v := range arr {
		k := int64(math.Round(v * 100))
		if !seen[k] {
			seen[k] = true
			out = append(out, v)
		}
	}
	sortFloat64s(out)
	return out
}

func minF(vals ...float64) float64 {
	m := vals[0]
	for _, v := range vals[1:] {
		if v < m {
			m = v
		}
	}
	return m
}

func maxF(vals ...float64) float64 {
	m := vals[0]
	for _, v := range vals[1:] {
		if v > m {
			m = v
		}
	}
	return m
}
