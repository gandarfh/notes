package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"notes/internal/domain"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerBlockTools() {
	// ── create_block ───────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("create_block",
		mcp.WithDescription("Create a new block on the canvas. Position is auto-calculated if not provided."),
		mcp.WithString("type",
			mcp.Description("Block type: markdown, code, localdb, chart, etl, http, database, image, drawing"),
			mcp.Required(),
		),
		mcp.WithString("pageId",
			mcp.Description("Page ID (optional, defaults to active page)"),
		),
		mcp.WithNumber("x", mcp.Description("X position (optional, auto-layout if omitted)")),
		mcp.WithNumber("y", mcp.Description("Y position (optional, auto-layout if omitted)")),
		mcp.WithNumber("width", mcp.Description("Width (optional, uses plugin default)")),
		mcp.WithNumber("height", mcp.Description("Height (optional, uses plugin default)")),
		mcp.WithString("content", mcp.Description("Initial content for the block (optional)")),
	), s.handleCreateBlock)

	// ── update_block_content ───────────────────────────
	s.mcp.AddTool(mcp.NewTool("update_block_content",
		mcp.WithDescription("Update the content of an existing block"),
		mcp.WithString("blockId", mcp.Description("Block ID"), mcp.Required()),
		mcp.WithString("content", mcp.Description("New content"), mcp.Required()),
	), s.handleUpdateBlockContent)

	// ── list_blocks ────────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("list_blocks",
		mcp.WithDescription("List all blocks on a page, optionally filtered by type"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithString("type", mcp.Description("Filter by block type (optional)")),
	), s.handleListBlocks)

	// ── delete_block (destructive) ─────────────────────
	s.mcp.AddTool(mcp.NewTool("delete_block",
		mcp.WithDescription("🛑 DESTRUCTIVE: Delete a block. Requires user approval."),
		mcp.WithString("blockId", mcp.Description("Block ID to delete"), mcp.Required()),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleDeleteBlock)

	// ── move_block ─────────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("move_block",
		mcp.WithDescription("Move a block to a new position on the canvas"),
		mcp.WithString("blockId", mcp.Description("Block ID"), mcp.Required()),
		mcp.WithNumber("x", mcp.Description("New X position"), mcp.Required()),
		mcp.WithNumber("y", mcp.Description("New Y position"), mcp.Required()),
	), s.handleMoveBlock)

	// ── resize_block ───────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("resize_block",
		mcp.WithDescription("Resize a block"),
		mcp.WithString("blockId", mcp.Description("Block ID"), mcp.Required()),
		mcp.WithNumber("width", mcp.Description("New width"), mcp.Required()),
		mcp.WithNumber("height", mcp.Description("New height"), mcp.Required()),
	), s.handleResizeBlock)

	// ── batch_move_blocks ──────────────────────────────
	s.mcp.AddTool(mcp.NewTool("batch_move_blocks",
		mcp.WithDescription("Move multiple blocks by a relative offset (dx, dy)"),
		mcp.WithString("blockIds",
			mcp.Description("Comma-separated block IDs"),
			mcp.Required(),
		),
		mcp.WithNumber("dx", mcp.Description("Horizontal offset"), mcp.Required()),
		mcp.WithNumber("dy", mcp.Description("Vertical offset"), mcp.Required()),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
	), s.handleBatchMoveBlocks)

	// ── batch_update_blocks ────────────────────────────
	s.mcp.AddTool(mcp.NewTool("batch_update_blocks",
		mcp.WithDescription("Update multiple blocks at once (move and/or resize). Pass a JSON array of patch objects with blockId and optional x, y, width, height."),
		mcp.WithString("patches",
			mcp.Description("JSON array of patch objects [{blockId, x?, y?, width?, height?}, ...]"),
			mcp.Required(),
		),
	), s.handleBatchUpdateBlocks)

	// ── batch_delete_blocks ────────────────────────────
	s.mcp.AddTool(mcp.NewTool("batch_delete_blocks",
		mcp.WithDescription("🛑 DESTRUCTIVE: Delete multiple blocks at once with a single approval. Requires user approval."),
		mcp.WithString("blockIds",
			mcp.Description("Comma-separated block IDs to delete"),
			mcp.Required(),
		),
		mcp.WithToolAnnotation(mcp.ToolAnnotation{DestructiveHint: boolPtr(true)}),
	), s.handleBatchDeleteBlocks)

	// ── arrange_blocks ─────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("arrange_blocks",
		mcp.WithDescription("Auto-arrange all blocks on a page using a grid layout"),
		mcp.WithString("pageId", mcp.Description("Page ID (optional, defaults to active page)")),
		mcp.WithNumber("startX", mcp.Description("Starting X position (default 0)")),
		mcp.WithNumber("startY", mcp.Description("Starting Y position (default 0)")),
	), s.handleArrangeBlocks)

	// ── swap_blocks ────────────────────────────────────
	s.mcp.AddTool(mcp.NewTool("swap_blocks",
		mcp.WithDescription("Swap positions of two blocks"),
		mcp.WithString("blockIdA", mcp.Description("First block ID"), mcp.Required()),
		mcp.WithString("blockIdB", mcp.Description("Second block ID"), mcp.Required()),
	), s.handleSwapBlocks)
}

func boolPtr(v bool) *bool { return &v }

// ── Handlers ───────────────────────────────────────────────

func (s *Server) handleCreateBlock(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	blockType, _ := args["type"].(string)
	if blockType == "" {
		return nil, fmt.Errorf("type is required")
	}

	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	// Default sizes per block type
	defaultSizes := map[string][2]float64{
		"markdown": {480, 360},
		"code":     {480, 360},
		"database": {600, 420},
		"localdb":  {600, 420},
		"chart":    {540, 420},
		"etl":      {600, 480},
		"http":     {540, 480},
		"image":    {300, 300},
		"drawing":  {480, 360},
	}

	defaults := defaultSizes[blockType]
	if defaults == [2]float64{} {
		defaults = [2]float64{480, 360} // fallback
	}

	w := getFloat(args, "width", defaults[0])
	h := getFloat(args, "height", defaults[1])

	// Auto-layout if position not provided
	x, hasX := args["x"].(float64)
	y, hasY := args["y"].(float64)
	if !hasX || !hasY {
		existing, _ := s.blocks.ListBlocks(pageID)
		x, y = s.layout.NextPosition(existing, w, h)
	}

	block, err := s.blocks.CreateBlock(pageID, blockType, x, y, w, h)
	if err != nil {
		return nil, fmt.Errorf("create block: %w", err)
	}

	// Plugin lifecycle
	if s.plugins != nil {
		_ = s.plugins.OnCreate(block.ID, pageID, blockType)
	}

	// Set initial content if provided
	if content, ok := args["content"].(string); ok && content != "" {
		if err := s.blocks.UpdateBlockContent(block.ID, content); err != nil {
			return nil, fmt.Errorf("set content: %w", err)
		}
		block.Content = content
	}

	s.emitBlocksChanged(ctx, pageID)
	return jsonResult(block)
}

func (s *Server) handleUpdateBlockContent(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	block, err := s.getBlockForTool(args)
	if err != nil {
		return nil, err
	}

	content, _ := args["content"].(string)
	if err := s.blocks.UpdateBlockContent(block.ID, content); err != nil {
		return nil, fmt.Errorf("update content: %w", err)
	}

	s.emitBlocksChanged(ctx, block.PageID)
	return textResult(fmt.Sprintf("Block %s content updated", block.ID)), nil
}

func (s *Server) handleListBlocks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	blocks, err := s.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, fmt.Errorf("list blocks: %w", err)
	}

	// Filter by type if provided
	if filterType, ok := args["type"].(string); ok && filterType != "" {
		var filtered []blockSummary
		for _, b := range blocks {
			if string(b.Type) == filterType {
				filtered = append(filtered, summarizeBlock(b))
			}
		}
		return jsonResult(filtered)
	}

	summaries := make([]blockSummary, len(blocks))
	for i, b := range blocks {
		summaries[i] = summarizeBlock(b)
	}
	return jsonResult(summaries)
}

func (s *Server) handleDeleteBlock(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	block, err := s.getBlockForTool(args)
	if err != nil {
		return nil, err
	}

	// Require approval (with metadata for frontend highlight)
	meta := fmt.Sprintf(`{"blockIds":["%s"]}`, block.ID)
	approved, err := s.approval.Request("delete_block",
		fmt.Sprintf("Delete %s block %s", block.Type, block.ID), meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	// Plugin lifecycle
	if s.plugins != nil {
		_ = s.plugins.OnDelete(block.ID, string(block.Type))
	}

	if err := s.blocks.DeleteBlock(ctx, block.ID); err != nil {
		return nil, fmt.Errorf("delete block: %w", err)
	}

	s.emitBlocksChanged(ctx, block.PageID)
	return textResult(fmt.Sprintf("Block %s deleted", block.ID)), nil
}

func (s *Server) handleMoveBlock(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	block, err := s.getBlockForTool(args)
	if err != nil {
		return nil, err
	}

	x := getFloat(args, "x", block.X)
	y := getFloat(args, "y", block.Y)

	if err := s.blocks.UpdateBlockPosition(block.ID, x, y, block.Width, block.Height); err != nil {
		return nil, fmt.Errorf("move block: %w", err)
	}

	s.emitBlocksChanged(ctx, block.PageID)
	return textResult(fmt.Sprintf("Block %s moved to (%.0f, %.0f)", block.ID, x, y)), nil
}

func (s *Server) handleResizeBlock(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	block, err := s.getBlockForTool(args)
	if err != nil {
		return nil, err
	}

	w := getFloat(args, "width", block.Width)
	h := getFloat(args, "height", block.Height)

	if err := s.blocks.UpdateBlockPosition(block.ID, block.X, block.Y, w, h); err != nil {
		return nil, fmt.Errorf("resize block: %w", err)
	}

	s.emitBlocksChanged(ctx, block.PageID)
	return textResult(fmt.Sprintf("Block %s resized to (%.0f × %.0f)", block.ID, w, h)), nil
}

func (s *Server) handleBatchMoveBlocks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	idsStr, _ := args["blockIds"].(string)
	dx := getFloat(args, "dx", 0)
	dy := getFloat(args, "dy", 0)

	ids := splitIDs(idsStr)
	if len(ids) == 0 {
		return nil, fmt.Errorf("blockIds is required")
	}

	var pageID string
	for _, id := range ids {
		block, err := s.blocks.GetBlock(id)
		if err != nil {
			return nil, fmt.Errorf("get block %s: %w", id, err)
		}
		if pageID == "" {
			pageID = block.PageID
		}
		newX := block.X + dx
		newY := block.Y + dy
		if err := s.blocks.UpdateBlockPosition(block.ID, newX, newY, block.Width, block.Height); err != nil {
			return nil, fmt.Errorf("move block %s: %w", id, err)
		}
	}

	if pageID != "" {
		s.emitBlocksChanged(ctx, pageID)
	}
	return textResult(fmt.Sprintf("Moved %d blocks by (%.0f, %.0f)", len(ids), dx, dy)), nil
}

func (s *Server) handleArrangeBlocks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	pageID, err := s.resolvePageID(args)
	if err != nil {
		return nil, err
	}

	blocks, err := s.blocks.ListBlocks(pageID)
	if err != nil {
		return nil, fmt.Errorf("list blocks: %w", err)
	}

	startX := getFloat(args, "startX", 0)
	startY := getFloat(args, "startY", 0)

	arranged := s.layout.ArrangeGroup(blocks, startX, startY)
	for _, b := range arranged {
		if err := s.blocks.UpdateBlockPosition(b.ID, b.X, b.Y, b.Width, b.Height); err != nil {
			return nil, fmt.Errorf("update position %s: %w", b.ID, err)
		}
	}

	s.emitBlocksChanged(ctx, pageID)
	return textResult(fmt.Sprintf("Arranged %d blocks", len(arranged))), nil
}

func (s *Server) handleSwapBlocks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	idA, _ := args["blockIdA"].(string)
	idB, _ := args["blockIdB"].(string)
	if idA == "" || idB == "" {
		return nil, fmt.Errorf("blockIdA and blockIdB are required")
	}

	a, err := s.blocks.GetBlock(idA)
	if err != nil {
		return nil, fmt.Errorf("get block %s: %w", idA, err)
	}
	b, err := s.blocks.GetBlock(idB)
	if err != nil {
		return nil, fmt.Errorf("get block %s: %w", idB, err)
	}

	// Swap positions
	if err := s.blocks.UpdateBlockPosition(a.ID, b.X, b.Y, a.Width, a.Height); err != nil {
		return nil, err
	}
	if err := s.blocks.UpdateBlockPosition(b.ID, a.X, a.Y, b.Width, b.Height); err != nil {
		return nil, err
	}

	s.emitBlocksChanged(ctx, a.PageID)
	return textResult(fmt.Sprintf("Swapped positions of blocks %s and %s", idA, idB)), nil
}

func (s *Server) handleBatchUpdateBlocks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	patchesJSON, _ := args["patches"].(string)

	var patches []struct {
		BlockID string   `json:"blockId"`
		X       *float64 `json:"x"`
		Y       *float64 `json:"y"`
		Width   *float64 `json:"width"`
		Height  *float64 `json:"height"`
	}
	if err := json.Unmarshal([]byte(patchesJSON), &patches); err != nil {
		return nil, fmt.Errorf("parse patches JSON: %w", err)
	}
	if len(patches) == 0 {
		return nil, fmt.Errorf("patches array is empty")
	}

	var pageID string
	for _, p := range patches {
		block, err := s.blocks.GetBlock(p.BlockID)
		if err != nil {
			return nil, fmt.Errorf("get block %s: %w", p.BlockID, err)
		}
		if pageID == "" {
			pageID = block.PageID
		}
		x, y, w, h := block.X, block.Y, block.Width, block.Height
		if p.X != nil {
			x = *p.X
		}
		if p.Y != nil {
			y = *p.Y
		}
		if p.Width != nil {
			w = *p.Width
		}
		if p.Height != nil {
			h = *p.Height
		}
		if err := s.blocks.UpdateBlockPosition(block.ID, x, y, w, h); err != nil {
			return nil, fmt.Errorf("update block %s: %w", p.BlockID, err)
		}
	}

	if pageID != "" {
		s.emitBlocksChanged(ctx, pageID)
	}
	return textResult(fmt.Sprintf("Updated %d blocks", len(patches))), nil
}

func (s *Server) handleBatchDeleteBlocks(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	idsStr, _ := args["blockIds"].(string)
	ids := splitIDs(idsStr)
	if len(ids) == 0 {
		return nil, fmt.Errorf("blockIds is required")
	}

	// Single approval for all (with metadata for frontend highlight)
	quotedIDs := make([]string, len(ids))
	for i, id := range ids {
		quotedIDs[i] = `"` + id + `"`
	}
	meta := fmt.Sprintf(`{"blockIds":[%s]}`, strings.Join(quotedIDs, ","))
	approved, err := s.approval.Request("batch_delete_blocks",
		fmt.Sprintf("Delete %d blocks: %s", len(ids), idsStr), meta)
	if err != nil || !approved {
		return textResult("Action rejected by user"), nil
	}

	var pageID string
	deleted := 0
	for _, id := range ids {
		block, err := s.blocks.GetBlock(id)
		if err != nil {
			continue // skip missing blocks
		}
		if pageID == "" {
			pageID = block.PageID
		}
		if s.plugins != nil {
			_ = s.plugins.OnDelete(block.ID, string(block.Type))
		}
		if err := s.blocks.DeleteBlock(ctx, block.ID); err != nil {
			return nil, fmt.Errorf("delete block %s: %w", id, err)
		}
		deleted++
	}

	if pageID != "" {
		s.emitBlocksChanged(ctx, pageID)
	}
	return textResult(fmt.Sprintf("Deleted %d blocks", deleted)), nil
}

// ── Helper types ───────────────────────────────────────────

type blockSummary struct {
	ID      string  `json:"id"`
	Type    string  `json:"type"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Width   float64 `json:"width"`
	Height  float64 `json:"height"`
	Preview string  `json:"preview"` // first 200 chars of content
}

func summarizeBlock(b domain.Block) blockSummary {
	preview := b.Content
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}
	return blockSummary{
		ID:      b.ID,
		Type:    string(b.Type),
		X:       b.X,
		Y:       b.Y,
		Width:   b.Width,
		Height:  b.Height,
		Preview: preview,
	}
}

func getFloat(args map[string]any, key string, fallback float64) float64 {
	if v, ok := args[key].(float64); ok {
		return v
	}
	return fallback
}

func splitIDs(s string) []string {
	if s == "" {
		return nil
	}
	var ids []string
	for _, part := range splitString(s, ',') {
		trimmed := trimSpace(part)
		if trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	return ids
}

func splitString(s string, sep byte) []string {
	var result []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	result = append(result, s[start:])
	return result
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && s[start] == ' ' {
		start++
	}
	for end > start && s[end-1] == ' ' {
		end--
	}
	return s[start:end]
}
