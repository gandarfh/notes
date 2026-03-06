package drawing

import (
	"fmt"
	"math"
)

// DiamondGeometry implements Geometry2d for diamond/rhombus shapes.
type DiamondGeometry struct {
	W, H float64
}

func NewDiamondGeometry(w, h float64) *DiamondGeometry {
	return &DiamondGeometry{W: w, H: h}
}

func (g *DiamondGeometry) Bounds() Rect { return Rect{0, 0, g.W, g.H} }
func (g *DiamondGeometry) Center() Vec2 { return Vec2{g.W / 2, g.H / 2} }

func (g *DiamondGeometry) Vertices() []Vec2 {
	return []Vec2{
		{g.W / 2, 0},   // top
		{g.W, g.H / 2}, // right
		{g.W / 2, g.H}, // bottom
		{0, g.H / 2},   // left
	}
}

func (g *DiamondGeometry) Perimeter() float64 {
	// 4 × length of one side
	sideLen := math.Hypot(g.W/2, g.H/2)
	return 4 * sideLen
}

// PointOnPerimeter walks: top→right, right→bottom, bottom→left, left→top.
func (g *DiamondGeometry) PointOnPerimeter(t float64) Vec2 {
	t = t - math.Floor(t)
	verts := g.Vertices()

	// Each side is 25% of the perimeter
	sideIdx := int(t * 4)
	if sideIdx >= 4 {
		sideIdx = 3
	}
	localT := t*4 - float64(sideIdx)

	from := verts[sideIdx]
	to := verts[(sideIdx+1)%4]
	return Vec2{
		from.X + localT*(to.X-from.X),
		from.Y + localT*(to.Y-from.Y),
	}
}

func (g *DiamondGeometry) HitTestPoint(p Vec2) bool {
	// Point-in-rhombus: |x-cx|/hw + |y-cy|/hh <= 1
	cx, cy := g.W/2, g.H/2
	return math.Abs(p.X-cx)/(g.W/2)+math.Abs(p.Y-cy)/(g.H/2) <= 1.0
}

func (g *DiamondGeometry) HitTestSegment(a, b Vec2) bool {
	// Check against bounding rect first
	r := Rect{0, 0, g.W, g.H}
	if !EdgeCrossesRect(a, b, r) {
		return false
	}
	// Sample along segment
	for i := 0; i <= 10; i++ {
		t := float64(i) / 10.0
		p := Vec2{a.X + t*(b.X-a.X), a.Y + t*(b.Y-a.Y)}
		if g.HitTestPoint(p) {
			return true
		}
	}
	return false
}

func (g *DiamondGeometry) NearestPoint(p Vec2) Vec2 {
	verts := g.Vertices()
	best := verts[0]
	bestDist := math.MaxFloat64

	// Check each edge
	for i := 0; i < 4; i++ {
		a := verts[i]
		b := verts[(i+1)%4]
		np := nearestPointOnSegment(p, a, b)
		d := Dist(p, np)
		if d < bestDist {
			bestDist = d
			best = np
		}
	}
	return best
}

func (g *DiamondGeometry) DistanceToPoint(p Vec2) float64 {
	nearest := g.NearestPoint(p)
	return Dist(p, nearest)
}

func (g *DiamondGeometry) SVGPath() string {
	return fmt.Sprintf("M%.1f,0 L%.1f,%.1f L%.1f,%.1f L0,%.1f Z",
		g.W/2, g.W, g.H/2, g.W/2, g.H, g.H/2)
}

// ── Helpers ────────────────────────────────────────────────

// nearestPointOnSegment finds the closest point on segment AB to point P.
func nearestPointOnSegment(p, a, b Vec2) Vec2 {
	dx := b.X - a.X
	dy := b.Y - a.Y
	lenSq := dx*dx + dy*dy
	if lenSq < 0.001 {
		return a
	}
	t := ((p.X-a.X)*dx + (p.Y-a.Y)*dy) / lenSq
	t = clamp(t, 0, 1)
	return Vec2{a.X + t*dx, a.Y + t*dy}
}
