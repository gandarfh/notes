package drawing

import "math"

// ═══════════════════════════════════════════════════════════════
// Route Pipeline Stages
// Each stage reads/writes to the shared RoutePlan struct.
// Stages can be tested independently by constructing a RoutePlan.
// ═══════════════════════════════════════════════════════════════

// StageAntennas computes the start/end antenna points by extruding
// outward from the connection side by the route margin.
// If an antenna lands inside an obstacle, deflects it perpendicular.
func StageAntennas(p *RoutePlan) {
	sdx, sdy := SideDir(p.Opts.StartSide)
	ddx, ddy := SideDir(p.Opts.EndSide)
	p.Antennas[0] = Vec2{sdx * p.Margin, sdy * p.Margin}
	p.Antennas[1] = Vec2{p.Dest.X + ddx*p.Margin, p.Dest.Y + ddy*p.Margin}

	// Deflect antennas away from obstacles if they land inside one
	for i := range p.Antennas {
		for _, obs := range p.Opts.ShapeObstacles {
			inflated := Rect{obs.X - p.Margin, obs.Y - p.Margin, obs.W + p.Margin*2, obs.H + p.Margin*2}
			if inflated.Contains(p.Antennas[i], 0) {
				// Deflect perpendicular to the side direction
				// For vertical sides (top/bottom), move horizontally outside obstacle
				// For horizontal sides (left/right), move vertically outside obstacle
				side := p.Opts.StartSide
				if i == 1 {
					side = p.Opts.EndSide
				}
				if side == "top" || side == "bottom" {
					// Move to whichever side of the inflated obstacle is closer
					distLeft := p.Antennas[i].X - inflated.X
					distRight := inflated.X + inflated.W - p.Antennas[i].X
					if distLeft < distRight {
						p.Antennas[i].X = inflated.X - 1
					} else {
						p.Antennas[i].X = inflated.X + inflated.W + 1
					}
				} else {
					distTop := p.Antennas[i].Y - inflated.Y
					distBottom := inflated.Y + inflated.H - p.Antennas[i].Y
					if distTop < distBottom {
						p.Antennas[i].Y = inflated.Y - 1
					} else {
						p.Antennas[i].Y = inflated.Y + inflated.H + 1
					}
				}
			}
		}
	}
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
// intersections, midpoints, obstacle corners, and antenna points.
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

	// ── Inflated obstacle corners ──
	// Explicit corner spots ensure the Dijkstra graph has waypoints to route around
	// each obstacle, even when obstacles are tightly packed.
	for _, obs := range p.Obstacles {
		rawSpots = append(rawSpots,
			Vec2{obs.X, obs.Y},                 // top-left
			Vec2{obs.X + obs.W, obs.Y},         // top-right
			Vec2{obs.X, obs.Y + obs.H},         // bottom-left
			Vec2{obs.X + obs.W, obs.Y + obs.H}, // bottom-right
		)
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
// Inserts orthogonal waypoints when antennas are deflected (offset from origin/dest).
func StageSimplify(p *RoutePlan) {
	// Build full path with L-shaped connectors for deflected antennas
	var fullPath []Vec2
	fullPath = append(fullPath, p.Origin)

	// If antenna1 is offset from origin, insert L-shape waypoints
	ant1 := p.Antennas[0]
	if len(p.Path) > 0 && (math.Abs(p.Origin.X-ant1.X) > 0.5 && math.Abs(p.Origin.Y-ant1.Y) > 0.5) {
		isVertStart := p.Opts.StartSide == "top" || p.Opts.StartSide == "bottom"
		if isVertStart {
			// Small stub outward, then horizontal to antenna X, then to antenna Y
			stub := p.Margin * 0.3
			sdx, sdy := SideDir(p.Opts.StartSide)
			stubY := p.Origin.Y + sdy*stub
			_ = sdx
			fullPath = append(fullPath, Vec2{p.Origin.X, stubY})
			fullPath = append(fullPath, Vec2{ant1.X, stubY})
		} else {
			stub := p.Margin * 0.3
			sdx, sdy := SideDir(p.Opts.StartSide)
			stubX := p.Origin.X + sdx*stub
			_ = sdy
			fullPath = append(fullPath, Vec2{stubX, p.Origin.Y})
			fullPath = append(fullPath, Vec2{stubX, ant1.Y})
		}
	}

	fullPath = append(fullPath, p.Path...)

	// If antenna2 is offset from dest, insert L-shape waypoints
	ant2 := p.Antennas[1]
	if len(p.Path) > 0 && (math.Abs(p.Dest.X-ant2.X) > 0.5 && math.Abs(p.Dest.Y-ant2.Y) > 0.5) {
		isVertEnd := p.Opts.EndSide == "top" || p.Opts.EndSide == "bottom"
		if isVertEnd {
			stub := p.Margin * 0.3
			ddx, ddy := SideDir(p.Opts.EndSide)
			stubY := p.Dest.Y + ddy*stub
			_ = ddx
			fullPath = append(fullPath, Vec2{ant2.X, stubY})
			fullPath = append(fullPath, Vec2{p.Dest.X, stubY})
		} else {
			stub := p.Margin * 0.3
			ddx, ddy := SideDir(p.Opts.EndSide)
			stubX := p.Dest.X + ddx*stub
			_ = ddy
			fullPath = append(fullPath, Vec2{stubX, ant2.Y})
			fullPath = append(fullPath, Vec2{stubX, p.Dest.Y})
		}
	}

	fullPath = append(fullPath, p.Dest)
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
