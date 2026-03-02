package drawing

import (
	"math"
	"sort"
)

// ═══════════════════════════════════════════════════════════════
// Dijkstra graph routing on a sparse orthogonal point grid
// ═══════════════════════════════════════════════════════════════

// buildGraphAndRoute constructs a visibility graph from spots and runs
// Dijkstra with bend penalty to find the shortest orthogonal path.
func buildGraphAndRoute(spots []Vec2, origin, dest Vec2, shapeRects, arrowRects []Rect) []Vec2 {
	adj := buildAdjacencyList(spots, shapeRects, arrowRects)
	return dijkstra(spots, origin, dest, adj)
}

// ── Graph construction ─────────────────────────────────────

type routeEdge struct {
	to  Vec2
	w   float64
	dir byte // 'h' or 'v'
}

// buildAdjacencyList creates edges between aligned spots that don't cross
// shape rects. Arrow rects add a soft penalty instead of blocking.
func buildAdjacencyList(spots []Vec2, shapeRects, arrowRects []Rect) map[int64][]routeEdge {
	// Group spots by X and Y for axis-aligned edge generation
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

	arrowPen := func(a, b Vec2) float64 {
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

	addEdge := func(a, b Vec2, dir byte) {
		var dist float64
		if dir == 'v' {
			dist = math.Abs(b.Y - a.Y)
		} else {
			dist = math.Abs(b.X - a.X)
		}
		w := dist + arrowPen(a, b)
		adj[vecKey(a)] = append(adj[vecKey(a)], routeEdge{b, w, dir})
		adj[vecKey(b)] = append(adj[vecKey(b)], routeEdge{a, w, dir})
	}

	// Vertical edges (same X)
	for _, arr := range byX {
		for i := 0; i < len(arr)-1; i++ {
			if !blocked(arr[i], arr[i+1]) {
				addEdge(arr[i], arr[i+1], 'v')
			}
		}
	}
	// Horizontal edges (same Y)
	for _, arr := range byY {
		for i := 0; i < len(arr)-1; i++ {
			if !blocked(arr[i], arr[i+1]) {
				addEdge(arr[i], arr[i+1], 'h')
			}
		}
	}

	return adj
}

// ── Dijkstra with bend penalty ─────────────────────────────

type gNode struct {
	pt   Vec2
	dist float64
	prev *gNode
	dir  byte // 'h' or 'v' or 0
}

func dijkstra(spots []Vec2, origin, dest Vec2, adj map[int64][]routeEdge) []Vec2 {
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

// ── Priority queue (min-heap by distance) ──────────────────

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

// sortFloat64s is used instead of sort.Float64s for TinyGo compatibility.
func sortFloat64s(a []float64) {
	sort.Float64s(a)
}
