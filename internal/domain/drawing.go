package domain

// DrawingElementType enumerates known drawing element types.
type DrawingElementType string

const (
	DrawingTypeRectangle DrawingElementType = "rectangle"
	DrawingTypeEllipse   DrawingElementType = "ellipse"
	DrawingTypeDiamond   DrawingElementType = "diamond"
	DrawingTypeText      DrawingElementType = "text"
	DrawingTypeGroup     DrawingElementType = "group"
	DrawingTypeArrow     DrawingElementType = "arrow"
	DrawingTypeOrtho     DrawingElementType = "ortho-arrow"
	DrawingTypeFreedraw  DrawingElementType = "freedraw"
	DrawingTypeLine      DrawingElementType = "line"
)

// DrawingConnection represents an arrow endpoint attached to a shape.
type DrawingConnection struct {
	ElementID string `json:"elementId"`
	Side      string `json:"side,omitempty"`
	T         float64 `json:"t,omitempty"`
}

// DrawingElement is the canonical Go representation of a canvas drawing element.
// Must serialize to JSON compatible with frontend DrawingElement interface
// (frontend/src/drawing/types.ts).
type DrawingElement struct {
	// Required fields
	ID              string             `json:"id"`
	Type            DrawingElementType `json:"type"`
	X               float64            `json:"x"`
	Y               float64            `json:"y"`
	Width           float64            `json:"width"`
	Height          float64            `json:"height"`
	StrokeColor     string             `json:"strokeColor"`
	StrokeWidth     float64            `json:"strokeWidth"`
	BackgroundColor string             `json:"backgroundColor"`

	// Optional geometry
	Points [][]float64 `json:"points,omitempty"`

	// Optional text/style
	Text          *string  `json:"text,omitempty"`
	FontSize      *float64 `json:"fontSize,omitempty"`
	FontFamily    *string  `json:"fontFamily,omitempty"`
	FontWeight    *float64 `json:"fontWeight,omitempty"`
	TextColor     *string  `json:"textColor,omitempty"`
	TextAlign     *string  `json:"textAlign,omitempty"`
	VerticalAlign *string  `json:"verticalAlign,omitempty"`

	// Optional appearance
	Roundness       *bool    `json:"roundness,omitempty"`
	BorderRadius    *float64 `json:"borderRadius,omitempty"`
	FillStyle       *string  `json:"fillStyle,omitempty"`
	Opacity         *float64 `json:"opacity,omitempty"`
	StrokeDasharray *string  `json:"strokeDasharray,omitempty"`

	// Arrow-specific
	StartConnection *DrawingConnection `json:"startConnection,omitempty"`
	EndConnection   *DrawingConnection `json:"endConnection,omitempty"`
	ArrowEnd        *string            `json:"arrowEnd,omitempty"`
	ArrowStart      *string            `json:"arrowStart,omitempty"`

	// Label (shapes and arrows)
	Label  *string  `json:"label,omitempty"`
	LabelT *float64 `json:"labelT,omitempty"`

	// Group marker
	IsGroup *bool `json:"isGroup,omitempty"`
}

func (e *DrawingElement) IsArrowElement() bool {
	return e.Type == DrawingTypeArrow || e.Type == DrawingTypeOrtho
}

func (e *DrawingElement) IsGroupElement() bool {
	if e.Type == DrawingTypeGroup {
		return true
	}
	return e.IsGroup != nil && *e.IsGroup
}

func (e *DrawingElement) CenterX() float64 { return e.X + e.Width/2 }
func (e *DrawingElement) CenterY() float64 { return e.Y + e.Height/2 }

// DrawingPatch represents a partial update to a DrawingElement.
// All fields are pointers; nil means "don't change".
type DrawingPatch struct {
	Type            *DrawingElementType `json:"type,omitempty"`
	X               *float64            `json:"x,omitempty"`
	Y               *float64            `json:"y,omitempty"`
	Width           *float64            `json:"width,omitempty"`
	Height          *float64            `json:"height,omitempty"`
	Points          [][]float64         `json:"points,omitempty"`
	Text            *string             `json:"text,omitempty"`
	StrokeColor     *string             `json:"strokeColor,omitempty"`
	StrokeWidth     *float64            `json:"strokeWidth,omitempty"`
	BackgroundColor *string             `json:"backgroundColor,omitempty"`
	FontSize        *float64            `json:"fontSize,omitempty"`
	Roundness       *bool               `json:"roundness,omitempty"`
	BorderRadius    *float64            `json:"borderRadius,omitempty"`
	FontFamily      *string             `json:"fontFamily,omitempty"`
	FontWeight      *float64            `json:"fontWeight,omitempty"`
	TextColor       *string             `json:"textColor,omitempty"`
	FillStyle       *string             `json:"fillStyle,omitempty"`
	Opacity         *float64            `json:"opacity,omitempty"`
	StrokeDasharray *string             `json:"strokeDasharray,omitempty"`
	TextAlign       *string             `json:"textAlign,omitempty"`
	VerticalAlign   *string             `json:"verticalAlign,omitempty"`
	StartConnection *DrawingConnection  `json:"startConnection,omitempty"`
	EndConnection   *DrawingConnection  `json:"endConnection,omitempty"`
	ArrowEnd        *string             `json:"arrowEnd,omitempty"`
	ArrowStart      *string             `json:"arrowStart,omitempty"`
	Label           *string             `json:"label,omitempty"`
	LabelT          *float64            `json:"labelT,omitempty"`
	IsGroup         *bool               `json:"isGroup,omitempty"`
}

// Apply merges non-nil fields from the patch into the element.
func (p *DrawingPatch) Apply(el *DrawingElement) {
	if p.Type != nil {
		el.Type = *p.Type
	}
	if p.X != nil {
		el.X = *p.X
	}
	if p.Y != nil {
		el.Y = *p.Y
	}
	if p.Width != nil {
		el.Width = *p.Width
	}
	if p.Height != nil {
		el.Height = *p.Height
	}
	if p.Points != nil {
		el.Points = p.Points
	}
	if p.Text != nil {
		el.Text = p.Text
	}
	if p.StrokeColor != nil {
		el.StrokeColor = *p.StrokeColor
	}
	if p.StrokeWidth != nil {
		el.StrokeWidth = *p.StrokeWidth
	}
	if p.BackgroundColor != nil {
		el.BackgroundColor = *p.BackgroundColor
	}
	if p.FontSize != nil {
		el.FontSize = p.FontSize
	}
	if p.Roundness != nil {
		el.Roundness = p.Roundness
	}
	if p.BorderRadius != nil {
		el.BorderRadius = p.BorderRadius
	}
	if p.FontFamily != nil {
		el.FontFamily = p.FontFamily
	}
	if p.FontWeight != nil {
		el.FontWeight = p.FontWeight
	}
	if p.TextColor != nil {
		el.TextColor = p.TextColor
	}
	if p.FillStyle != nil {
		el.FillStyle = p.FillStyle
	}
	if p.Opacity != nil {
		el.Opacity = p.Opacity
	}
	if p.StrokeDasharray != nil {
		el.StrokeDasharray = p.StrokeDasharray
	}
	if p.TextAlign != nil {
		el.TextAlign = p.TextAlign
	}
	if p.VerticalAlign != nil {
		el.VerticalAlign = p.VerticalAlign
	}
	if p.StartConnection != nil {
		el.StartConnection = p.StartConnection
	}
	if p.EndConnection != nil {
		el.EndConnection = p.EndConnection
	}
	if p.ArrowEnd != nil {
		el.ArrowEnd = p.ArrowEnd
	}
	if p.ArrowStart != nil {
		el.ArrowStart = p.ArrowStart
	}
	if p.Label != nil {
		el.Label = p.Label
	}
	if p.LabelT != nil {
		el.LabelT = p.LabelT
	}
	if p.IsGroup != nil {
		el.IsGroup = p.IsGroup
	}
}
