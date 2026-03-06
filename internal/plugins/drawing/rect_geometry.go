package drawing

import (
	"fmt"
	"math"
)

// RectGeometry implements Geometry2d for rectangles.
type RectGeometry struct {
	W, H float64
}

func NewRectGeometry(w, h float64) *RectGeometry {
	return &RectGeometry{W: w, H: h}
}

func (g *RectGeometry) Bounds() Rect { return Rect{0, 0, g.W, g.H} }
func (g *RectGeometry) Center() Vec2 { return Vec2{g.W / 2, g.H / 2} }

func (g *RectGeometry) Vertices() []Vec2 {
	return []Vec2{
		{0, 0}, {g.W, 0}, {g.W, g.H}, {0, g.H},
	}
}

func (g *RectGeometry) Perimeter() float64 {
	return 2*g.W + 2*g.H
}

// PointOnPerimeter walks the rect perimeter: top → right → bottom → left.
func (g *RectGeometry) PointOnPerimeter(t float64) Vec2 {
	t = t - math.Floor(t) // normalize to [0,1)
	p := t * g.Perimeter()

	// Top edge: 0 → W
	if p <= g.W {
		return Vec2{p, 0}
	}
	p -= g.W
	// Right edge: 0 → H
	if p <= g.H {
		return Vec2{g.W, p}
	}
	p -= g.H
	// Bottom edge: W → 0
	if p <= g.W {
		return Vec2{g.W - p, g.H}
	}
	p -= g.W
	// Left edge: H → 0
	return Vec2{0, g.H - p}
}

func (g *RectGeometry) HitTestPoint(p Vec2) bool {
	return p.X >= 0 && p.X <= g.W && p.Y >= 0 && p.Y <= g.H
}

func (g *RectGeometry) HitTestSegment(a, b Vec2) bool {
	r := Rect{0, 0, g.W, g.H}
	return EdgeCrossesRect(a, b, r)
}

func (g *RectGeometry) NearestPoint(p Vec2) Vec2 {
	// Clamp to edges
	cx := clamp(p.X, 0, g.W)
	cy := clamp(p.Y, 0, g.H)

	// If inside, find nearest edge
	if cx == p.X && cy == p.Y {
		dists := [4]float64{p.Y, g.H - p.Y, p.X, g.W - p.X} // top, bottom, left, right
		minDist := dists[0]
		minIdx := 0
		for i := 1; i < 4; i++ {
			if dists[i] < minDist {
				minDist = dists[i]
				minIdx = i
			}
		}
		switch minIdx {
		case 0:
			return Vec2{p.X, 0}
		case 1:
			return Vec2{p.X, g.H}
		case 2:
			return Vec2{0, p.Y}
		case 3:
			return Vec2{g.W, p.Y}
		}
	}

	return Vec2{cx, cy}
}

func (g *RectGeometry) DistanceToPoint(p Vec2) float64 {
	nearest := g.NearestPoint(p)
	return Dist(p, nearest)
}

func (g *RectGeometry) SVGPath() string {
	return fmt.Sprintf("M0,0 L%.1f,0 L%.1f,%.1f L0,%.1f Z", g.W, g.W, g.H, g.H)
}

// ── Helpers ────────────────────────────────────────────────

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// EdgeCrossesRect checks if an axis-aligned segment crosses through or touches a rect.
// Expands the rect by a small epsilon so edges sitting exactly on the boundary are blocked.
func EdgeCrossesRect(a, b Vec2, r Rect) bool {
	const eps = 1.0
	if math.Abs(a.Y-b.Y) < 0.5 {
		y := a.Y
		if y < r.Y-eps || y > r.Y+r.H+eps {
			return false
		}
		minX := math.Min(a.X, b.X)
		maxX := math.Max(a.X, b.X)
		return minX < r.X+r.W+eps && maxX > r.X-eps
	}
	if math.Abs(a.X-b.X) < 0.5 {
		x := a.X
		if x < r.X-eps || x > r.X+r.W+eps {
			return false
		}
		minY := math.Min(a.Y, b.Y)
		maxY := math.Max(a.Y, b.Y)
		return minY < r.Y+r.H+eps && maxY > r.Y-eps
	}
	return false
}
