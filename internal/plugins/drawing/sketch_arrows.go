package drawing

import "math"

// ── Arrow Heads ──

// ArrowHeadPaths generates sketchy StrokePaths for an arrow head.
// Style: "dot", "arrow", "triangle", "bar", "diamond"
// tipX, tipY: tip position (local to arrow origin)
// angle: direction the arrow points towards (radians)
func ArrowHeadPaths(style string, tipX, tipY, angle, size float64, seed int, sw float64) []StrokePath {
	fseed := float64(seed)
	j := sw * 0.4
	jt := func(i int) float64 { return (sr(fseed, float64(i), 20) - 0.5) * j }

	switch style {
	case "dot":
		return arrowDot(tipX, tipY, sw, fseed)
	case "arrow":
		return arrowFilled(tipX, tipY, angle, size, fseed, jt)
	case "triangle":
		return arrowTriangle(tipX, tipY, angle, size, sw, fseed)
	case "bar":
		return arrowBar(tipX, tipY, angle, size, sw, fseed)
	case "diamond":
		return arrowDiamond(tipX, tipY, angle, size, sw, fseed)
	default:
		return nil
	}
}

// arrowDot — sketchy filled circle at the tip
func arrowDot(tipX, tipY, sw, seed float64) []StrokePath {
	r := 2 + sw*1.5
	var paths []StrokePath
	for p := 0; p < 2; p++ {
		fp := float64(p)
		steps := 12
		cmds := make([]PathCmd, 0, steps+2)
		for i := 0; i <= steps; i++ {
			a := (float64(i) / float64(steps)) * math.Pi * 2
			jx := (sr(seed+fp*40, float64(i), 0) - 0.5) * sw * 0.6
			jy := (sr(seed+fp*40, float64(i), 1) - 0.5) * sw * 0.6
			px := tipX + r*math.Cos(a) + jx
			py := tipY + r*math.Sin(a) + jy
			if i == 0 {
				cmds = append(cmds, PathCmd{Op: OpMoveTo, Args: []float64{px, py}})
			} else {
				cmds = append(cmds, PathCmd{Op: OpLineTo, Args: []float64{px, py}})
			}
		}
		cmds = append(cmds, PathCmd{Op: OpClose})
		op := 0.8
		if p == 1 {
			op = 0.25
		}
		paths = append(paths, StrokePath{
			Cmds:    cmds,
			Opacity: op,
			IsFill:  true,
		})
	}
	return paths
}

// arrowFilled — sketchy filled triangle arrow head
func arrowFilled(tipX, tipY, angle, size, seed float64, jt func(int) float64) []StrokePath {
	p1x := tipX - size*math.Cos(angle-math.Pi/6)
	p1y := tipY - size*math.Sin(angle-math.Pi/6)
	p2x := tipX - size*math.Cos(angle+math.Pi/6)
	p2y := tipY - size*math.Sin(angle+math.Pi/6)

	fillCmds := []PathCmd{
		{Op: OpMoveTo, Args: []float64{tipX + jt(0), tipY + jt(1)}},
		{Op: OpLineTo, Args: []float64{p1x + jt(2), p1y + jt(3)}},
		{Op: OpLineTo, Args: []float64{p2x + jt(4), p2y + jt(5)}},
		{Op: OpClose},
	}
	outlineCmds := []PathCmd{
		{Op: OpMoveTo, Args: []float64{tipX + jt(6), tipY + jt(7)}},
		{Op: OpLineTo, Args: []float64{p1x + jt(8), p1y + jt(9)}},
		{Op: OpLineTo, Args: []float64{p2x + jt(10), p2y + jt(11)}},
		{Op: OpClose},
	}
	return []StrokePath{
		{Cmds: fillCmds, Opacity: 0.7, IsFill: true},
		{Cmds: outlineCmds, Opacity: 0.5, StrokeWidth: 1},
	}
}

// arrowTriangle — sketchy outlined triangle (3 sketch edges)
func arrowTriangle(tipX, tipY, angle, size, sw, seed float64) []StrokePath {
	p1x := tipX - size*math.Cos(angle-math.Pi/6)
	p1y := tipY - size*math.Sin(angle-math.Pi/6)
	p2x := tipX - size*math.Cos(angle+math.Pi/6)
	p2y := tipY - size*math.Sin(angle+math.Pi/6)

	var paths []StrokePath
	for p := 0; p < 2; p++ {
		fp := float64(p)
		paths = append(paths, sketchLine(tipX, tipY, p1x, p1y, sw*0.7, seed+fp*50, p, 2))
		paths = append(paths, sketchLine(tipX, tipY, p2x, p2y, sw*0.7, seed+200+fp*50, p, 2))
		paths = append(paths, sketchLine(p1x, p1y, p2x, p2y, sw*0.7, seed+400+fp*50, p, 2))
	}
	return paths
}

// arrowBar — sketchy perpendicular bar at the tip
func arrowBar(tipX, tipY, angle, size, sw, seed float64) []StrokePath {
	half := size * 0.6
	bx1 := tipX + half*math.Cos(angle+math.Pi/2)
	by1 := tipY + half*math.Sin(angle+math.Pi/2)
	bx2 := tipX - half*math.Cos(angle+math.Pi/2)
	by2 := tipY - half*math.Sin(angle+math.Pi/2)

	var paths []StrokePath
	for p := 0; p < 2; p++ {
		paths = append(paths, sketchLine(bx1, by1, bx2, by2, sw, seed+float64(p)*50, p, 2))
	}
	return paths
}

// arrowDiamond — sketchy diamond shape at the tip (4 edges)
func arrowDiamond(tipX, tipY, angle, size, sw, seed float64) []StrokePath {
	half := size * 0.6
	pts := [][2]float64{
		{tipX + half*math.Cos(angle), tipY + half*math.Sin(angle)},
		{tipX + half*math.Cos(angle+math.Pi/2), tipY + half*math.Sin(angle+math.Pi/2)},
		{tipX - half*math.Cos(angle), tipY - half*math.Sin(angle)},
		{tipX - half*math.Cos(angle-math.Pi/2), tipY - half*math.Sin(angle-math.Pi/2)},
	}
	var paths []StrokePath
	for e := 0; e < 4; e++ {
		paths = append(paths, sketchLine(
			pts[e][0], pts[e][1],
			pts[(e+1)%4][0], pts[(e+1)%4][1],
			sw*0.7, seed+float64(e)*100, 0, 1,
		))
	}
	return paths
}
