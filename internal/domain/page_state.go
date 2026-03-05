package domain

// PageState represents the complete state of a page for rendering.
// Returned to the frontend to render the full canvas.
type PageState struct {
	Page        Page         `json:"page"`
	Blocks      []Block      `json:"blocks"`
	Connections []Connection `json:"connections"`

	// Unified canvas entities (replaces Blocks + DrawingElements in new frontend)
	Entities          []CanvasEntity    `json:"entities"`
	CanvasConnections []CanvasConnection `json:"canvasConnections"`
}
