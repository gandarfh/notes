package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"notes/internal/plugins/drawing"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

// ── Valid drawing colors ────────────────────────────────────
// Must match the palette defined in frontend ColorPicker.tsx + StylePanel.tsx BG_COLORS.
var validDrawingColors = map[string]bool{
	// Grayscale
	"#1e1e2e": true, "#545475": true, "#828298": true, "#bfbfcf": true, "#e8e8f0": true,
	// Vivid
	"#e03131": true, "#f08c00": true, "#2f9e44": true, "#1971c2": true, "#9c36b5": true,
	// Pastel
	"#ffc9c9": true, "#ffec99": true, "#b2f2bb": true, "#a5d8ff": true, "#eebefa": true,
	// Special
	"transparent": true, "#343446": true,
	// Stroke defaults
	"#e0e0e0": true, "#ffffff": true, "#000000": true,
}

// sanitizeColor returns the color if it's in the palette, otherwise returns the fallback.
func sanitizeColor(color, fallback string) string {
	if color == "" {
		return fallback
	}
	normalized := strings.ToLower(strings.TrimSpace(color))
	if validDrawingColors[normalized] {
		return color
	}
	return fallback
}

func (s *Server) registerDrawingTools() {
	s.mcp.AddTool(mcp.NewTool("add_drawing_element",
		mcp.WithDescription("Add a shape or text element to the drawing layer. SAFE COLORS (theme-aware): Vivid: Red (#e03131), Orange (#f08c00), Green (#2f9e44), Blue (#1971c2), Purple (#9c36b5). Pastel: LightRed (#ffc9c9), LightYellow (#ffec99), LightGreen (#b2f2bb), LightBlue (#a5d8ff), LightPurple (#eebefa). Gray: Dark (#1e1e2e), MidDark (#545475), Mid (#828298), Light (#bfbfcf), Near-white (#e8e8f0). Special: transparent, DarkBg (#343446). Use #e8e8f0 for strokeColor to ensure visibility. Colors outside this palette will be ignored. SPACING: keep at least 80px gap between elements so arrows remain readable."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("type", mcp.Description("Element type: rectangle, ellipse, diamond, text. For group containers (bounded contexts), use add_drawing_group instead. Custom shapes: database, vm, terminal, user, cloud."), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("Y position"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("Width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("Height"), mcp.Required()),
		mcp.WithString("text", mcp.Description("Text content (optional)")),
		mcp.WithString("fillColor", mcp.Description("Fill/background color hex from the palette (optional, e.g. #e03131, #a5d8ff). Invalid colors will be ignored.")),
		mcp.WithString("strokeColor", mcp.Description("Stroke color hex (optional, use #e8e8f0 for best visibility)")),
	), s.handleAddDrawingElement)

	s.mcp.AddTool(mcp.NewTool("add_drawing_arrow",
		mcp.WithDescription("Add an arrow connecting two elements. For best readability, keep at least 80px gap between connected elements."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("fromId", mcp.Description("Source element ID"), mcp.Required()),
		mcp.WithString("toId", mcp.Description("Target element ID"), mcp.Required()),
		mcp.WithString("label", mcp.Description("Arrow label text (optional)")),
	), s.handleAddDrawingArrow)

	s.mcp.AddTool(mcp.NewTool("update_drawing_element",
		mcp.WithDescription("Update properties of a drawing element. DO NOT pass 'id' in the patchJSON."),
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
		mcp.WithDescription("List all drawing elements on a page with their IDs, types, and positions"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
	), s.handleListDrawingElements)

	s.mcp.AddTool(mcp.NewTool("clear_drawing",
		mcp.WithDescription("🛑 DESTRUCTIVE: Clear all drawing elements on a page. Requires user approval."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleClearDrawing)

	s.mcp.AddTool(mcp.NewTool("add_drawing_group",
		mcp.WithDescription("Add a visual group/container with dashed border and label. Use #e8e8f0 for strokeColor for theme visibility. Groups are non-obstructing: arrows pass through them freely and cannot connect to them. Use groups for bounded contexts, architectural layers, or logical sections. The label renders at the top-left corner with an inverted theme-aware background pill."),
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
		mcp.WithDescription("Add multiple elements. DO NOT pass 'id' properties. The system auto-generates them and returns an array of the created IDs in the exact order of your input array. SAFE COLORS \u2014 Vivid: Red (#e03131), Orange (#f08c00), Green (#2f9e44), Blue (#1971c2), Purple (#9c36b5). Pastel: LightRed (#ffc9c9), LightYellow (#ffec99), LightGreen (#b2f2bb), LightBlue (#a5d8ff), LightPurple (#eebefa). Gray: Dark (#1e1e2e), MidDark (#545475), Mid (#828298), Light (#bfbfcf), Near-white (#e8e8f0). Special: transparent, DarkBg (#343446). Use #e8e8f0 for strokeColor. Colors outside this palette will be ignored. SPACING: keep at least 80px gap between elements so arrows remain readable."),
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
		mcp.WithDescription("Update multiple drawing elements at once. DO NOT pass 'id' in the patch, only pass 'elementId' and the allowed patch fields. Pass a JSON array of patch objects (each with elementId and properties to update)."),
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

type drawingElement map[string]any

func (s *Server) getDrawingElements(pageID string) ([]drawingElement, error) {
	state, err := s.notebooks.GetPageState(pageID)
	if err != nil {
		return nil, err
	}
	if state.Page.DrawingData == "" || state.Page.DrawingData == "[]" {
		return nil, nil
	}
	var elements []drawingElement
	if err := parseJSON(state.Page.DrawingData, &elements); err != nil {
		return nil, fmt.Errorf("parse drawing data: %w", err)
	}
	return elements, nil
}

func (s *Server) saveDrawingElements(pageID string, elements []drawingElement) error {
	data, err := json.Marshal(elements)
	if err != nil {
		return err
	}
	return s.notebooks.UpdateDrawingData(pageID, string(data))
}

func findElement(elements []drawingElement, id string) (int, drawingElement) {
	for i, el := range elements {
		if elID, _ := el["id"].(string); elID == id {
			return i, el
		}
	}
	return -1, nil
}

func genDrawingID() string {
	return fmt.Sprintf("el_%d_%d", time.Now().UnixMilli(), drawingIDCounter.Add(1))
}

// atomic counter for generating unique drawing IDs
var drawingIDCounter atomicCounter

type atomicCounter struct {
	v int64
}

func (c *atomicCounter) Add(delta int64) int64 {
	c.v += delta
	return c.v
}

// arrowEndpoints computes the best connection sides and anchor points for an arrow
// between two elements. Returns source/target world coordinates and sides.
type arrowInfo struct {
	srcX, srcY float64
	dstX, dstY float64
	srcSide    string
	dstSide    string
}

func computeArrowInfo(elements []drawingElement, fromID, toID string) arrowInfo {
	var srcX, srcY, srcW, srcH float64
	var dstX, dstY, dstW, dstH float64
	for _, el := range elements {
		elID, _ := el["id"].(string)
		ex, _ := el["x"].(float64)
		ey, _ := el["y"].(float64)
		ew, _ := el["width"].(float64)
		eh, _ := el["height"].(float64)
		if elID == fromID {
			srcX, srcY, srcW, srcH = ex, ey, ew, eh
		}
		if elID == toID {
			dstX, dstY, dstW, dstH = ex, ey, ew, eh
		}
	}

	srcCX, srcCY := srcX+srcW/2, srcY+srcH/2
	dstCX, dstCY := dstX+dstW/2, dstY+dstH/2
	dx := dstCX - srcCX
	dy := dstCY - srcCY

	var info arrowInfo
	// Choose best sides based on relative position
	if abs(dy) > abs(dx) {
		// Vertical — use bottom→top or top→bottom
		if dy > 0 {
			info.srcSide = "bottom"
			info.dstSide = "top"
			info.srcX = srcX + srcW/2
			info.srcY = srcY + srcH
			info.dstX = dstX + dstW/2
			info.dstY = dstY
		} else {
			info.srcSide = "top"
			info.dstSide = "bottom"
			info.srcX = srcX + srcW/2
			info.srcY = srcY
			info.dstX = dstX + dstW/2
			info.dstY = dstY + dstH
		}
	} else {
		// Horizontal — use right→left or left→right
		if dx > 0 {
			info.srcSide = "right"
			info.dstSide = "left"
			info.srcX = srcX + srcW
			info.srcY = srcY + srcH/2
			info.dstX = dstX
			info.dstY = dstY + dstH/2
		} else {
			info.srcSide = "left"
			info.dstSide = "right"
			info.srcX = srcX
			info.srcY = srcY + srcH/2
			info.dstX = dstX + dstW
			info.dstY = dstY + dstH/2
		}
	}
	return info
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// ── Handlers ────────────────────────────────────────────────

func (s *Server) handleAddDrawingGroup(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	elements, _ := s.getDrawingElements(pageID)

	stroke := "#828298"
	if sc, ok := args["strokeColor"].(string); ok {
		stroke = sanitizeColor(sc, "#828298")
	}

	el := drawingElement{
		"id":              genDrawingID(),
		"type":            "group",
		"x":               args["x"],
		"y":               args["y"],
		"width":           args["width"],
		"height":          args["height"],
		"strokeColor":     stroke,
		"strokeWidth":     float64(2),
		"backgroundColor": "transparent",
		"text":            args["label"],
	}

	// Insert at beginning so it renders behind other elements
	elements = append([]drawingElement{el}, elements...)
	if err := s.saveDrawingElements(pageID, elements); err != nil {
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

	elements, _ := s.getDrawingElements(pageID)

	// Build element matching frontend DrawingElement interface
	el := drawingElement{
		"id":              genDrawingID(),
		"type":            args["type"],
		"x":               args["x"],
		"y":               args["y"],
		"width":           args["width"],
		"height":          args["height"],
		"strokeColor":     "#e8e8f0",
		"strokeWidth":     float64(2),
		"backgroundColor": "transparent",
	}
	if text, ok := args["text"].(string); ok {
		el["text"] = text
	}
	if fill, ok := args["fillColor"].(string); ok {
		el["backgroundColor"] = sanitizeColor(fill, "transparent")
	}
	if stroke, ok := args["strokeColor"].(string); ok {
		el["strokeColor"] = sanitizeColor(stroke, "#e8e8f0")
	}

	elements = append(elements, el)
	if err := s.saveDrawingElements(pageID, elements); err != nil {
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

	elements, _ := s.getDrawingElements(pageID)

	fromID, _ := args["fromId"].(string)
	toID, _ := args["toId"].(string)

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
		dx = info.dstX - info.srcX
		dy = info.dstY - info.srcY
	}

	// Collect obstacle rects (all shapes except source/target), in arrow-local coords
	excludeIDs := map[string]bool{fromID: true, toID: true}

	// ── Multi-candidate routing ──
	// Try the primary side combination first. If the path is unreasonably long
	// (>3x manhattan distance), try alternative side combinations and pick shortest.

	type routeCandidate struct {
		srcSide, dstSide string
		srcT, dstT       float64
		srcAnchor        point
		dstAnchor        point
		points           [][]float64
		pathLen          float64
		bendCount        int
		score            float64 // pathLen + bendCount*5 (tie-breaker only)
	}

	// Helper: compute a full route for given sides
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

		// Collect shape obstacles + arrow obstacles separately
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

		// Compute total path length, bend count, and obstacle crossings
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
			// Check if this segment crosses any obstacle shape
			for _, obs := range shapeObs {
				a := drawing.Vec2{X: pts[i-1][0], Y: pts[i-1][1]}
				b := drawing.Vec2{X: pts[i][0], Y: pts[i][1]}
				if drawing.EdgeCrossesRect(a, b, drawing.Rect{X: obs.x, Y: obs.y, W: obs.w, H: obs.h}) {
					crossings++
				}
			}
		}
		score := totalLen + float64(bends)*5 + float64(crossings)*10000
		return &routeCandidate{sSide, dSide, sT, dT, point{sAnchor.x, sAnchor.y}, point{dAnchor.x, dAnchor.y}, pts, totalLen, bends, score}
	}

	// Always try the primary route + all common alternatives
	// This ensures the best visual path is always found
	best := tryRoute(info.srcSide, info.dstSide)

	allCombos := [][2]string{
		{"bottom", "top"},
		{"top", "bottom"},
		{"right", "left"},
		{"left", "right"},
		{"bottom", "bottom"},
		{"top", "top"},
		{"right", "right"},
		{"left", "left"},
	}
	for _, combo := range allCombos {
		if combo[0] == info.srcSide && combo[1] == info.dstSide {
			continue // skip primary, already tried
		}
		candidate := tryRoute(combo[0], combo[1])
		if candidate.score < best.score {
			best = candidate
		}
	}

	// Use the best route
	info.srcSide = best.srcSide
	info.dstSide = best.dstSide
	srcT = best.srcT
	dstT = best.dstT
	info.srcX = best.srcAnchor.x
	info.srcY = best.srcAnchor.y
	info.dstX = best.dstAnchor.x
	info.dstY = best.dstAnchor.y
	dx = info.dstX - info.srcX
	dy = info.dstY - info.srcY
	points := best.points

	// Compute bounding box
	w, h := 0.0, 0.0
	for _, p := range points {
		if abs(p[0]) > w {
			w = abs(p[0])
		}
		if abs(p[1]) > h {
			h = abs(p[1])
		}
	}

	arrow := drawingElement{
		"id":              genDrawingID(),
		"type":            "ortho-arrow",
		"x":               info.srcX,
		"y":               info.srcY,
		"width":           w,
		"height":          h,
		"strokeColor":     "#e8e8f0",
		"strokeWidth":     float64(2),
		"backgroundColor": "transparent",
		"arrowEnd":        "arrow",
		"arrowStart":      "none",
		"points":          points,
		"startConnection": map[string]any{"elementId": fromID, "side": info.srcSide, "t": srcT},
		"endConnection":   map[string]any{"elementId": toID, "side": info.dstSide, "t": dstT},
	}
	if label, ok := args["label"].(string); ok {
		arrow["label"] = label
	}

	elements = append(elements, arrow)
	if err := s.saveDrawingElements(pageID, elements); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return jsonResult(arrow)
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

	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	idx, el := findElement(elements, elementID)
	if idx == -1 {
		return nil, fmt.Errorf("element %s not found", elementID)
	}

	var patch map[string]any
	if err := parseJSON(patchStr, &patch); err != nil {
		return nil, fmt.Errorf("parse patch JSON: %w", err)
	}
	for k, v := range patch {
		switch k {
		case "fillColor":
			if cs, ok := v.(string); ok {
				el["backgroundColor"] = sanitizeColor(cs, "transparent")
			}
		case "backgroundColor":
			if cs, ok := v.(string); ok {
				el[k] = sanitizeColor(cs, "transparent")
			}
		case "strokeColor":
			if cs, ok := v.(string); ok {
				el[k] = sanitizeColor(cs, "#e8e8f0")
			}
		case "textColor":
			if cs, ok := v.(string); ok {
				el[k] = sanitizeColor(cs, "#e8e8f0")
			}
		default:
			el[k] = v
		}
	}
	elements[idx] = el

	if err := s.saveDrawingElements(pageID, elements); err != nil {
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
	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	idx, el := findElement(elements, elementID)
	if idx == -1 {
		return nil, fmt.Errorf("element %s not found", elementID)
	}

	el["x"] = args["x"]
	el["y"] = args["y"]
	elements[idx] = el

	if err := s.saveDrawingElements(pageID, elements); err != nil {
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
	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	idx, el := findElement(elements, elementID)
	if idx == -1 {
		return nil, fmt.Errorf("element %s not found", elementID)
	}

	el["width"] = args["width"]
	el["height"] = args["height"]
	elements[idx] = el

	if err := s.saveDrawingElements(pageID, elements); err != nil {
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
	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}
	desc := fmt.Sprintf("Delete element %s", elementID)
	for _, el := range elements {
		if id, _ := el["id"].(string); id == elementID {
			elType, _ := el["type"].(string)
			text, _ := el["text"].(string)
			label, _ := el["label"].(string)
			name := text
			if name == "" {
				name = label
			}
			if name != "" {
				desc = fmt.Sprintf("%s \"%s\"", elType, name)
			} else {
				desc = fmt.Sprintf("%s (%s)", elType, elementID)
			}
			break
		}
	}

	meta := fmt.Sprintf(`{"elementIds":["%s"]}`, elementID)
	approved, err := s.approval.Request("delete_drawing_element", desc, meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	filtered := make([]drawingElement, 0, len(elements))
	for _, el := range elements {
		if elID, _ := el["id"].(string); elID != elementID {
			filtered = append(filtered, el)
		}
	}

	if err := s.saveDrawingElements(pageID, filtered); err != nil {
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

	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	idx, el := findElement(elements, arrowID)
	if idx == -1 {
		return nil, fmt.Errorf("arrow %s not found", arrowID)
	}

	switch strings.ToLower(endpoint) {
	case "start":
		el["startConnection"] = map[string]any{"elementId": targetID}
	case "end":
		el["endConnection"] = map[string]any{"elementId": targetID}
	default:
		return nil, fmt.Errorf("endpoint must be 'start' or 'end', got %q", endpoint)
	}
	elements[idx] = el

	if err := s.saveDrawingElements(pageID, elements); err != nil {
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

	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	idx, el := findElement(elements, arrowID)
	if idx == -1 {
		return nil, fmt.Errorf("arrow %s not found", arrowID)
	}

	el["label"] = label
	elements[idx] = el

	if err := s.saveDrawingElements(pageID, elements); err != nil {
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

	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}
	if elements == nil {
		elements = []drawingElement{}
	}

	// Build connection counts per element/side for smarter placement
	connCounts := map[string]map[string]int{} // elementID -> side -> count
	for _, el := range elements {
		if !isArrow(el) {
			continue
		}
		if sc, ok := el["startConnection"].(map[string]any); ok {
			eid, _ := sc["elementId"].(string)
			side, _ := sc["side"].(string)
			if connCounts[eid] == nil {
				connCounts[eid] = map[string]int{}
			}
			connCounts[eid][side]++
		}
		if ec, ok := el["endConnection"].(map[string]any); ok {
			eid, _ := ec["elementId"].(string)
			side, _ := ec["side"].(string)
			if connCounts[eid] == nil {
				connCounts[eid] = map[string]int{}
			}
			connCounts[eid][side]++
		}
	}

	// Annotate elements with connection counts
	for i, el := range elements {
		if isArrow(el) {
			continue
		}
		id, _ := el["id"].(string)
		if counts, ok := connCounts[id]; ok {
			el["_connections"] = counts
			elements[i] = el
		}
	}

	// Compute overall bounding box
	var minX, minY, maxX, maxY float64
	first := true
	for _, el := range elements {
		if isArrow(el) {
			continue
		}
		x, _ := el["x"].(float64)
		y, _ := el["y"].(float64)
		w, _ := el["width"].(float64)
		h, _ := el["height"].(float64)
		if first {
			minX, minY, maxX, maxY = x, y, x+w, y+h
			first = false
		} else {
			if x < minX {
				minX = x
			}
			if y < minY {
				minY = y
			}
			if x+w > maxX {
				maxX = x + w
			}
			if y+h > maxY {
				maxY = y + h
			}
		}
	}

	result := map[string]any{
		"elements": elements,
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

	elements, _ := s.getDrawingElements(pageID)
	count := len(elements)

	// Collect all element IDs for highlight metadata
	ids := make([]string, 0, len(elements))
	for _, el := range elements {
		if id, ok := el["id"].(string); ok {
			ids = append(ids, fmt.Sprintf(`"%s"`, id))
		}
	}
	meta := fmt.Sprintf(`{"elementIds":[%s]}`, strings.Join(ids, ","))

	approved, err := s.approval.Request("clear_drawing",
		fmt.Sprintf("Clear all %d elements from drawing", count), meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	if err := s.notebooks.UpdateDrawingData(pageID, "[]"); err != nil {
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

	var newElements []drawingElement
	if err := parseJSON(elementsJSON, &newElements); err != nil {
		return nil, fmt.Errorf("invalid elements JSON: %w", err)
	}

	existing, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	// Enforce minimum gap (80px) between non-arrow elements
	const minGap = 80.0
	for i := 1; i < len(newElements); i++ {
		ti, _ := newElements[i]["type"].(string)
		if ti == "ortho-arrow" || ti == "arrow" || ti == "line" {
			continue
		}
		// Skip groups — they are containers and don't participate in spacing
		if ti == "group" {
			continue
		}
		if gi, _ := newElements[i]["isGroup"].(bool); gi {
			continue
		}
		ix, _ := newElements[i]["x"].(float64)
		iy, _ := newElements[i]["y"].(float64)
		iw, _ := newElements[i]["width"].(float64)
		ih, _ := newElements[i]["height"].(float64)

		for j := 0; j < i; j++ {
			tj, _ := newElements[j]["type"].(string)
			if tj == "ortho-arrow" || tj == "arrow" || tj == "line" {
				continue
			}
			if tj == "group" {
				continue
			}
			if gj, _ := newElements[j]["isGroup"].(bool); gj {
				continue
			}
			jx, _ := newElements[j]["x"].(float64)
			jy, _ := newElements[j]["y"].(float64)
			jw, _ := newElements[j]["width"].(float64)
			jh, _ := newElements[j]["height"].(float64)

			// Skip if j is a container (much larger than i)
			if jw*jh > iw*ih*4 {
				continue
			}

			// Compute edge-to-edge gaps
			gapX := 0.0 // horizontal gap (negative = overlap)
			if ix+iw <= jx {
				gapX = jx - (ix + iw)
			} else if jx+jw <= ix {
				gapX = ix - (jx + jw)
			}
			gapY := 0.0
			if iy+ih <= jy {
				gapY = jy - (iy + ih)
			} else if jy+jh <= iy {
				gapY = iy - (jy + jh)
			}

			// If both axes overlap or are too close, push i away
			needsFixX := gapX < minGap && (iy < jy+jh && iy+ih > jy) // vertically overlapping
			needsFixY := gapY < minGap && (ix < jx+jw && ix+iw > jx) // horizontally overlapping

			if needsFixX {
				if ix+iw/2 >= jx+jw/2 {
					// i is to the right of j — push right
					newElements[i]["x"] = jx + jw + minGap
				} else {
					// i is to the left of j — push left
					newElements[i]["x"] = jx - iw - minGap
				}
				ix, _ = newElements[i]["x"].(float64)
			}
			if needsFixY && !needsFixX {
				if iy+ih/2 >= jy+jh/2 {
					newElements[i]["y"] = jy + jh + minGap
				} else {
					newElements[i]["y"] = jy - ih - minGap
				}
			}
		}
	}

	// Assign IDs and defaults to each new element
	var created []string
	for i := range newElements {
		id := genDrawingID()
		newElements[i]["id"] = id
		if newElements[i]["strokeWidth"] == nil {
			newElements[i]["strokeWidth"] = 2
		}
		if newElements[i]["borderRadius"] == nil {
			newElements[i]["borderRadius"] = 8
		}
		if newElements[i]["fillStyle"] == nil {
			newElements[i]["fillStyle"] = "solid"
		}
		if newElements[i]["roundness"] == nil {
			newElements[i]["roundness"] = true
		}
		if newElements[i]["backgroundColor"] == nil {
			if fc, ok := newElements[i]["fillColor"].(string); ok {
				newElements[i]["backgroundColor"] = sanitizeColor(fc, "transparent")
				delete(newElements[i], "fillColor")
			}
		} else if bg, ok := newElements[i]["backgroundColor"].(string); ok {
			newElements[i]["backgroundColor"] = sanitizeColor(bg, "transparent")
		}
		if sc, ok := newElements[i]["strokeColor"].(string); ok {
			newElements[i]["strokeColor"] = sanitizeColor(sc, "#e8e8f0")
		}
		if tc, ok := newElements[i]["textColor"].(string); ok {
			newElements[i]["textColor"] = sanitizeColor(tc, "#e8e8f0")
		}
		existing = append(existing, newElements[i])
		created = append(created, id)
	}

	if err := s.saveDrawingElements(pageID, existing); err != nil {
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
	ids := strings.Split(idsStr, ",")
	for i := range ids {
		ids[i] = strings.TrimSpace(ids[i])
	}
	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}

	// Build description with element names
	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, el := range elements {
		elID, _ := el["id"].(string)
		if !idSet[elID] {
			continue
		}
		text, _ := el["text"].(string)
		label, _ := el["label"].(string)
		elType, _ := el["type"].(string)
		name := text
		if name == "" {
			name = label
		}
		if name != "" {
			names = append(names, fmt.Sprintf("%s \"%s\"", elType, name))
		} else {
			names = append(names, fmt.Sprintf("%s (%s)", elType, elID))
		}
	}

	desc := fmt.Sprintf("Delete %d elements: %s", len(ids), strings.Join(names, ", "))
	if len(desc) > 200 {
		desc = fmt.Sprintf("Delete %d elements", len(ids))
	}

	// Build metadata with element IDs
	var quotedIDs []string
	for _, id := range ids {
		quotedIDs = append(quotedIDs, fmt.Sprintf(`"%s"`, id))
	}
	meta := fmt.Sprintf(`{"elementIds":[%s]}`, strings.Join(quotedIDs, ","))

	approved, err := s.approval.Request("batch_delete_drawing_elements", desc, meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	filtered := make([]drawingElement, 0, len(elements))
	for _, el := range elements {
		elID, _ := el["id"].(string)
		if !idSet[elID] {
			filtered = append(filtered, el)
		}
	}

	if err := s.saveDrawingElements(pageID, filtered); err != nil {
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

	var patches []map[string]any
	if err := parseJSON(patchesJSON, &patches); err != nil {
		return nil, fmt.Errorf("invalid patches JSON: %w", err)
	}

	// Index patches by elementId
	patchMap := make(map[string]map[string]any, len(patches))
	for _, p := range patches {
		if id, ok := p["elementId"].(string); ok {
			patchMap[id] = p
		}
	}

	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	updated := 0
	for i, el := range elements {
		elID, _ := el["id"].(string)
		patch, ok := patchMap[elID]
		if !ok {
			continue
		}
		for k, v := range patch {
			if k == "elementId" {
				continue
			}
			if k == "fillColor" {
				if cs, ok := v.(string); ok {
					elements[i]["backgroundColor"] = sanitizeColor(cs, "transparent")
				}
			} else if k == "backgroundColor" {
				if cs, ok := v.(string); ok {
					elements[i][k] = sanitizeColor(cs, "transparent")
				}
			} else if k == "strokeColor" {
				if cs, ok := v.(string); ok {
					elements[i][k] = sanitizeColor(cs, "#e8e8f0")
				}
			} else if k == "textColor" {
				if cs, ok := v.(string); ok {
					elements[i][k] = sanitizeColor(cs, "#e8e8f0")
				}
			} else {
				elements[i][k] = v
			}
		}
		updated++
	}

	if err := s.saveDrawingElements(pageID, elements); err != nil {
		return nil, err
	}
	s.emitter.Emit(ctx, "mcp:drawing-changed", map[string]string{"pageId": pageID})
	return textResult(fmt.Sprintf("Updated %d elements", updated)), nil
}
