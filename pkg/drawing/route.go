package drawing

import (
	"math"
	"sort"
)

// ═══════════════════════════════════════════════════════════════
// Orthogonal Arrow Routing with Obstacle Avoidance
// Dijkstra-based: rulers → grid → spots → graph → shortest path → simplify
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

// ComputeOrthoRoute computes an obstacle-aware orthogonal path.
// dx, dy: displacement from arrow start to arrow end.
// All output points are relative to arrow origin (0,0).
func ComputeOrthoRoute(dx, dy float64, opts RouteOpts) [][]float64 {
	margin := RouteMargin

	// If no rects provided, use simple L/Z routing
	if opts.StartRect == nil && opts.EndRect == nil {
		return SimpleOrthoRoute(dx, dy, opts.StartSide, opts.EndSide)
	}

	origin := Vec2{0, 0}
	dest := Vec2{dx, dy}

	// Antenna points (extrude from edge)
	sdx, sdy := SideDir(opts.StartSide)
	ddx, ddy := SideDir(opts.EndSide)
	antenna1 := Vec2{sdx * margin, sdy * margin}
	antenna2 := Vec2{dx + ddx*margin, dy + ddy*margin}

	// Build inflated obstacle rects (shapes only — NOT arrows)
	var obstacles []Rect
	if opts.StartRect != nil {
		obstacles = append(obstacles, Rect{
			opts.StartRect.X - margin, opts.StartRect.Y - margin,
			opts.StartRect.W + margin*2, opts.StartRect.H + margin*2,
		})
	}
	if opts.EndRect != nil {
		obstacles = append(obstacles, Rect{
			opts.EndRect.X - margin, opts.EndRect.Y - margin,
			opts.EndRect.W + margin*2, opts.EndRect.H + margin*2,
		})
	}
	for _, obs := range opts.ShapeObstacles {
		obstacles = append(obstacles, Rect{
			obs.X - margin, obs.Y - margin,
			obs.W + margin*2, obs.H + margin*2,
		})
	}

	// Build rulers from obstacle edges + antenna points
	var vRulers, hRulers []float64
	for _, obs := range obstacles {
		vRulers = append(vRulers, obs.X, obs.X+obs.W)
		hRulers = append(hRulers, obs.Y, obs.Y+obs.H)
	}

	isVertStart := opts.StartSide == "top" || opts.StartSide == "bottom"
	isVertEnd := opts.EndSide == "top" || opts.EndSide == "bottom"
	if isVertStart {
		vRulers = append(vRulers, antenna1.X)
	} else {
		hRulers = append(hRulers, antenna1.Y)
	}
	if isVertEnd {
		vRulers = append(vRulers, antenna2.X)
	} else {
		hRulers = append(hRulers, antenna2.Y)
	}

	vr := uniqSortF(vRulers)
	hr := uniqSortF(hRulers)

	// Global bounds
	allX := append([]float64{origin.X, dest.X, antenna1.X, antenna2.X}, vr...)
	allY := append([]float64{origin.Y, dest.Y, antenna1.Y, antenna2.Y}, hr...)
	boundsL := minF(allX...) - margin
	boundsT := minF(allY...) - margin
	boundsR := maxF(allX...) + margin
	boundsB := maxF(allY...) + margin

	cellXs := append([]float64{boundsL}, append(vr, boundsR)...)
	cellYs := append([]float64{boundsT}, append(hr, boundsB)...)

	// Generate spots from grid intersections + midpoints
	var rawSpots []Vec2
	for _, x := range cellXs {
		for _, y := range cellYs {
			rawSpots = append(rawSpots, Vec2{x, y})
		}
	}
	for i := 0; i < len(cellXs)-1; i++ {
		mx := (cellXs[i] + cellXs[i+1]) / 2
		for _, y := range cellYs {
			rawSpots = append(rawSpots, Vec2{mx, y})
		}
		for j := 0; j < len(cellYs)-1; j++ {
			my := (cellYs[j] + cellYs[j+1]) / 2
			rawSpots = append(rawSpots, Vec2{mx, my})
		}
	}
	for j := 0; j < len(cellYs)-1; j++ {
		my := (cellYs[j] + cellYs[j+1]) / 2
		for _, x := range cellXs {
			rawSpots = append(rawSpots, Vec2{x, my})
		}
	}

	rawSpots = append(rawSpots, antenna1, antenna2)

	// All rects for spot filtering (src, dst, plus all other shape obstacles)
	var allOriginalRects []Rect
	if opts.StartRect != nil {
		allOriginalRects = append(allOriginalRects, *opts.StartRect)
	}
	if opts.EndRect != nil {
		allOriginalRects = append(allOriginalRects, *opts.EndRect)
	}
	allOriginalRects = append(allOriginalRects, opts.ShapeObstacles...)

	// Filter out spots inside any shape rect, but ALWAYS keep antenna points
	ant1Key := vecKey(antenna1)
	ant2Key := vecKey(antenna2)
	var spots []Vec2
	for _, p := range rawSpots {
		pk := vecKey(p)
		if pk == ant1Key || pk == ant2Key {
			spots = append(spots, p)
			continue
		}
		inside := false
		for _, obs := range allOriginalRects {
			if obs.Contains(p, 1) {
				inside = true
				break
			}
		}
		if !inside {
			spots = append(spots, p)
		}
	}

	// Deduplicate
	seen := map[int64]bool{}
	var uniqueSpots []Vec2
	for _, s := range spots {
		k := vecKey(s)
		if !seen[k] {
			seen[k] = true
			uniqueSpots = append(uniqueSpots, s)
		}
	}

	// Run Dijkstra: shapes hard-block edges, arrows add soft penalty
	var blockRects []Rect
	if opts.StartRect != nil {
		blockRects = append(blockRects, *opts.StartRect)
	}
	if opts.EndRect != nil {
		blockRects = append(blockRects, *opts.EndRect)
	}
	blockRects = append(blockRects, opts.ShapeObstacles...)

	path := buildGraphAndRoute(uniqueSpots, antenna1, antenna2, blockRects, opts.ArrowObstacles)

	// Compose: origin → antenna path → destination
	fullPath := append([]Vec2{origin}, append(path, dest)...)

	// Deduplicate consecutive points BEFORE simplification (prevents diagonals)
	fullPath = dedupVec2s(fullPath)

	// Simplify collinear
	simplified := []Vec2{fullPath[0]}
	for i := 1; i < len(fullPath)-1; i++ {
		prev, cur, next := fullPath[i-1], fullPath[i], fullPath[i+1]
		sameX := math.Abs(prev.X-cur.X) < 0.5 && math.Abs(cur.X-next.X) < 0.5
		sameY := math.Abs(prev.Y-cur.Y) < 0.5 && math.Abs(cur.Y-next.Y) < 0.5
		if !sameX && !sameY {
			simplified = append(simplified, cur)
		}
	}
	simplified = append(simplified, fullPath[len(fullPath)-1])

	// Convert to [][]float64
	result := make([][]float64, 0, len(simplified))
	for _, p := range simplified {
		result = append(result, []float64{p.X, p.Y})
	}

	// Final dedup consecutive
	clean := [][]float64{result[0]}
	for i := 1; i < len(result); i++ {
		if math.Abs(result[i][0]-clean[len(clean)-1][0]) > 0.5 ||
			math.Abs(result[i][1]-clean[len(clean)-1][1]) > 0.5 {
			clean = append(clean, result[i])
		}
	}

	if len(clean) >= 2 {
		return clean
	}
	return SimpleOrthoRoute(dx, dy, opts.StartSide, opts.EndSide)
}

// ── Dijkstra on sparse point graph ─────────────────────────

type gNode struct {
	pt   Vec2
	dist float64
	prev *gNode
	dir  byte // 'h' or 'v' or 0
}

type routeEdge struct {
	to  Vec2
	w   float64
	dir byte
}

type pqItem struct{ node *gNode }
type priorityQ []*pqItem

func (pq *priorityQ) push(item *pqItem) { *pq = append(*pq, item); pq.up(len(*pq) - 1) }
func (pq *priorityQ) pop() *pqItem {
	old := *pq
	n := len(old)
	if n == 0 {
		return nil
	}
	item := old[0]
	old[0] = old[n-1]
	*pq = old[:n-1]
	if len(*pq) > 0 {
		pq.down(0)
	}
	return item
}
func (pq *priorityQ) up(i int) {
	for i > 0 {
		p := (i - 1) / 2
		if (*pq)[i].node.dist >= (*pq)[p].node.dist {
			break
		}
		(*pq)[i], (*pq)[p] = (*pq)[p], (*pq)[i]
		i = p
	}
}
func (pq *priorityQ) down(i int) {
	n := len(*pq)
	for {
		s, l, r := i, 2*i+1, 2*i+2
		if l < n && (*pq)[l].node.dist < (*pq)[s].node.dist {
			s = l
		}
		if r < n && (*pq)[r].node.dist < (*pq)[s].node.dist {
			s = r
		}
		if s == i {
			break
		}
		(*pq)[i], (*pq)[s] = (*pq)[s], (*pq)[i]
		i = s
	}
}

func buildGraphAndRoute(spots []Vec2, origin, dest Vec2, shapeRects, arrowRects []Rect) []Vec2 {
	byX := map[int64][]Vec2{}
	byY := map[int64][]Vec2{}
	for _, s := range spots {
		kx := int64(math.Round(s.X * 100))
		ky := int64(math.Round(s.Y * 100))
		byX[kx] = append(byX[kx], s)
		byY[ky] = append(byY[ky], s)
	}

	for _, arr := range byX {
		sort.Slice(arr, func(i, j int) bool { return arr[i].Y < arr[j].Y })
	}
	for _, arr := range byY {
		sort.Slice(arr, func(i, j int) bool { return arr[i].X < arr[j].X })
	}

	blocked := func(a, b Vec2) bool {
		for _, r := range shapeRects {
			if EdgeCrossesRect(a, b, r) {
				return true
			}
		}
		return false
	}

	arrowPenalty := func(a, b Vec2) float64 {
		penalty := 0.0
		for _, r := range arrowRects {
			if EdgeCrossesRect(a, b, r) {
				penalty += ArrowPenalty
			}
		}
		return penalty
	}

	adj := map[int64][]routeEdge{}
	for _, s := range spots {
		k := vecKey(s)
		if _, ok := adj[k]; !ok {
			adj[k] = []routeEdge{}
		}
	}

	for _, arr := range byX {
		for i := 0; i < len(arr)-1; i++ {
			a, b := arr[i], arr[i+1]
			if blocked(a, b) {
				continue
			}
			w := math.Abs(b.Y-a.Y) + arrowPenalty(a, b)
			adj[vecKey(a)] = append(adj[vecKey(a)], routeEdge{b, w, 'v'})
			adj[vecKey(b)] = append(adj[vecKey(b)], routeEdge{a, w, 'v'})
		}
	}
	for _, arr := range byY {
		for i := 0; i < len(arr)-1; i++ {
			a, b := arr[i], arr[i+1]
			if blocked(a, b) {
				continue
			}
			w := math.Abs(b.X-a.X) + arrowPenalty(a, b)
			adj[vecKey(a)] = append(adj[vecKey(a)], routeEdge{b, w, 'h'})
			adj[vecKey(b)] = append(adj[vecKey(b)], routeEdge{a, w, 'h'})
		}
	}

	// Dijkstra with bend penalty
	nodes := map[int64]*gNode{}
	for _, s := range spots {
		nodes[vecKey(s)] = &gNode{pt: s, dist: math.Inf(1)}
	}

	originNode := nodes[vecKey(origin)]
	destNode := nodes[vecKey(dest)]
	if originNode == nil || destNode == nil {
		return lShapeFallback(origin, dest)
	}

	originNode.dist = 0
	visited := map[int64]bool{}
	heap := &priorityQ{}
	heap.push(&pqItem{originNode})

	destKey := vecKey(dest)

	for len(*heap) > 0 {
		cur := heap.pop().node
		ck := vecKey(cur.pt)
		if visited[ck] {
			continue
		}
		visited[ck] = true
		if ck == destKey {
			break
		}

		for _, e := range adj[ck] {
			ek := vecKey(e.to)
			if visited[ek] {
				continue
			}
			neighbor := nodes[ek]
			if neighbor == nil {
				continue
			}
			bendPenalty := 0.0
			if cur.dir != 0 && cur.dir != e.dir {
				bendPenalty = (e.w + 1) * (e.w + 1)
			}
			newDist := cur.dist + e.w + bendPenalty
			if newDist < neighbor.dist {
				neighbor.dist = newDist
				neighbor.prev = cur
				neighbor.dir = e.dir
				heap.push(&pqItem{neighbor})
			}
		}
	}

	var path []Vec2
	for n := destNode; n != nil; n = n.prev {
		path = append([]Vec2{n.pt}, path...)
	}
	if len(path) >= 2 {
		return path
	}
	return lShapeFallback(origin, dest)
}

// lShapeFallback creates an L-shaped path between two points.
func lShapeFallback(origin, dest Vec2) []Vec2 {
	if math.Abs(origin.X-dest.X) < 0.5 {
		return []Vec2{origin, dest}
	}
	if math.Abs(origin.Y-dest.Y) < 0.5 {
		return []Vec2{origin, dest}
	}
	return []Vec2{origin, {dest.X, origin.Y}, dest}
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
	sort.Float64s(out)
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
