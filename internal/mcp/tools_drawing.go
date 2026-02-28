package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerDrawingTools() {
	s.mcp.AddTool(mcp.NewTool("add_drawing_element",
		mcp.WithDescription("Add a shape or text element to the drawing layer"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("type", mcp.Description("Element type: rectangle, ellipse, diamond, text"), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("Y position"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("Width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("Height"), mcp.Required()),
		mcp.WithString("text", mcp.Description("Text content (optional)")),
		mcp.WithString("fillColor", mcp.Description("Fill color hex (optional, e.g. #3b82f6)")),
		mcp.WithString("strokeColor", mcp.Description("Stroke color hex (optional)")),
	), s.handleAddDrawingElement)

	s.mcp.AddTool(mcp.NewTool("add_drawing_arrow",
		mcp.WithDescription("Add an arrow connecting two elements"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("fromId", mcp.Description("Source element ID"), mcp.Required()),
		mcp.WithString("toId", mcp.Description("Target element ID"), mcp.Required()),
		mcp.WithString("label", mcp.Description("Arrow label text (optional)")),
	), s.handleAddDrawingArrow)

	s.mcp.AddTool(mcp.NewTool("update_drawing_element",
		mcp.WithDescription("Update properties of a drawing element"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementId", mcp.Description("Element ID to update"), mcp.Required()),
		mcp.WithString("patchJSON", mcp.Description("JSON object with properties to update (x, y, width, height, text, fillColor, strokeColor)"), mcp.Required()),
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
		mcp.WithDescription("Add a visual group/container with dashed border and label (for organizing related elements)"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("label", mcp.Description("Group label text"), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("Y position"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("Width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("Height"), mcp.Required()),
		mcp.WithString("strokeColor", mcp.Description("Border color hex (optional, default #64748b)")),
	), s.handleAddDrawingGroup)

	// ── Batch operations ──────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("batch_add_drawing_elements",
		mcp.WithDescription("Add multiple drawing elements at once. Pass a JSON array of element objects (each with type, x, y, width, height, and optional text, fillColor, strokeColor)."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elements", mcp.Description("JSON array of element objects [{type, x, y, width, height, text?, fillColor?, strokeColor?}, ...]"), mcp.Required()),
	), s.handleBatchAddDrawingElements)

	s.mcp.AddTool(mcp.NewTool("batch_delete_drawing_elements",
		mcp.WithDescription("🛑 DESTRUCTIVE: Delete multiple drawing elements at once with a single approval. Requires user approval."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("elementIds", mcp.Description("Comma-separated element IDs to delete"), mcp.Required()),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleBatchDeleteDrawingElements)

	s.mcp.AddTool(mcp.NewTool("batch_update_drawing_elements",
		mcp.WithDescription("Update multiple drawing elements at once. Pass a JSON array of patch objects (each with elementId and properties to update: x, y, width, height, text, fillColor, strokeColor)."),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("patches", mcp.Description("JSON array of patch objects [{elementId, x?, y?, width?, height?, text?, fillColor?, strokeColor?}, ...]"), mcp.Required()),
	), s.handleBatchUpdateDrawingElements)
}

// ── Drawing data helpers ────────────────────────────────────

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
	if err := json.Unmarshal([]byte(state.Page.DrawingData), &elements); err != nil {
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

	stroke := "#64748b"
	if sc, ok := args["strokeColor"].(string); ok {
		stroke = sc
	}

	el := drawingElement{
		"id":              genDrawingID(),
		"type":            "rectangle",
		"x":               args["x"],
		"y":               args["y"],
		"width":           args["width"],
		"height":          args["height"],
		"strokeColor":     stroke,
		"strokeWidth":     float64(2),
		"backgroundColor": "transparent",
		"text":            args["label"],
		"strokeDasharray": "8 4",
		"opacity":         0.7,
		"isGroup":         true,
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
		"strokeColor":     "#1e1e1e",
		"strokeWidth":     float64(2),
		"backgroundColor": "transparent",
	}
	if text, ok := args["text"].(string); ok {
		el["text"] = text
	}
	if fill, ok := args["fillColor"].(string); ok {
		el["backgroundColor"] = fill
	}
	if stroke, ok := args["strokeColor"].(string); ok {
		el["strokeColor"] = stroke
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

	// Collect obstacle rects (all shapes except source/target), in arrow-local coords
	excludeIDs := map[string]bool{fromID: true, toID: true}
	obstacles := collectObstacleRects(elements, excludeIDs, info.srcX, info.srcY)

	// Convert source/target rects to arrow-local coords for routing
	var localSrcRect, localDstRect *rect
	if srcR != nil {
		r := rect{srcR.x - info.srcX, srcR.y - info.srcY, srcR.w, srcR.h}
		localSrcRect = &r
	}
	if dstR != nil {
		r := rect{dstR.x - info.srcX, dstR.y - info.srcY, dstR.w, dstR.h}
		localDstRect = &r
	}

	// Compute obstacle-aware ortho route
	points := computeOrthoRoute(dx, dy, info.srcSide, info.dstSide, localSrcRect, localDstRect, obstacles)

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
		"strokeColor":     "#1e1e1e",
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

	elements, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
	}

	idx, el := findElement(elements, elementID)
	if idx == -1 {
		return nil, fmt.Errorf("element %s not found", elementID)
	}

	var patch map[string]any
	if err := json.Unmarshal([]byte(patchStr), &patch); err != nil {
		return nil, fmt.Errorf("parse patch JSON: %w", err)
	}
	for k, v := range patch {
		el[k] = v
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
	var newElements []drawingElement
	if err := json.Unmarshal([]byte(elementsJSON), &newElements); err != nil {
		return nil, fmt.Errorf("invalid elements JSON: %w", err)
	}

	existing, err := s.getDrawingElements(pageID)
	if err != nil {
		return nil, err
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
				newElements[i]["backgroundColor"] = fc
				delete(newElements[i], "fillColor")
			}
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
	var patches []map[string]any
	if err := json.Unmarshal([]byte(patchesJSON), &patches); err != nil {
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
				elements[i]["backgroundColor"] = v
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
