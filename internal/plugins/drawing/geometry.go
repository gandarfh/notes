package drawing

// Geometry2d is the core abstraction for shape geometry.
// It defines the mathematical form of an element, independent of
// its visual appearance. Inspired by tldraw's Geometry2d.
//
// Implementations: RectGeometry, EllipseGeometry, DiamondGeometry.
type Geometry2d interface {
	// Bounding
	Bounds() Rect
	Center() Vec2

	// Outline
	Vertices() []Vec2
	Perimeter() float64
	PointOnPerimeter(t float64) Vec2 // parametric [0,1) → point on perimeter

	// Spatial queries
	HitTestPoint(p Vec2) bool
	HitTestSegment(a, b Vec2) bool
	NearestPoint(p Vec2) Vec2
	DistanceToPoint(p Vec2) float64

	// Rendering
	SVGPath() string
}
