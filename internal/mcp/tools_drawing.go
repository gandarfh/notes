package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"notes/internal/domain"
	"notes/internal/plugins/drawing"
	"notes/internal/service"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerDrawingTools() {
	s.mcp.AddTool(mcp.NewTool("add_drawing_element",
		mcp.WithDescription(`Add a shape or text element to the drawing layer.

SEMANTIC COLORS (use backgroundColor, NOT fillColor — others silently ignored):
  Our components:    backgroundColor #1971c2, strokeColor #e8e8f0
  External systems:  backgroundColor #e8e8f0, strokeColor #828298
  Databases/Storage: backgroundColor #b2f2bb, strokeColor #2f9e44
  Sidecars/Middle:   backgroundColor #ffec99, strokeColor #f08c00
  Errors/Failures:   backgroundColor #ffc9c9, strokeColor #e03131
  Events/Async:      backgroundColor #eebefa, strokeColor #9c36b5
  HTTP Endpoints:    backgroundColor #a5d8ff, strokeColor #1971c2

LAYOUT: shapes should be 220×60. Keep 160px horizontal gap, 140px vertical gap. NEVER use width >= 600 (rendering bug).
Keep text SHORT (1-2 lines). For complex flows, use a group with multiple small shapes inside.`),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("type", mcp.Description("Element type: rectangle, ellipse, diamond, text. For group containers (bounded contexts), use add_drawing_group instead."), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("Y position"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("Width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("Height"), mcp.Required()),
		mcp.WithString("text", mcp.Description("Text content (optional)")),
		mcp.WithString("fillColor", mcp.Description("Fill/background color hex from the palette (optional, e.g. #e03131, #a5d8ff). Invalid colors will be ignored.")),
		mcp.WithString("strokeColor", mcp.Description("Stroke color hex (optional, use #e8e8f0 for best visibility)")),
		mcp.WithNumber("fontSize", mcp.Description("Font size for text: 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48. Default 16.")),
		mcp.WithNumber("fontWeight", mcp.Description("Font weight: 400 (normal), 500 (medium), 700 (bold). Default 400.")),
		mcp.WithString("fontFamily", mcp.Description("Font: 'Inter' (default), 'JetBrains Mono, monospace', 'Georgia, serif', 'Caveat, cursive'.")),
		mcp.WithString("textColor", mcp.Description("Text color hex from the palette (optional).")),
		mcp.WithString("textAlign", mcp.Description("Horizontal text alignment: 'left', 'center' (default), 'right'.")),
		mcp.WithString("verticalAlign", mcp.Description("Vertical text alignment: 'top', 'center' (default), 'bottom'.")),
		mcp.WithNumber("borderRadius", mcp.Description("Corner radius: 0 (sharp, default) or 8 (rounded). Rectangles only.")),
		mcp.WithNumber("strokeWidth", mcp.Description("Stroke width: 1, 2 (default), or 4.")),
		mcp.WithString("strokeDasharray", mcp.Description("Stroke style: '' (solid, default), '8 4' (dashed), '2 4' (dotted).")),
		mcp.WithNumber("opacity", mcp.Description("Opacity from 0.0 to 1.0. Default 1.0.")),
	), s.handleAddDrawingElement)

	s.mcp.AddTool(mcp.NewTool("add_drawing_arrow",
		mcp.WithDescription("Add an arrow connecting two elements. Auto-routes orthogonally around obstacles. Keep at least 80px gap between connected elements for readability. Arrow labels should be short (1-3 words). Use update_arrow_label to add/change labels after creation."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("fromId", mcp.Description("Source element ID"), mcp.Required()),
		mcp.WithString("toId", mcp.Description("Target element ID"), mcp.Required()),
		mcp.WithString("label", mcp.Description("Arrow label text (optional)")),
	), s.handleAddDrawingArrow)

	s.mcp.AddTool(mcp.NewTool("update_drawing_element",
		mcp.WithDescription(`Update properties of a drawing element. DO NOT pass 'id' in patchJSON.
Patchable fields: x, y, width, height, text, fillColor, strokeColor, strokeWidth (1|2|4), strokeDasharray (''|'8 4'|'2 4'), fontSize (10-48), fontWeight (400|500|700), fontFamily, textColor, textAlign, verticalAlign, borderRadius (0|8), opacity (0.0-1.0), backgroundColor.`),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementId", mcp.Description("Element ID to update"), mcp.Required()),
		mcp.WithString("patchJSON", mcp.Description("JSON object with properties to update. DO NOT pass 'id'."), mcp.Required()),
	), s.handleUpdateDrawingElement)

	s.mcp.AddTool(mcp.NewTool("move_drawing_element",
		mcp.WithDescription("Move a drawing element to new coordinates"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementId", mcp.Description("Element ID"), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("New X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("New Y position"), mcp.Required()),
	), s.handleMoveDrawingElement)

	s.mcp.AddTool(mcp.NewTool("resize_drawing_element",
		mcp.WithDescription("Resize a drawing element"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementId", mcp.Description("Element ID"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("New width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("New height"), mcp.Required()),
	), s.handleResizeDrawingElement)

	s.mcp.AddTool(mcp.NewTool("delete_drawing_element",
		mcp.WithDescription("🛑 DESTRUCTIVE: Remove a drawing element by ID. Requires user approval."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementId", mcp.Description("Element ID to delete"), mcp.Required()),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleDeleteDrawingElement)

	s.mcp.AddTool(mcp.NewTool("move_arrow_endpoint",
		mcp.WithDescription("Reconnect an arrow's start or end to a different element"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("arrowId", mcp.Description("Arrow element ID"), mcp.Required()),
		mcp.WithString("endpoint", mcp.Description("Which endpoint: 'start' or 'end'"), mcp.Required()),
		mcp.WithString("targetElementId", mcp.Description("New target element ID"), mcp.Required()),
	), s.handleMoveArrowEndpoint)

	s.mcp.AddTool(mcp.NewTool("update_arrow_label",
		mcp.WithDescription("Set or update the text label on an arrow"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("arrowId", mcp.Description("Arrow element ID"), mcp.Required()),
		mcp.WithString("label", mcp.Description("New label text"), mcp.Required()),
	), s.handleUpdateArrowLabel)

	s.mcp.AddTool(mcp.NewTool("list_drawing_elements",
		mcp.WithDescription("List all drawing elements on a page. Returns IDs, types, positions, dimensions, and a _connections object showing arrow count per side. Also returns a boundingBox summary of the entire canvas — use this to plan placement of new elements."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
	), s.handleListDrawingElements)

	s.mcp.AddTool(mcp.NewTool("clear_drawing",
		mcp.WithDescription("🛑 DESTRUCTIVE: Clear all drawing elements on a page. Requires user approval."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleClearDrawing)

	s.mcp.AddTool(mcp.NewTool("add_drawing_group",
		mcp.WithDescription(`Add a visual group/container with dashed border and label. Groups are non-obstructing: arrows pass through them freely and cannot connect to them. Use for bounded contexts, architectural layers, or logical sections. The label renders at top-left with a theme-aware background pill.
SIZING: add 40px padding on all sides around the contained elements. Example: if elements span x=100..380 y=100..260, group should be x=60 y=60 width=360 height=240.
Use #e8e8f0 for strokeColor for theme visibility.`),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("label", mcp.Description("Group label text"), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("Y position"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("Width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("Height"), mcp.Required()),
		mcp.WithString("strokeColor", mcp.Description("Border color hex (optional, default #e8e8f0)")),
	), s.handleAddDrawingGroup)

	// ── Batch operations ──────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("batch_add_drawing_elements",
		mcp.WithDescription(`Add multiple elements at once. Returns created IDs in input order. DO NOT pass 'id'.

SEMANTIC COLORS (use backgroundColor, NOT fillColor — others silently ignored):
  Our components:    backgroundColor #1971c2, strokeColor #e8e8f0
  External systems:  backgroundColor #e8e8f0, strokeColor #828298
  Databases/Storage: backgroundColor #b2f2bb, strokeColor #2f9e44
  Sidecars/Middle:   backgroundColor #ffec99, strokeColor #f08c00
  Errors/Failures:   backgroundColor #ffc9c9, strokeColor #e03131
  Events/Async:      backgroundColor #eebefa, strokeColor #9c36b5
  HTTP Endpoints:    backgroundColor #a5d8ff, strokeColor #1971c2

LAYOUT: shapes 220×60. 160px horizontal gap, 140px vertical gap. NEVER use width >= 600 (rendering bug).
Keep text SHORT (1-2 lines). For complex flows, use a group with multiple small shapes inside.

DIAGRAM PATTERN: main flow goes L→R in one row. Databases/details go BELOW, connected by vertical arrows. Each section is a separate group with 1000px+ vertical distance between sections.

STYLE FIELDS per element (all optional): backgroundColor, strokeColor, strokeWidth (1|2|4), strokeDasharray (''|'8 4'|'2 4'), fontSize (10-48), fontWeight (400|500|700), fontFamily, textColor, textAlign ('left'|'center'|'right'), verticalAlign ('top'|'center'|'bottom'), borderRadius (0|8), opacity (0.0-1.0).

EXAMPLE: [{"type":"rectangle","x":100,"y":860,"width":220,"height":60,"text":"POST /entities","backgroundColor":"#a5d8ff","strokeColor":"#1971c2","borderRadius":8},{"type":"rectangle","x":480,"y":860,"width":220,"height":60,"text":"Valida Schema","backgroundColor":"#1971c2","strokeColor":"#e8e8f0","borderRadius":8},{"type":"rectangle","x":480,"y":1060,"width":220,"height":60,"text":"config_schemas","backgroundColor":"#b2f2bb","strokeColor":"#2f9e44","borderRadius":8}]`),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elements", mcp.Description("JSON array of element objects [{type, x, y, width, height...}]. DO NOT pass 'id'."), mcp.Required()),
	), s.handleBatchAddDrawingElements)

	s.mcp.AddTool(mcp.NewTool("batch_delete_drawing_elements",
		mcp.WithDescription("🛑 DESTRUCTIVE: Delete multiple drawing elements at once with a single approval. Requires user approval."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementIds", mcp.Description("Comma-separated element IDs to delete"), mcp.Required()),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleBatchDeleteDrawingElements)

	s.mcp.AddTool(mcp.NewTool("batch_update_drawing_elements",
		mcp.WithDescription(`Update multiple drawing elements at once. Pass a JSON array of patch objects, each with 'elementId' and properties to update. DO NOT pass 'id' in the patch.
Patchable fields: x, y, width, height, text, fillColor, strokeColor, strokeWidth (1|2|4), strokeDasharray (''|'8 4'|'2 4'), fontSize (10-48), fontWeight (400|500|700), fontFamily, textColor, textAlign, verticalAlign, borderRadius (0|8), opacity (0.0-1.0), backgroundColor.`),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("patches", mcp.Description("JSON array of patch objects [{elementId, x?, y?, width?, height?...}]. DO NOT pass 'id'."), mcp.Required()),
	), s.handleBatchUpdateDrawingElements)
}

// ── Drawing data helpers ────────────────────────────────────

// Strict structs for MCP validation (Fail Fast on unknown fields)
type StrictDrawingElement struct {
	Type            string         `json:"type"`
	X               float64        `json:"x"`
	Y               float64        `json:"y"`
	Width           float64        `json:"width"`
	Height          float64        `json:"height"`
	Points          [][]float64    `json:"points,omitempty"`
	Text            *string        `json:"text,omitempty"`
	StrokeColor     *string        `json:"strokeColor,omitempty"`
	StrokeWidth     *float64       `json:"strokeWidth,omitempty"`
	BackgroundColor *string        `json:"backgroundColor,omitempty"`
	FillColor       *string        `json:"fillColor,omitempty"`
	FontSize        *float64       `json:"fontSize,omitempty"`
	Roundness       *bool          `json:"roundness,omitempty"`
	BorderRadius    *float64       `json:"borderRadius,omitempty"`
	FontFamily      *string        `json:"fontFamily,omitempty"`
	FontWeight      *float64       `json:"fontWeight,omitempty"`
	TextColor       *string        `json:"textColor,omitempty"`
	FillStyle       *string        `json:"fillStyle,omitempty"`
	Opacity         *float64       `json:"opacity,omitempty"`
	StrokeDasharray *string        `json:"strokeDasharray,omitempty"`
	TextAlign       *string        `json:"textAlign,omitempty"`
	VerticalAlign   *string        `json:"verticalAlign,omitempty"`
	StartConnection map[string]any `json:"startConnection,omitempty"`
	EndConnection   map[string]any `json:"endConnection,omitempty"`
	ArrowEnd        *string        `json:"arrowEnd,omitempty"`
	ArrowStart      *string        `json:"arrowStart,omitempty"`
	Label           *string        `json:"label,omitempty"`
	LabelT          *float64       `json:"labelT,omitempty"`
	IsGroup         *bool          `json:"isGroup,omitempty"`
}

type StrictDrawingPatch struct {
	Type            *string        `json:"type,omitempty"`
	X               *float64       `json:"x,omitempty"`
	Y               *float64       `json:"y,omitempty"`
	Width           *float64       `json:"width,omitempty"`
	Height          *float64       `json:"height,omitempty"`
	Points          [][]float64    `json:"points,omitempty"`
	Text            *string        `json:"text,omitempty"`
	StrokeColor     *string        `json:"strokeColor,omitempty"`
	StrokeWidth     *float64       `json:"strokeWidth,omitempty"`
	BackgroundColor *string        `json:"backgroundColor,omitempty"`
	FillColor       *string        `json:"fillColor,omitempty"`
	FontSize        *float64       `json:"fontSize,omitempty"`
	Roundness       *bool          `json:"roundness,omitempty"`
	BorderRadius    *float64       `json:"borderRadius,omitempty"`
	FontFamily      *string        `json:"fontFamily,omitempty"`
	FontWeight      *float64       `json:"fontWeight,omitempty"`
	TextColor       *string        `json:"textColor,omitempty"`
	FillStyle       *string        `json:"fillStyle,omitempty"`
	Opacity         *float64       `json:"opacity,omitempty"`
	StrokeDasharray *string        `json:"strokeDasharray,omitempty"`
	TextAlign       *string        `json:"textAlign,omitempty"`
	VerticalAlign   *string        `json:"verticalAlign,omitempty"`
	StartConnection map[string]any `json:"startConnection,omitempty"`
	EndConnection   map[string]any `json:"endConnection,omitempty"`
	ArrowEnd        *string        `json:"arrowEnd,omitempty"`
	ArrowStart      *string        `json:"arrowStart,omitempty"`
	Label           *string        `json:"label,omitempty"`
	LabelT          *float64       `json:"labelT,omitempty"`
	IsGroup         *bool          `json:"isGroup,omitempty"`
}

type StrictBatchPatch struct {
	ElementID       string         `json:"elementId"`
	Type            *string        `json:"type,omitempty"`
	X               *float64       `json:"x,omitempty"`
	Y               *float64       `json:"y,omitempty"`
	Width           *float64       `json:"width,omitempty"`
	Height          *float64       `json:"height,omitempty"`
	Points          [][]float64    `json:"points,omitempty"`
	Text            *string        `json:"text,omitempty"`
	StrokeColor     *string        `json:"strokeColor,omitempty"`
	StrokeWidth     *float64       `json:"strokeWidth,omitempty"`
	BackgroundColor *string        `json:"backgroundColor,omitempty"`
	FillColor       *string        `json:"fillColor,omitempty"`
	FontSize        *float64       `json:"fontSize,omitempty"`
	Roundness       *bool          `json:"roundness,omitempty"`
	BorderRadius    *float64       `json:"borderRadius,omitempty"`
	FontFamily      *string        `json:"fontFamily,omitempty"`
	FontWeight      *float64       `json:"fontWeight,omitempty"`
	TextColor       *string        `json:"textColor,omitempty"`
	FillStyle       *string        `json:"fillStyle,omitempty"`
	Opacity         *float64       `json:"opacity,omitempty"`
	StrokeDasharray *string        `json:"strokeDasharray,omitempty"`
	TextAlign       *string        `json:"textAlign,omitempty"`
	VerticalAlign   *string        `json:"verticalAlign,omitempty"`
	StartConnection map[string]any `json:"startConnection,omitempty"`
	EndConnection   map[string]any `json:"endConnection,omitempty"`
	ArrowEnd        *string        `json:"arrowEnd,omitempty"`
	ArrowStart      *string        `json:"arrowStart,omitempty"`
	Label           *string        `json:"label,omitempty"`
	LabelT          *float64       `json:"labelT,omitempty"`
	IsGroup         *bool          `json:"isGroup,omitempty"`
}


// ── Handlers ────────────────────────────────────────────────

func (s *Server) handleAddDrawingGroup(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	stroke := "#828298"
	if sc, ok := args["strokeColor"].(string); ok {
		stroke = service.SanitizeColor(sc, "#828298")
	}

	label, _ := args["label"].(string)
	x, _ := args["x"].(float64)
	y, _ := args["y"].(float64)
	w, _ := args["width"].(float64)
	h, _ := args["height"].(float64)

	el := domain.DrawingElement{
		ID:              s.drawing.GenID(),
		Type:            domain.DrawingTypeGroup,
		X:               x,
		Y:               y,
		Width:           w,
		Height:          h,
		StrokeColor:     stroke,
		StrokeWidth:     2,
		BackgroundColor: "transparent",
		Text:            &label,
	}

	// Insert at beginning so it renders behind other elements
	err = s.drawing.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		return append([]domain.DrawingElement{el}, elements...), nil
	})
	if err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return jsonResult(el)
}

func (s *Server) handleAddDrawingElement(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elType, _ := args["type"].(string)
	x, _ := args["x"].(float64)
	y, _ := args["y"].(float64)
	w, _ := args["width"].(float64)
	h, _ := args["height"].(float64)

	el := domain.DrawingElement{
		ID:              s.drawing.GenID(),
		Type:            domain.DrawingElementType(elType),
		X:               x,
		Y:               y,
		Width:           w,
		Height:          h,
		StrokeColor:     "#e8e8f0",
		StrokeWidth:     2,
		BackgroundColor: "transparent",
	}
	if text, ok := args["text"].(string); ok {
		el.Text = &text
	}
	if fill, ok := args["fillColor"].(string); ok {
		bg := service.SanitizeColor(fill, "transparent")
		el.BackgroundColor = bg
	}
	if stroke, ok := args["strokeColor"].(string); ok {
		el.StrokeColor = service.SanitizeColor(stroke, "#e8e8f0")
	}
	if v, ok := args["fontSize"].(float64); ok {
		el.FontSize = &v
	}
	if v, ok := args["fontWeight"].(float64); ok {
		el.FontWeight = &v
	}
	if v, ok := args["fontFamily"].(string); ok {
		el.FontFamily = &v
	}
	if v, ok := args["textColor"].(string); ok {
		tc := service.SanitizeColor(v, "#e8e8f0")
		el.TextColor = &tc
	}
	if v, ok := args["textAlign"].(string); ok {
		el.TextAlign = &v
	}
	if v, ok := args["verticalAlign"].(string); ok {
		el.VerticalAlign = &v
	}
	if v, ok := args["borderRadius"].(float64); ok {
		el.BorderRadius = &v
	}
	if v, ok := args["strokeWidth"].(float64); ok {
		el.StrokeWidth = v
	}
	if v, ok := args["strokeDasharray"].(string); ok {
		el.StrokeDasharray = &v
	}
	if v, ok := args["opacity"].(float64); ok {
		el.Opacity = &v
	}

	if err := s.drawing.AddElement(ctx, pageID, el); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return jsonResult(el)
}

func (s *Server) handleAddDrawingArrow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	fromID, _ := args["fromId"].(string)
	toID, _ := args["toId"].(string)

	var resultArrow domain.DrawingElement
	err = s.drawing.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		// Compute best sides based on relative position
		info := computeArrowInfo(elements, fromID, toID)

		// Distribute t-parameter to avoid overlapping arrows on same side
		srcT := connectSlot(elements, fromID, info.srcSide)
		dstT := connectSlot(elements, toID, info.dstSide)

		// Recompute anchor positions using distributed t
		srcR := elementRect(elements, fromID)
		dstR := elementRect(elements, toID)
		if srcR != nil {
			info.srcX, info.srcY = anchorPoint(*srcR, info.srcSide, srcT)
		}
		if dstR != nil {
			info.dstX, info.dstY = anchorPoint(*dstR, info.dstSide, dstT)
		}

		dx := info.dstX - info.srcX
		dy := info.dstY - info.srcY

		// Enforce minimum arrow distance — if elements too close, push anchors apart
		arrowDist := math.Sqrt(dx*dx + dy*dy)
		if arrowDist > 0 && arrowDist < minArrowDist {
			scale := minArrowDist / arrowDist
			midX := info.srcX + dx/2
			midY := info.srcY + dy/2
			info.srcX = midX - (dx/2)*scale
			info.srcY = midY - (dy/2)*scale
			info.dstX = midX + (dx/2)*scale
			info.dstY = midY + (dy/2)*scale
		}

		// Collect obstacle rects (all shapes except source/target), in arrow-local coords
		excludeIDs := map[string]bool{fromID: true, toID: true}

		// ── Multi-candidate routing ──
		type routeCandidate struct {
			srcSide, dstSide string
			srcT, dstT       float64
			srcAnchor        point
			dstAnchor        point
			points           [][]float64
			score            float64
		}

		tryRoute := func(sSide, dSide string) *routeCandidate {
			sT := connectSlot(elements, fromID, sSide)
			dT := connectSlot(elements, toID, dSide)
			var sAnchor, dAnchor point
			if srcR != nil {
				sAnchor.x, sAnchor.y = anchorPoint(*srcR, sSide, sT)
			}
			if dstR != nil {
				dAnchor.x, dAnchor.y = anchorPoint(*dstR, dSide, dT)
			}
			cdx := dAnchor.x - sAnchor.x
			cdy := dAnchor.y - sAnchor.y

			shapeObs := collectObstacleRects(elements, excludeIDs, sAnchor.x, sAnchor.y)
			arrowObs := collectArrowObstacleRects(elements, excludeIDs, sAnchor.x, sAnchor.y)

			var lsr, ldr *rect
			if srcR != nil {
				r := rect{srcR.x - sAnchor.x, srcR.y - sAnchor.y, srcR.w, srcR.h}
				lsr = &r
			}
			if dstR != nil {
				r := rect{dstR.x - sAnchor.x, dstR.y - sAnchor.y, dstR.w, dstR.h}
				ldr = &r
			}
			pts := computeOrthoRoute(cdx, cdy, sSide, dSide, lsr, ldr, shapeObs, arrowObs)

			totalLen := 0.0
			bends := 0
			crossings := 0
			for i := 1; i < len(pts); i++ {
				totalLen += math.Abs(pts[i][0]-pts[i-1][0]) + math.Abs(pts[i][1]-pts[i-1][1])
				if i >= 2 {
					dx1 := pts[i-1][0] - pts[i-2][0]
					dy1 := pts[i-1][1] - pts[i-2][1]
					dx2 := pts[i][0] - pts[i-1][0]
					dy2 := pts[i][1] - pts[i-1][1]
					if (dx1 != 0 && dy2 != 0) || (dy1 != 0 && dx2 != 0) {
						bends++
					}
				}
				for _, obs := range shapeObs {
					a := drawing.Vec2{X: pts[i-1][0], Y: pts[i-1][1]}
					b := drawing.Vec2{X: pts[i][0], Y: pts[i][1]}
					if drawing.EdgeCrossesRect(a, b, drawing.Rect{X: obs.x, Y: obs.y, W: obs.w, H: obs.h}) {
						crossings++
					}
				}
			}
			score := totalLen + float64(bends)*5 + float64(crossings)*10000
			return &routeCandidate{sSide, dSide, sT, dT, point{sAnchor.x, sAnchor.y}, point{dAnchor.x, dAnchor.y}, pts, score}
		}

		best := tryRoute(info.srcSide, info.dstSide)
		allCombos := [][2]string{
			{"bottom", "top"}, {"top", "bottom"},
			{"right", "left"}, {"left", "right"},
			{"bottom", "bottom"}, {"top", "top"},
			{"right", "right"}, {"left", "left"},
		}
		for _, combo := range allCombos {
			if combo[0] == info.srcSide && combo[1] == info.dstSide {
				continue
			}
			candidate := tryRoute(combo[0], combo[1])
			if candidate.score < best.score {
				best = candidate
			}
		}

		// Use the best route
		points := best.points

		// Compute bounding box
		w, h := 0.0, 0.0
		for _, p := range points {
			if math.Abs(p[0]) > w {
				w = math.Abs(p[0])
			}
			if math.Abs(p[1]) > h {
				h = math.Abs(p[1])
			}
		}

		arrowEnd := "arrow"
		arrowStart := "none"
		arrow := domain.DrawingElement{
			ID:              s.drawing.GenID(),
			Type:            domain.DrawingTypeOrtho,
			X:               best.srcAnchor.x,
			Y:               best.srcAnchor.y,
			Width:           w,
			Height:          h,
			StrokeColor:     "#e8e8f0",
			StrokeWidth:     2,
			BackgroundColor: "transparent",
			ArrowEnd:        &arrowEnd,
			ArrowStart:      &arrowStart,
			Points:          points,
			StartConnection: &domain.DrawingConnection{ElementID: fromID, Side: best.srcSide, T: best.srcT},
			EndConnection:   &domain.DrawingConnection{ElementID: toID, Side: best.dstSide, T: best.dstT},
		}
		if label, ok := args["label"].(string); ok {
			arrow.Label = &label
		}

		resultArrow = arrow
		return append(elements, arrow), nil
	})
	if err != nil {
		return nil, err
	}

	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return jsonResult(resultArrow)
}

// anchorPoint computes the world position on an element edge given side and t (0..1).
func anchorPoint(r rect, side string, t float64) (float64, float64) {
	switch side {
	case "top":
		return r.x + r.w*t, r.y
	case "bottom":
		return r.x + r.w*t, r.y + r.h
	case "left":
		return r.x, r.y + r.h*t
	case "right":
		return r.x + r.w, r.y + r.h*t
	}
	return r.x + r.w/2, r.y + r.h/2
}

func (s *Server) handleUpdateDrawingElement(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elementID, _ := args["elementId"].(string)
	patchStr, _ := args["patchJSON"].(string)

	// Strict validation
	dec := json.NewDecoder(strings.NewReader(patchStr))
	dec.DisallowUnknownFields()
	var strictPatch StrictDrawingPatch
	if err := dec.Decode(&strictPatch); err != nil {
		return nil, fmt.Errorf("invalid patch JSON contract (check allowed fields, do not pass 'id'): %w", err)
	}

	// Parse into domain patch, handling fillColor→backgroundColor and color sanitization
	var patch domain.DrawingPatch
	if err := parseJSON(patchStr, &patch); err != nil {
		return nil, fmt.Errorf("parse patch JSON: %w", err)
	}

	// Handle fillColor → backgroundColor mapping (not in domain.DrawingPatch)
	var rawPatch map[string]any
	parseJSON(patchStr, &rawPatch)
	if fc, ok := rawPatch["fillColor"].(string); ok {
		bg := service.SanitizeColor(fc, "transparent")
		patch.BackgroundColor = &bg
	}

	// Sanitize color fields
	if patch.BackgroundColor != nil {
		bg := service.SanitizeColor(*patch.BackgroundColor, "transparent")
		patch.BackgroundColor = &bg
	}
	if patch.StrokeColor != nil {
		sc := service.SanitizeColor(*patch.StrokeColor, "#e8e8f0")
		patch.StrokeColor = &sc
	}
	if patch.TextColor != nil {
		tc := service.SanitizeColor(*patch.TextColor, "#e8e8f0")
		patch.TextColor = &tc
	}

	if err := s.drawing.UpdateElement(ctx, pageID, elementID, patch); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Element %s updated", elementID)), nil
}

func (s *Server) handleMoveDrawingElement(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elementID, _ := args["elementId"].(string)
	x, _ := args["x"].(float64)
	y, _ := args["y"].(float64)

	if err := s.drawing.MoveElement(ctx, pageID, elementID, x, y); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Element %s moved", elementID)), nil
}

func (s *Server) handleResizeDrawingElement(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elementID, _ := args["elementId"].(string)
	w, _ := args["width"].(float64)
	h, _ := args["height"].(float64)

	if err := s.drawing.ResizeElement(ctx, pageID, elementID, w, h); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Element %s resized", elementID)), nil
}

func (s *Server) handleDeleteDrawingElement(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}
	elementID, _ := args["elementId"].(string)

	// Look up element details for meaningful approval description
	el, _ := s.drawing.FindElement(pageID, elementID)
	desc := fmt.Sprintf("Delete element %s", elementID)
	if el != nil {
		name := ""
		if el.Text != nil {
			name = *el.Text
		}
		if name == "" && el.Label != nil {
			name = *el.Label
		}
		if name != "" {
			desc = fmt.Sprintf("%s \"%s\"", el.Type, name)
		} else {
			desc = fmt.Sprintf("%s (%s)", el.Type, elementID)
		}
	}

	meta := fmt.Sprintf(`{"elementIds":["%s"]}`, elementID)
	approved, err := s.approval.Request("delete_drawing_element", desc, meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	if err := s.drawing.DeleteElement(ctx, pageID, elementID); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Element %s deleted", elementID)), nil
}

func (s *Server) handleMoveArrowEndpoint(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	arrowID, _ := args["arrowId"].(string)
	endpoint, _ := args["endpoint"].(string)
	targetID, _ := args["targetElementId"].(string)

	conn := &domain.DrawingConnection{ElementID: targetID}
	var patch domain.DrawingPatch
	switch strings.ToLower(endpoint) {
	case "start":
		patch.StartConnection = conn
	case "end":
		patch.EndConnection = conn
	default:
		return nil, fmt.Errorf("endpoint must be 'start' or 'end', got %q", endpoint)
	}

	if err := s.drawing.UpdateElement(ctx, pageID, arrowID, patch); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Arrow %s %s endpoint moved to %s", arrowID, endpoint, targetID)), nil
}

func (s *Server) handleUpdateArrowLabel(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	arrowID, _ := args["arrowId"].(string)
	label, _ := args["label"].(string)

	patch := domain.DrawingPatch{Label: &label}
	if err := s.drawing.UpdateElement(ctx, pageID, arrowID, patch); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Arrow %s label set to %q", arrowID, label)), nil
}

func (s *Server) handleListDrawingElements(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elements, err := s.drawing.GetElements(pageID)
	if err != nil {
		return nil, err
	}

	// Build connection counts per element/side for smarter placement
	connCounts := map[string]map[string]int{} // elementID -> side -> count
	for _, el := range elements {
		if !el.IsArrowElement() {
			continue
		}
		if sc := el.StartConnection; sc != nil {
			if connCounts[sc.ElementID] == nil {
				connCounts[sc.ElementID] = map[string]int{}
			}
			connCounts[sc.ElementID][sc.Side]++
		}
		if ec := el.EndConnection; ec != nil {
			if connCounts[ec.ElementID] == nil {
				connCounts[ec.ElementID] = map[string]int{}
			}
			connCounts[ec.ElementID][ec.Side]++
		}
	}

	// Build annotated element list: marshal each element and add _connections
	annotated := make([]map[string]any, 0, len(elements))
	for _, el := range elements {
		// Marshal domain element to map for annotation
		data, _ := json.Marshal(el)
		var m map[string]any
		json.Unmarshal(data, &m)
		if counts, ok := connCounts[el.ID]; ok && !el.IsArrowElement() {
			m["_connections"] = counts
		}
		annotated = append(annotated, m)
	}

	// Compute overall bounding box (non-arrow elements only)
	var minX, minY, maxX, maxY float64
	first := true
	for _, el := range elements {
		if el.IsArrowElement() {
			continue
		}
		if first {
			minX, minY = el.X, el.Y
			maxX, maxY = el.X+el.Width, el.Y+el.Height
			first = false
		} else {
			if el.X < minX {
				minX = el.X
			}
			if el.Y < minY {
				minY = el.Y
			}
			if el.X+el.Width > maxX {
				maxX = el.X + el.Width
			}
			if el.Y+el.Height > maxY {
				maxY = el.Y + el.Height
			}
		}
	}

	result := map[string]any{
		"elements": annotated,
		"boundingBox": map[string]float64{
			"minX": minX, "minY": minY, "maxX": maxX, "maxY": maxY,
			"width": maxX - minX, "height": maxY - minY,
		},
		"totalElements": len(elements),
	}

	return jsonResult(result)
}

func (s *Server) handleClearDrawing(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elements, _ := s.drawing.GetElements(pageID)
	count := len(elements)

	// Collect all element IDs for highlight metadata
	ids := make([]string, 0, len(elements))
	for _, el := range elements {
		ids = append(ids, fmt.Sprintf(`"%s"`, el.ID))
	}
	meta := fmt.Sprintf(`{"elementIds":[%s]}`, strings.Join(ids, ","))

	approved, err := s.approval.Request("clear_drawing",
		fmt.Sprintf("Clear all %d elements from drawing", count), meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	if err := s.drawing.ClearAll(ctx, pageID); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult("Drawing cleared"), nil
}

// ── Batch handlers ──────────────────────────────────────────

func (s *Server) handleBatchAddDrawingElements(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elementsJSON, _ := args["elements"].(string)

	// Strict validation
	dec := json.NewDecoder(strings.NewReader(elementsJSON))
	dec.DisallowUnknownFields()
	var strictElements []StrictDrawingElement
	if err := dec.Decode(&strictElements); err != nil {
		return nil, fmt.Errorf("invalid elements JSON contract (check allowed fields, do not pass 'id'): %w", err)
	}

	// Parse into domain elements
	var newElements []domain.DrawingElement
	if err := parseJSON(elementsJSON, &newElements); err != nil {
		return nil, fmt.Errorf("invalid elements JSON: %w", err)
	}

	// Also parse raw for fillColor→backgroundColor mapping
	var rawElements []map[string]any
	parseJSON(elementsJSON, &rawElements)

	// Enforce minimum gap (80px) between non-arrow elements
	const minGap = 80.0
	for i := 1; i < len(newElements); i++ {
		ei := &newElements[i]
		if ei.IsArrowElement() || ei.Type == domain.DrawingTypeLine {
			continue
		}
		if ei.IsGroupElement() {
			continue
		}

		for j := 0; j < i; j++ {
			ej := &newElements[j]
			if ej.IsArrowElement() || ej.Type == domain.DrawingTypeLine {
				continue
			}
			if ej.IsGroupElement() {
				continue
			}
			// Skip if j is a container (much larger than i)
			if ej.Width*ej.Height > ei.Width*ei.Height*4 {
				continue
			}

			// Compute edge-to-edge gaps
			gapX := 0.0
			if ei.X+ei.Width <= ej.X {
				gapX = ej.X - (ei.X + ei.Width)
			} else if ej.X+ej.Width <= ei.X {
				gapX = ei.X - (ej.X + ej.Width)
			}
			gapY := 0.0
			if ei.Y+ei.Height <= ej.Y {
				gapY = ej.Y - (ei.Y + ei.Height)
			} else if ej.Y+ej.Height <= ei.Y {
				gapY = ei.Y - (ej.Y + ej.Height)
			}

			needsFixX := gapX < minGap && (ei.Y < ej.Y+ej.Height && ei.Y+ei.Height > ej.Y)
			needsFixY := gapY < minGap && (ei.X < ej.X+ej.Width && ei.X+ei.Width > ej.X)

			if needsFixX {
				if ei.X+ei.Width/2 >= ej.X+ej.Width/2 {
					ei.X = ej.X + ej.Width + minGap
				} else {
					ei.X = ej.X - ei.Width - minGap
				}
			}
			if needsFixY && !needsFixX {
				if ei.Y+ei.Height/2 >= ej.Y+ej.Height/2 {
					ei.Y = ej.Y + ej.Height + minGap
				} else {
					ei.Y = ej.Y - ei.Height - minGap
				}
			}
		}
	}

	// Assign IDs, defaults, and sanitize colors
	var created []string
	for i := range newElements {
		el := &newElements[i]
		el.ID = s.drawing.GenID()

		if el.StrokeWidth == 0 {
			el.StrokeWidth = 2
		}
		if el.BorderRadius == nil {
			br := 8.0
			el.BorderRadius = &br
		}
		if el.FillStyle == nil {
			fs := "solid"
			el.FillStyle = &fs
		}
		if el.Roundness == nil {
			el.Roundness = boolPtr(true)
		}

		// Handle fillColor → backgroundColor from raw JSON
		if i < len(rawElements) {
			if fc, ok := rawElements[i]["fillColor"].(string); ok && el.BackgroundColor == "" {
				el.BackgroundColor = service.SanitizeColor(fc, "transparent")
			}
		}
		if el.BackgroundColor != "" {
			el.BackgroundColor = service.SanitizeColor(el.BackgroundColor, "transparent")
		}
		if el.StrokeColor != "" {
			el.StrokeColor = service.SanitizeColor(el.StrokeColor, "#e8e8f0")
		}
		if el.TextColor != nil {
			tc := service.SanitizeColor(*el.TextColor, "#e8e8f0")
			el.TextColor = &tc
		}

		created = append(created, el.ID)
	}

	if err := s.drawing.AddElements(ctx, pageID, newElements); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})

	result, _ := json.Marshal(map[string]any{
		"created": created,
		"count":   len(created),
	})
	return textResult(string(result)), nil
}

func (s *Server) handleBatchDeleteDrawingElements(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	idsStr, _ := args["elementIds"].(string)
	ids := splitIDs(idsStr)
	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}

	// Build description with element names
	elements, err := s.drawing.GetElements(pageID)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, el := range elements {
		if !idSet[el.ID] {
			continue
		}
		name := ""
		if el.Text != nil {
			name = *el.Text
		}
		if name == "" && el.Label != nil {
			name = *el.Label
		}
		if name != "" {
			names = append(names, fmt.Sprintf("%s \"%s\"", el.Type, name))
		} else {
			names = append(names, fmt.Sprintf("%s (%s)", el.Type, el.ID))
		}
	}

	desc := fmt.Sprintf("Delete %d elements: %s", len(ids), strings.Join(names, ", "))
	if len(desc) > 200 {
		desc = fmt.Sprintf("Delete %d elements", len(ids))
	}

	var quotedIDs []string
	for _, id := range ids {
		quotedIDs = append(quotedIDs, fmt.Sprintf(`"%s"`, id))
	}
	meta := fmt.Sprintf(`{"elementIds":[%s]}`, strings.Join(quotedIDs, ","))

	approved, err := s.approval.Request("batch_delete_drawing_elements", desc, meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	if err := s.drawing.DeleteElements(ctx, pageID, ids); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Deleted %d elements", len(ids))), nil
}

func (s *Server) handleBatchUpdateDrawingElements(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	patchesJSON, _ := args["patches"].(string)

	// Strict validation
	dec := json.NewDecoder(strings.NewReader(patchesJSON))
	dec.DisallowUnknownFields()
	var strictPatches []StrictBatchPatch
	if err := dec.Decode(&strictPatches); err != nil {
		return nil, fmt.Errorf("invalid patches JSON contract (check allowed fields, do not pass 'id'): %w", err)
	}

	// Parse raw patches for fillColor→backgroundColor mapping and color sanitization
	var rawPatches []map[string]any
	if err := parseJSON(patchesJSON, &rawPatches); err != nil {
		return nil, fmt.Errorf("invalid patches JSON: %w", err)
	}

	// Build domain patches indexed by elementId
	domainPatches := make(map[string]domain.DrawingPatch, len(rawPatches))
	for _, raw := range rawPatches {
		id, _ := raw["elementId"].(string)
		if id == "" {
			continue
		}

		// Re-serialize without elementId to parse into DrawingPatch
		patchBytes, _ := json.Marshal(raw)
		var patch domain.DrawingPatch
		json.Unmarshal(patchBytes, &patch)

		// Handle fillColor → backgroundColor mapping
		if fc, ok := raw["fillColor"].(string); ok {
			bg := service.SanitizeColor(fc, "transparent")
			patch.BackgroundColor = &bg
		}
		if patch.BackgroundColor != nil {
			bg := service.SanitizeColor(*patch.BackgroundColor, "transparent")
			patch.BackgroundColor = &bg
		}
		if patch.StrokeColor != nil {
			sc := service.SanitizeColor(*patch.StrokeColor, "#e8e8f0")
			patch.StrokeColor = &sc
		}
		if patch.TextColor != nil {
			tc := service.SanitizeColor(*patch.TextColor, "#e8e8f0")
			patch.TextColor = &tc
		}

		domainPatches[id] = patch
	}

	if err := s.drawing.UpdateElements(ctx, pageID, domainPatches); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Updated %d elements", len(domainPatches))), nil
}
