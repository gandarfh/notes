package drawing

import (
	"fmt"
	"math"
)

// EllipseGeometry implements Geometry2d for ellipses.
type EllipseGeometry struct {
	W, H float64
}

func NewEllipseGeometry(w, h float64) *EllipseGeometry {
	return &EllipseGeometry{W: w, H: h}
}

func (g *EllipseGeometry) Bounds() Rect { return Rect{0, 0, g.W, g.H} }
func (g *EllipseGeometry) Center() Vec2 { return Vec2{g.W / 2, g.H / 2} }

func (g *EllipseGeometry) Vertices() []Vec2 {
	n := 32
	pts := make([]Vec2, n)
	rx, ry := g.W/2, g.H/2
	cx, cy := rx, ry
	for i := 0; i < n; i++ {
		angle := 2 * math.Pi * float64(i) / float64(n)
		pts[i] = Vec2{cx + rx*math.Cos(angle), cy + ry*math.Sin(angle)}
	}
	return pts
}

// Perimeter uses Ramanujan's approximation for ellipse perimeter.
func (g *EllipseGeometry) Perimeter() float64 {
	a, b := g.W/2, g.H/2
	h := math.Pow(a-b, 2) / math.Pow(a+b, 2)
	return math.Pi * (a + b) * (1 + 3*h/(10+math.Sqrt(4-3*h)))
}

// PointOnPerimeter returns a point on the ellipse at parameter t ∈ [0,1).
func (g *EllipseGeometry) PointOnPerimeter(t float64) Vec2 {
	t = t - math.Floor(t)
	angle := 2 * math.Pi * t
	rx, ry := g.W/2, g.H/2
	return Vec2{rx + rx*math.Cos(angle), ry + ry*math.Sin(angle)}
}

func (g *EllipseGeometry) HitTestPoint(p Vec2) bool {
	rx, ry := g.W/2, g.H/2
	dx := (p.X - rx) / rx
	dy := (p.Y - ry) / ry
	return dx*dx+dy*dy <= 1.0
}

func (g *EllipseGeometry) HitTestSegment(a, b Vec2) bool {
	// Approximate: check if segment crosses the bounding rect
	// and any vertex lies inside or segment endpoints straddle the ellipse
	r := Rect{0, 0, g.W, g.H}
	if !EdgeCrossesRect(a, b, r) {
		return false
	}
	// Check several sample points along the segment
	for i := 0; i <= 10; i++ {
		t := float64(i) / 10.0
		p := Vec2{a.X + t*(b.X-a.X), a.Y + t*(b.Y-a.Y)}
		if g.HitTestPoint(p) {
			return true
		}
	}
	return false
}

func (g *EllipseGeometry) NearestPoint(p Vec2) Vec2 {
	rx, ry := g.W/2, g.H/2
	cx, cy := rx, ry
	dx := p.X - cx
	dy := p.Y - cy

	if math.Abs(dx) < 0.001 && math.Abs(dy) < 0.001 {
		return Vec2{cx + rx, cy} // default to right
	}

	angle := math.Atan2(dy/ry, dx/rx)
	return Vec2{cx + rx*math.Cos(angle), cy + ry*math.Sin(angle)}
}

func (g *EllipseGeometry) DistanceToPoint(p Vec2) float64 {
	nearest := g.NearestPoint(p)
	return Dist(p, nearest)
}

func (g *EllipseGeometry) SVGPath() string {
	rx, ry := g.W/2, g.H/2
	return fmt.Sprintf("M%.1f,0 A%.1f,%.1f 0 1,1 %.1f,%.1f A%.1f,%.1f 0 1,1 %.1f,0",
		rx, rx, ry, rx, g.H, rx, ry, rx)
}
