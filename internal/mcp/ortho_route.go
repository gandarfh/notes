package mcpserver

import (
	"math"
	"sort"
)

// ═══════════════════════════════════════════════════════════════
// Orthogonal Arrow Routing with Obstacle Avoidance
// Ported from frontend/src/drawing/ortho.ts (Dijkstra-based)
// ═══════════════════════════════════════════════════════════════

const routeMargin = 30.0

type point struct{ x, y float64 }

// rect is defined in layout.go — reused here

func pt(x, y float64) point { return point{x, y} }

func manhattan(a, b point) float64 {
	return math.Abs(a.x-b.x) + math.Abs(a.y-b.y)
}

func rectContains(r rect, p point, margin float64) bool {
	return p.x >= r.x-margin && p.x <= r.x+r.w+margin &&
		p.y >= r.y-margin && p.y <= r.y+r.h+margin
}

// edgeCrossesRect checks if an axis-aligned segment crosses through a rect interior.
func edgeCrossesRect(a, b point, r rect) bool {
	if math.Abs(a.y-b.y) < 0.5 {
		// Horizontal segment
		y := a.y
		if y <= r.y || y >= r.y+r.h {
			return false
		}
		minX := math.Min(a.x, b.x)
		maxX := math.Max(a.x, b.x)
		return minX < r.x+r.w && maxX > r.x
	}
	if math.Abs(a.x-b.x) < 0.5 {
		// Vertical segment
		x := a.x
		if x <= r.x || x >= r.x+r.w {
			return false
		}
		minY := math.Min(a.y, b.y)
		maxY := math.Max(a.y, b.y)
		return minY < r.y+r.h && maxY > r.y
	}
	return false
}

// ── Priority Queue (min-heap by distance) ──────────────────

type gNode struct {
	pt   point
	dist float64
	prev *gNode
	dir  byte // 'h' or 'v' or 0
}

type pqItem struct {
	node *gNode
}

type priorityQueue []*pqItem

func (pq *priorityQueue) push(item *pqItem) {
	*pq = append(*pq, item)
	pq.up(len(*pq) - 1)
}

func (pq *priorityQueue) pop() *pqItem {
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

func (pq *priorityQueue) up(i int) {
	for i > 0 {
		p := (i - 1) / 2
		if (*pq)[i].node.dist >= (*pq)[p].node.dist {
			break
		}
		(*pq)[i], (*pq)[p] = (*pq)[p], (*pq)[i]
		i = p
	}
}

func (pq *priorityQueue) down(i int) {
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

// ── Key helper ─────────────────────────────────────────────

func ptKey(p point) int64 {
	// Combine rounded x,y into a single int64 key
	rx := int64(math.Round(p.x * 100))
	ry := int64(math.Round(p.y * 100))
	return rx*10000000 + ry
}

// ── Dijkstra on sparse point graph ─────────────────────────

type edge struct {
	to  point
	w   float64
	dir byte // 'h' or 'v'
}

func buildGraphAndRoute(spots []point, origin, dest point, shapeRects []rect) []point {
	// Index spots by x and y for fast neighbor lookup
	byX := map[int64][]point{}
	byY := map[int64][]point{}
	for _, s := range spots {
		kx := int64(math.Round(s.x * 100))
		ky := int64(math.Round(s.y * 100))
		byX[kx] = append(byX[kx], s)
		byY[ky] = append(byY[ky], s)
	}

	// Sort columns/rows
	for _, arr := range byX {
		sort.Slice(arr, func(i, j int) bool { return arr[i].y < arr[j].y })
	}
	for _, arr := range byY {
		sort.Slice(arr, func(i, j int) bool { return arr[i].x < arr[j].x })
	}

	blocked := func(a, b point) bool {
		for _, r := range shapeRects {
			if edgeCrossesRect(a, b, r) {
				return true
			}
		}
		return false
	}

	// Build adjacency
	adj := map[int64][]edge{}
	for _, s := range spots {
		k := ptKey(s)
		if _, ok := adj[k]; !ok {
			adj[k] = []edge{}
		}
	}

	for _, arr := range byX {
		for i := 0; i < len(arr)-1; i++ {
			a, b := arr[i], arr[i+1]
			if blocked(a, b) {
				continue
			}
			w := math.Abs(b.y - a.y)
			adj[ptKey(a)] = append(adj[ptKey(a)], edge{b, w, 'v'})
			adj[ptKey(b)] = append(adj[ptKey(b)], edge{a, w, 'v'})
		}
	}
	for _, arr := range byY {
		for i := 0; i < len(arr)-1; i++ {
			a, b := arr[i], arr[i+1]
			if blocked(a, b) {
				continue
			}
			w := math.Abs(b.x - a.x)
			adj[ptKey(a)] = append(adj[ptKey(a)], edge{b, w, 'h'})
			adj[ptKey(b)] = append(adj[ptKey(b)], edge{a, w, 'h'})
		}
	}

	// Dijkstra with bend penalty
	nodes := map[int64]*gNode{}
	for _, s := range spots {
		nodes[ptKey(s)] = &gNode{pt: s, dist: math.Inf(1)}
	}

	originNode := nodes[ptKey(origin)]
	destNode := nodes[ptKey(dest)]
	if originNode == nil || destNode == nil {
		// L-shaped fallback (never diagonal)
		return []point{origin, pt(dest.x, origin.y), dest}
	}

	originNode.dist = 0
	visited := map[int64]bool{}
	heap := &priorityQueue{}
	heap.push(&pqItem{originNode})

	destKey := ptKey(dest)

	for len(*heap) > 0 {
		cur := heap.pop().node
		ck := ptKey(cur.pt)
		if visited[ck] {
			continue
		}
		visited[ck] = true
		if ck == destKey {
			break
		}

		for _, e := range adj[ck] {
			ek := ptKey(e.to)
			if visited[ek] {
				continue
			}
			neighbor := nodes[ek]
			if neighbor == nil {
				continue
			}
			// Bend penalty
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

	// Reconstruct path
	var path []point
	for n := destNode; n != nil; n = n.prev {
		path = append([]point{n.pt}, path...)
	}
	if len(path) >= 2 {
		return path
	}
	// L-shaped fallback (never diagonal)
	return []point{origin, pt(dest.x, origin.y), dest}
}

// ── Main routing function ──────────────────────────────────

// computeOrthoRoute computes obstacle-aware orthogonal path.
// All output points are relative to arrow origin (0,0).
// obstacles is a list of element bounding boxes in world coords.
// srcX,srcY is the world position of the arrow start.
func computeOrthoRoute(dx, dy float64, srcSide, dstSide string, srcRect, dstRect *rect, allObstacles []rect) [][]float64 {
	margin := routeMargin

	// If no rects provided, use simple L/Z routing
	if srcRect == nil && dstRect == nil {
		return simpleOrthoRoute(dx, dy, srcSide, dstSide)
	}

	origin := pt(0, 0)
	dest := pt(dx, dy)

	// Antenna points (extrude from edge)
	sdx, sdy := sideDirF(srcSide)
	ddx, ddy := sideDirF(dstSide)
	antenna1 := pt(sdx*margin, sdy*margin)
	antenna2 := pt(dx+ddx*margin, dy+ddy*margin)

	// Build inflated obstacle rects
	var obstacles []rect
	if srcRect != nil {
		obstacles = append(obstacles, rect{
			srcRect.x - margin, srcRect.y - margin,
			srcRect.w + margin*2, srcRect.h + margin*2,
		})
	}
	if dstRect != nil {
		obstacles = append(obstacles, rect{
			dstRect.x - margin, dstRect.y - margin,
			dstRect.w + margin*2, dstRect.h + margin*2,
		})
	}

	// Add all other obstacles (inflated)
	for _, obs := range allObstacles {
		obstacles = append(obstacles, rect{
			obs.x - margin, obs.y - margin,
			obs.w + margin*2, obs.h + margin*2,
		})
	}

	// Build rulers from obstacle edges + antenna points
	var vRulers, hRulers []float64
	for _, obs := range obstacles {
		vRulers = append(vRulers, obs.x, obs.x+obs.w)
		hRulers = append(hRulers, obs.y, obs.y+obs.h)
	}

	isVertStart := srcSide == "top" || srcSide == "bottom"
	isVertEnd := dstSide == "top" || dstSide == "bottom"
	if isVertStart {
		vRulers = append(vRulers, antenna1.x)
	} else {
		hRulers = append(hRulers, antenna1.y)
	}
	if isVertEnd {
		vRulers = append(vRulers, antenna2.x)
	} else {
		hRulers = append(hRulers, antenna2.y)
	}

	vr := uniqSortF(vRulers)
	hr := uniqSortF(hRulers)

	// Global bounds
	allX := append([]float64{origin.x, dest.x, antenna1.x, antenna2.x}, vr...)
	allY := append([]float64{origin.y, dest.y, antenna1.y, antenna2.y}, hr...)
	boundsL := minF(allX...) - margin
	boundsT := minF(allY...) - margin
	boundsR := maxF(allX...) + margin
	boundsB := maxF(allY...) + margin

	cellXs := append([]float64{boundsL}, append(vr, boundsR)...)
	cellYs := append([]float64{boundsT}, append(hr, boundsB)...)

	// Generate spots from grid intersections + midpoints
	var rawSpots []point
	for _, x := range cellXs {
		for _, y := range cellYs {
			rawSpots = append(rawSpots, pt(x, y))
		}
	}
	for i := 0; i < len(cellXs)-1; i++ {
		mx := (cellXs[i] + cellXs[i+1]) / 2
		for _, y := range cellYs {
			rawSpots = append(rawSpots, pt(mx, y))
		}
		for j := 0; j < len(cellYs)-1; j++ {
			my := (cellYs[j] + cellYs[j+1]) / 2
			rawSpots = append(rawSpots, pt(mx, my))
		}
	}
	for j := 0; j < len(cellYs)-1; j++ {
		my := (cellYs[j] + cellYs[j+1]) / 2
		for _, x := range cellXs {
			rawSpots = append(rawSpots, pt(x, my))
		}
	}

	rawSpots = append(rawSpots, antenna1, antenna2)

	// Original (non-inflated) obstacle rects for collision filtering
	// NOTE: Only use src/dst rects for spot filtering (matches frontend)
	// Do NOT include allObstacles here — they would filter out antenna points
	var originalObs []rect
	if srcRect != nil {
		originalObs = append(originalObs, *srcRect)
	}
	if dstRect != nil {
		originalObs = append(originalObs, *dstRect)
	}

	// Filter out spots inside original shape rects, but ALWAYS keep antenna points
	ant1Key := ptKey(antenna1)
	ant2Key := ptKey(antenna2)
	var spots []point
	for _, p := range rawSpots {
		pk := ptKey(p)
		if pk == ant1Key || pk == ant2Key {
			spots = append(spots, p) // never filter antenna points
			continue
		}
		inside := false
		for _, obs := range originalObs {
			if rectContains(obs, p, 1) {
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
	var uniqueSpots []point
	for _, s := range spots {
		k := ptKey(s)
		if !seen[k] {
			seen[k] = true
			uniqueSpots = append(uniqueSpots, s)
		}
	}

	// Run Dijkstra (block edges through original rects + other obstacles)
	blockRects := append(originalObs, allObstacles...)
	path := buildGraphAndRoute(uniqueSpots, antenna1, antenna2, blockRects)

	// Compose: origin → antenna path → destination
	fullPath := append([]point{origin}, append(path, dest)...)

	// Simplify collinear
	simplified := []point{fullPath[0]}
	for i := 1; i < len(fullPath)-1; i++ {
		prev, cur, next := fullPath[i-1], fullPath[i], fullPath[i+1]
		sameX := math.Abs(prev.x-cur.x) < 0.5 && math.Abs(cur.x-next.x) < 0.5
		sameY := math.Abs(prev.y-cur.y) < 0.5 && math.Abs(cur.y-next.y) < 0.5
		if !sameX && !sameY {
			simplified = append(simplified, cur)
		}
	}
	simplified = append(simplified, fullPath[len(fullPath)-1])

	// Convert to [][]float64
	result := make([][]float64, 0, len(simplified))
	for _, p := range simplified {
		result = append(result, []float64{p.x, p.y})
	}

	// Deduplicate consecutive
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
	// Fallback: L-shaped route (never diagonal)
	return simpleOrthoRoute(dx, dy, srcSide, dstSide)
}

// simpleOrthoRoute is the fallback L/Z-shaped routing without obstacle avoidance.
func simpleOrthoRoute(dx, dy float64, srcSide, dstSide string) [][]float64 {
	isVertSrc := srcSide == "top" || srcSide == "bottom"
	isVertDst := dstSide == "top" || dstSide == "bottom"

	sdx, sdy := sideDirF(srcSide)
	ddx, ddy := sideDirF(dstSide)
	a1x := sdx * routeMargin
	a1y := sdy * routeMargin
	a2x := dx + ddx*routeMargin
	a2y := dy + ddy*routeMargin

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
	return simplifyOrtho(points)
}

func sideDirF(side string) (float64, float64) {
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

// simplifyOrtho removes collinear waypoints from an ortho path.
func simplifyOrtho(pts [][]float64) [][]float64 {
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

// ── Helper utilities ───────────────────────────────────────

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

// ── Connection slot distribution ───────────────────────────

// connectSlot computes the `t` parameter for a new arrow connecting
// to the given element on the given side. It counts existing arrows
// on that side and distributes slots evenly.
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
	// Distribute: 1 arrow = center (0.5); 2 = 0.33/0.66; 3 = 0.25/0.50/0.75; etc.
	return float64(count+1) / float64(count+2)
}

func isArrow(el drawingElement) bool {
	t, _ := el["type"].(string)
	return t == "ortho-arrow" || t == "arrow"
}

// ── Obstacle collection ────────────────────────────────────

// collectObstacleRects returns bounding boxes for all non-arrow elements,
// converting from world coordinates to arrow-local coordinates.
func collectObstacleRects(elements []drawingElement, excludeIDs map[string]bool, originX, originY float64) []rect {
	var rects []rect
	for _, el := range elements {
		if isArrow(el) {
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
		// Convert to arrow-local coordinates
		rects = append(rects, rect{x - originX, y - originY, w, h})
	}
	return rects
}

// collectWorldObstacleRects returns bounding boxes in world coordinates.
func collectWorldObstacleRects(elements []drawingElement, excludeIDs map[string]bool) []rect {
	var rects []rect
	for _, el := range elements {
		if isArrow(el) {
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

// ── Element bounding box ───────────────────────────────────

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
