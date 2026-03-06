package domain

import "time"

// RenderMode determines how a canvas entity is rendered.
type RenderMode string

const (
	RenderDOM    RenderMode = "dom"    // Block plugins (React components)
	RenderCanvas RenderMode = "canvas" // Drawing shapes (WASM/Canvas2D)
)

// RenderModeForType returns the render mode for an entity type.
func RenderModeForType(t string) RenderMode {
	switch t {
	case "markdown", "drawing", "image", "database", "code", "localdb", "chart", "etl", "http":
		return RenderDOM
	default:
		return RenderCanvas
	}
}

// CanvasEntity is the unified model for all canvas objects (blocks + drawing elements).
type CanvasEntity struct {
	ID         string     `json:"id"`
	PageID     string     `json:"pageId"`
	Type       string     `json:"type"`       // "rectangle", "markdown", "code", etc.
	RenderMode RenderMode `json:"renderMode"` // "dom" or "canvas"
	ZIndex     int        `json:"zIndex"`
	X          float64    `json:"x"`
	Y          float64    `json:"y"`
	Width      float64    `json:"width"`
	Height     float64    `json:"height"`

	// DOM-mode fields (blocks)
	Content  string `json:"content,omitempty"`
	FilePath string `json:"filePath,omitempty"`

	// Canvas-mode fields (drawing shapes) — JSON blob for flexibility
	// Contains: strokeColor, strokeWidth, backgroundColor, points, connections,
	// arrowheads, text, font, opacity, fillStyle, etc.
	CanvasProps string `json:"canvasProps,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// IsDOM returns true if this entity renders as a React DOM component.
func (e *CanvasEntity) IsDOM() bool { return e.RenderMode == RenderDOM }

// IsCanvas returns true if this entity renders via Canvas2D/WASM.
func (e *CanvasEntity) IsCanvas() bool { return e.RenderMode == RenderCanvas }

// CanvasEntityPatch represents a partial update. Nil fields are not changed.
type CanvasEntityPatch struct {
	Type        *string  `json:"type,omitempty"`
	X           *float64 `json:"x,omitempty"`
	Y           *float64 `json:"y,omitempty"`
	Width       *float64 `json:"width,omitempty"`
	Height      *float64 `json:"height,omitempty"`
	ZIndex      *int     `json:"zIndex,omitempty"`
	Content     *string  `json:"content,omitempty"`
	FilePath    *string  `json:"filePath,omitempty"`
	CanvasProps *string  `json:"canvasProps,omitempty"`
}

// Apply merges non-nil fields from the patch into the entity.
func (p *CanvasEntityPatch) Apply(e *CanvasEntity) {
	if p.Type != nil {
		e.Type = *p.Type
		e.RenderMode = RenderModeForType(*p.Type)
	}
	if p.X != nil {
		e.X = *p.X
	}
	if p.Y != nil {
		e.Y = *p.Y
	}
	if p.Width != nil {
		e.Width = *p.Width
	}
	if p.Height != nil {
		e.Height = *p.Height
	}
	if p.ZIndex != nil {
		e.ZIndex = *p.ZIndex
	}
	if p.Content != nil {
		e.Content = *p.Content
	}
	if p.FilePath != nil {
		e.FilePath = *p.FilePath
	}
	if p.CanvasProps != nil {
		e.CanvasProps = *p.CanvasProps
	}
	e.UpdatedAt = time.Now()
}

// CanvasEntityPatchWithID pairs an entity ID with a patch for batch operations.
type CanvasEntityPatchWithID struct {
	ID    string            `json:"id"`
	Patch CanvasEntityPatch `json:"patch"`
}

// CanvasConnection represents a connection between two canvas entities.
type CanvasConnection struct {
	ID           string          `json:"id"`
	PageID       string          `json:"pageId"`
	FromEntityID string          `json:"fromEntityId"`
	ToEntityID   string          `json:"toEntityId"`
	FromSide     string          `json:"fromSide"`
	FromT        float64         `json:"fromT"`
	ToSide       string          `json:"toSide"`
	ToT          float64         `json:"toT"`
	Label        string          `json:"label"`
	Color        string          `json:"color"`
	Style        ConnectionStyle `json:"style"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

// CanvasEntityStore defines persistence operations for canvas entities.
type CanvasEntityStore interface {
	CreateCanvasEntity(e *CanvasEntity) error
	GetCanvasEntity(id string) (*CanvasEntity, error)
	ListCanvasEntities(pageID string) ([]CanvasEntity, error)
	UpdateCanvasEntity(e *CanvasEntity) error
	DeleteCanvasEntity(id string) error
	DeleteCanvasEntitiesByPage(pageID string) error
	BatchUpdateCanvasEntities(entities []CanvasEntity) error
	UpdateEntityZOrder(pageID string, orderedIDs []string) error
}

// CanvasConnectionStore defines persistence operations for canvas connections.
type CanvasConnectionStore interface {
	CreateCanvasConnection(c *CanvasConnection) error
	GetCanvasConnection(id string) (*CanvasConnection, error)
	ListCanvasConnections(pageID string) ([]CanvasConnection, error)
	UpdateCanvasConnection(c *CanvasConnection) error
	DeleteCanvasConnection(id string) error
	DeleteCanvasConnectionsByPage(pageID string) error
	DeleteCanvasConnectionsByEntity(entityID string) error
}
