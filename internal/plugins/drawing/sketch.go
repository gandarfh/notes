package drawing

import "math"

// ── Seeded random — deterministic per element (matches TS sr() exactly) ──

func sr(x, y float64, i int) float64 {
	n := math.Sin(x*12.9898+y*78.233+float64(i)*4356.13) * 43758.5453
	return n - math.Floor(n)
}

// ── Sketchy Line (2-pass Bézier wobble) ──

// sketchLine generates a single pass of a sketchy line as PathCmds.
// pass=0 is the main stroke, pass=1 is the lighter shadow/double.
func sketchLine(x1, y1, x2, y2 float64, sw float64, seed float64, pass int, overshoot float64) StrokePath {
	dx, dy := x2-x1, y2-y1
	length := math.Hypot(dx, dy)
	if length < 1 {
		return StrokePath{Opacity: 0}
	}
	nx, ny := dx/length, dy/length
	fp := float64(pass)

	osStart := overshoot * (0.1 + sr(seed, fp, 1)*1.2)
	osEnd := overshoot * (0.1 + sr(seed, fp, 2)*1.2)

	perpAmount := sw * (0.2 + sr(seed, fp, 3)*0.5)
	if sr(seed, fp, 4) > 0.5 {
		perpAmount = -perpAmount
	}
	ox, oy := -ny*perpAmount, nx*perpAmount

	sx := x1 - nx*osStart + ox
	sy := y1 - ny*osStart + oy
	ex := x2 + nx*osEnd + ox
	ey := y2 + ny*osEnd + oy

	t1 := 0.3 + (sr(seed, fp, 5)-0.5)*0.1
	t2 := 0.7 + (sr(seed, fp, 6)-0.5)*0.1
	wobbleAmount := length*0.01 + sw*0.8
	c1x := sx + (ex-sx)*t1 + (sr(seed, fp, 7)-0.5)*wobbleAmount
	c1y := sy + (ey-sy)*t1 + (sr(seed, fp, 8)-0.5)*wobbleAmount
	c2x := sx + (ex-sx)*t2 + (sr(seed, fp, 9)-0.5)*wobbleAmount
	c2y := sy + (ey-sy)*t2 + (sr(seed, fp, 10)-0.5)*wobbleAmount

	var opacity, width float64
	if pass == 0 {
		opacity = 0.7 + sr(seed, fp, 11)*0.2
		width = sw * (0.8 + sr(seed, fp, 13)*0.4)
	} else {
		opacity = 0.15 + sr(seed, fp, 12)*0.2
		width = sw * (0.3 + sr(seed, fp, 14)*0.35)
	}

	return StrokePath{
		Cmds: []PathCmd{
			{Op: OpMoveTo, Args: []float64{sx, sy}},
			{Op: OpCurveTo, Args: []float64{c1x, c1y, c2x, c2y, ex, ey}},
		},
		Opacity:     opacity,
		StrokeWidth: width,
	}
}

// sketchEdge generates both passes (main + shadow) for a sketchy line segment.
func sketchEdge(x1, y1, x2, y2 float64, sw float64, seed float64, overshoot float64) []StrokePath {
	return []StrokePath{
		sketchLine(x1, y1, x2, y2, sw, seed, 0, overshoot),
		sketchLine(x1, y1, x2, y2, sw, seed, 1, overshoot),
	}
}

// ── Sketchy Shape Outlines ──
func sketchRectOutline(x, y, w, h float64, sw float64, seed float64) []StrokePath {
	corners := [][2]float64{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}
	var paths []StrokePath
	for e := 0; e < 4; e++ {
		ax, ay := corners[e][0], corners[e][1]
		bx, by := corners[(e+1)%4][0], corners[(e+1)%4][1]
		edgeSeed := seed + float64(e)*137
		paths = append(paths, sketchEdge(ax, ay, bx, by, sw, edgeSeed, 6)...)
	}
	return paths
}

// sketchEllipseOutline generates a sketchy ellipse (24-point wobble perimeter × 2 passes).
func sketchEllipseOutline(cx, cy, rx, ry float64, sw float64, seed float64) []StrokePath {
	var paths []StrokePath
	for p := 0; p < 2; p++ {
		fp := float64(p)
		steps := 24
		points := make([][2]float64, steps+1)
		startOffset := (sr(seed, fp, 80) - 0.5) * 0.15
		endOffset := 1.0 + (sr(seed, fp, 81)-0.5)*0.1

		for i := 0; i <= steps; i++ {
			t := float64(i) / float64(steps)
			a := (startOffset + t*(endOffset-startOffset)) * math.Pi * 2
			wobbleR := sw * (0.6 + sr(seed+fp*50, float64(i), 0)*0.8)
			px := cx + (rx+(sr(seed+fp*50, float64(i), 2)-0.5)*wobbleR)*math.Cos(a)
			py := cy + (ry+(sr(seed+fp*50, float64(i), 3)-0.5)*wobbleR)*math.Sin(a)
			points[i] = [2]float64{px, py}
		}

		var opacity, width float64
		if p == 0 {
			opacity = 0.75
			width = sw
		} else {
			opacity = 0.2
			width = sw * (0.4 + sr(seed, fp, 90)*0.3)
		}

		cmds := []PathCmd{{Op: OpMoveTo, Args: []float64{points[0][0], points[0][1]}}}
		for i := 1; i < len(points); i++ {
			prev, cur := points[i-1], points[i]
			cpx := (prev[0]+cur[0])/2 + (sr(seed, float64(i)+fp*100, 4)-0.5)*sw*0.6
			cpy := (prev[1]+cur[1])/2 + (sr(seed, float64(i)+fp*100, 5)-0.5)*sw*0.6
			cmds = append(cmds, PathCmd{Op: OpQuadTo, Args: []float64{cpx, cpy, cur[0], cur[1]}})
		}

		paths = append(paths, StrokePath{
			Cmds:        cmds,
			Opacity:     opacity,
			StrokeWidth: width,
		})
	}
	return paths
}

// sketchDiamondOutline generates a sketchy diamond (4 edges × 2 passes).
func sketchDiamondOutline(cx, cy, w, h float64, sw float64, seed float64) []StrokePath {
	pts := [][2]float64{
		{cx, cy - h/2}, {cx + w/2, cy}, {cx, cy + h/2}, {cx - w/2, cy},
	}
	var paths []StrokePath
	for e := 0; e < 4; e++ {
		edgeSeed := seed + float64(e)*137
		paths = append(paths, sketchEdge(
			pts[e][0], pts[e][1], pts[(e+1)%4][0], pts[(e+1)%4][1],
			sw, edgeSeed, 6,
		)...)
	}
	return paths
}

// sketchFromPathCmds generates sketchy strokes from arbitrary PathCmds
// by extracting line segments and adding wobble to each.
func sketchFromPathCmds(cmds []PathCmd, sw float64, seed float64) []StrokePath {
	if len(cmds) == 0 {
		return nil
	}
	var paths []StrokePath
	var curX, curY float64
	edgeIdx := 0

	for _, cmd := range cmds {
		switch cmd.Op {
		case OpMoveTo:
			curX, curY = cmd.Args[0], cmd.Args[1]
		case OpLineTo:
			edgeSeed := seed + float64(edgeIdx)*137
			paths = append(paths, sketchEdge(curX, curY, cmd.Args[0], cmd.Args[1], sw, edgeSeed, 6)...)
			curX, curY = cmd.Args[0], cmd.Args[1]
			edgeIdx++
		case OpClose:
			// closing edge will be handled by next MoveTo or end
		}
	}
	return paths
}

// ── Fill (hachure or solid) ──

// sketchShapeFill generates fill strokes for any shape that implements ShapeDef.
// Uses the shape's OutlinePath as a clip mask, then draws hachure or solid fill lines.
// This is the default fill implementation shared by all shapes.
func sketchShapeFill(shape ShapeDef, w, h float64, seed int, fillColor, fillStyle string) []StrokePath {
	fseed := float64(seed)
	clipCmds := shape.OutlinePath(w, h)

	clipPath := StrokePath{
		Cmds:   clipCmds,
		IsClip: true,
	}

	paths := []StrokePath{clipPath}
	cxc, cyc := w/2, h/2

	if fillStyle == "solid" {
		baseAngle := 0.5 + (sr(fseed, fseed, 60)-0.5)*0.3
		cos, sin := math.Cos(baseAngle), math.Sin(baseAngle)
		diag := math.Hypot(w, h) + 30
		spacing := 5 + sr(fseed, fseed, 61)*2
		numStrokes := int(math.Ceil(diag / spacing))
		bleed := 3 + sr(fseed, fseed, 62)*2

		for i := 0; i < numStrokes; i++ {
			t := float64(i) / float64(numStrokes)
			offset := -diag/2 + t*diag
			sx := cxc + cos*(-diag/2-bleed) + sin*offset
			sy := cyc + sin*(-diag/2-bleed) - cos*offset
			ex := cxc + cos*(diag/2+bleed) + sin*offset
			ey := cyc + sin*(diag/2+bleed) - cos*offset

			strokeW := 4 + sr(fseed, float64(i), 63)*3
			op := 0.05 + sr(fseed, float64(i), 64)*0.06

			paths = append(paths, StrokePath{
				Cmds: []PathCmd{
					{Op: OpMoveTo, Args: []float64{sx, sy}},
					{Op: OpLineTo, Args: []float64{ex, ey}},
				},
				Opacity:     op,
				StrokeWidth: strokeW,
				FillColor:   fillColor,
			})
		}
	} else {
		baseAngle := 0.7 + (sr(fseed, fseed, 50)-0.5)*0.2
		cos, sin := math.Cos(baseAngle), math.Sin(baseAngle)
		diag := math.Hypot(w, h) + 20
		spacing := 14 + sr(fseed, fseed, 51)*4
		numStrokes := int(math.Ceil(diag / spacing))

		for i := 0; i < numStrokes; i++ {
			t := float64(i) / float64(numStrokes)
			offset := -diag/2 + t*diag
			sx := cxc + cos*(-diag/2) + sin*offset
			sy := cyc + sin*(-diag/2) - cos*offset
			ex := cxc + cos*(diag/2) + sin*offset
			ey := cyc + sin*(diag/2) - cos*offset

			strokeW := 4 + sr(fseed, float64(i), 52)*3
			op := 0.2 + sr(fseed, float64(i), 53)*0.15
			mx := (sx+ex)/2 + (sr(fseed, float64(i), 54)-0.5)*3
			my := (sy+ey)/2 + (sr(fseed, float64(i), 55)-0.5)*3

			paths = append(paths, StrokePath{
				Cmds: []PathCmd{
					{Op: OpMoveTo, Args: []float64{sx, sy}},
					{Op: OpQuadTo, Args: []float64{mx, my, ex, ey}},
				},
				Opacity:     op,
				StrokeWidth: strokeW,
				FillColor:   fillColor,
			})
		}
	}

	return paths
}

// ── Sketchy Line Segments (for arrows) ──

// SketchLinePaths generates sketchy StrokePaths for a polyline (list of points).
// Each segment gets 2-pass Bézier wobble.
func SketchLinePaths(points [][2]float64, seed int, sw float64) []StrokePath {
	if len(points) < 2 {
		return nil
	}
	var paths []StrokePath
	fseed := float64(seed)
	for i := 0; i < len(points)-1; i++ {
		edgeSeed := fseed + float64(i)*100
		paths = append(paths, sketchEdge(
			points[i][0], points[i][1],
			points[i+1][0], points[i+1][1],
			sw, edgeSeed, 3,
		)...)
	}
	return paths
}
