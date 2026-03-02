package drawing

import "math"

// ═══════════════════════════════════════════════════════════════
// Route Pipeline Stages
// Each stage reads/writes to the shared RoutePlan struct.
// Stages can be tested independently by constructing a RoutePlan.
// ═══════════════════════════════════════════════════════════════

// StageAntennas computes the start/end antenna points by extruding
// outward from the connection side by the route margin.
func StageAntennas(p *RoutePlan) {
	sdx, sdy := SideDir(p.Opts.StartSide)
	ddx, ddy := SideDir(p.Opts.EndSide)
	p.Antennas[0] = Vec2{sdx * p.Margin, sdy * p.Margin}
	p.Antennas[1] = Vec2{p.Dest.X + ddx*p.Margin, p.Dest.Y + ddy*p.Margin}
}

// StageExpandObstacles inflates each shape obstacle by the route margin
// and collects the original (non-inflated) rects for spot filtering.
func StageExpandObstacles(p *RoutePlan) {
	m := p.Margin

	inflate := func(r Rect) Rect {
		return Rect{r.X - m, r.Y - m, r.W + m*2, r.H + m*2}
	}

	if p.Opts.StartRect != nil {
		p.Obstacles = append(p.Obstacles, inflate(*p.Opts.StartRect))
		p.OriginalRects = append(p.OriginalRects, *p.Opts.StartRect)
		p.BlockRects = append(p.BlockRects, *p.Opts.StartRect)
	}
	if p.Opts.EndRect != nil {
		p.Obstacles = append(p.Obstacles, inflate(*p.Opts.EndRect))
		p.OriginalRects = append(p.OriginalRects, *p.Opts.EndRect)
		p.BlockRects = append(p.BlockRects, *p.Opts.EndRect)
	}
	for _, obs := range p.Opts.ShapeObstacles {
		p.Obstacles = append(p.Obstacles, inflate(obs))
		p.OriginalRects = append(p.OriginalRects, obs)
		p.BlockRects = append(p.BlockRects, obs)
	}
}

// StageComputeSpots generates candidate waypoints from ruler grid
// intersections, midpoints, and antenna points.
func StageComputeSpots(p *RoutePlan) {
	m := p.Margin
	ant1, ant2 := p.Antennas[0], p.Antennas[1]

	// Rulers from obstacle edges
	var vRulers, hRulers []float64
	for _, obs := range p.Obstacles {
		vRulers = append(vRulers, obs.X, obs.X+obs.W)
		hRulers = append(hRulers, obs.Y, obs.Y+obs.H)
	}

	// Add antenna axis rulers
	isVertStart := p.Opts.StartSide == "top" || p.Opts.StartSide == "bottom"
	isVertEnd := p.Opts.EndSide == "top" || p.Opts.EndSide == "bottom"
	if isVertStart {
		vRulers = append(vRulers, ant1.X)
	} else {
		hRulers = append(hRulers, ant1.Y)
	}
	if isVertEnd {
		vRulers = append(vRulers, ant2.X)
	} else {
		hRulers = append(hRulers, ant2.Y)
	}

	vr := uniqSortF(vRulers)
	hr := uniqSortF(hRulers)

	// Global bounds
	allX := append([]float64{p.Origin.X, p.Dest.X, ant1.X, ant2.X}, vr...)
	allY := append([]float64{p.Origin.Y, p.Dest.Y, ant1.Y, ant2.Y}, hr...)
	cellXs := append([]float64{minF(allX...) - m}, append(vr, maxF(allX...)+m)...)
	cellYs := append([]float64{minF(allY...) - m}, append(hr, maxF(allY...)+m)...)

	// Grid intersections
	var rawSpots []Vec2
	for _, x := range cellXs {
		for _, y := range cellYs {
			rawSpots = append(rawSpots, Vec2{x, y})
		}
	}
	// Midpoints along X
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
	// Midpoints along Y
	for j := 0; j < len(cellYs)-1; j++ {
		my := (cellYs[j] + cellYs[j+1]) / 2
		for _, x := range cellXs {
			rawSpots = append(rawSpots, Vec2{x, my})
		}
	}

	rawSpots = append(rawSpots, ant1, ant2)
	p.Spots = rawSpots
}

// StageFilterSpots removes spots inside any shape rect (keeping antenna
// points) and deduplicates.
func StageFilterSpots(p *RoutePlan) {
	ant1Key := vecKey(p.Antennas[0])
	ant2Key := vecKey(p.Antennas[1])

	var filtered []Vec2
	for _, s := range p.Spots {
		sk := vecKey(s)
		if sk == ant1Key || sk == ant2Key {
			filtered = append(filtered, s)
			continue
		}
		inside := false
		for _, r := range p.OriginalRects {
			if r.Contains(s, 1) {
				inside = true
				break
			}
		}
		if !inside {
			filtered = append(filtered, s)
		}
	}

	// Deduplicate
	seen := map[int64]bool{}
	var unique []Vec2
	for _, s := range filtered {
		k := vecKey(s)
		if !seen[k] {
			seen[k] = true
			unique = append(unique, s)
		}
	}
	p.Spots = unique
}

// StageDijkstra builds a visibility graph from spots and finds the
// shortest orthogonal path using Dijkstra with bend penalty.
func StageDijkstra(p *RoutePlan) {
	p.Path = buildGraphAndRoute(
		p.Spots, p.Antennas[0], p.Antennas[1],
		p.BlockRects, p.Opts.ArrowObstacles,
	)
}

// StageSimplify composes origin → path → dest, deduplicates consecutive
// points, removes collinear waypoints, and converts to [][]float64.
func StageSimplify(p *RoutePlan) {
	fullPath := append([]Vec2{p.Origin}, append(p.Path, p.Dest)...)
	fullPath = dedupVec2s(fullPath)

	// Remove collinear
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
	for _, pt := range simplified {
		result = append(result, []float64{pt.X, pt.Y})
	}

	// Final dedup consecutive
	clean := [][]float64{result[0]}
	for i := 1; i < len(result); i++ {
		if math.Abs(result[i][0]-clean[len(clean)-1][0]) > 0.5 ||
			math.Abs(result[i][1]-clean[len(clean)-1][1]) > 0.5 {
			clean = append(clean, result[i])
		}
	}
	p.Result = clean
}
