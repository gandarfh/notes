package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"notes/internal/domain"
)

// MigrateToCanvasEntities copies existing blocks, drawing elements, and connections
// into the unified canvas_entities and canvas_connections tables.
// This is idempotent — it skips pages that already have canvas_entities.
func (db *DB) MigrateToCanvasEntities() error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Get all pages
	pages, err := tx.Query(`SELECT id, drawing_data FROM pages`)
	if err != nil {
		return fmt.Errorf("query pages: %w", err)
	}

	type pageData struct {
		id          string
		drawingData string
	}
	var allPages []pageData
	for pages.Next() {
		var p pageData
		if err := pages.Scan(&p.id, &p.drawingData); err != nil {
			pages.Close()
			return fmt.Errorf("scan page: %w", err)
		}
		allPages = append(allPages, p)
	}
	pages.Close()
	if err := pages.Err(); err != nil {
		return err
	}

	now := time.Now()

	for _, page := range allPages {
		// Skip pages that already have canvas_entities
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM canvas_entities WHERE page_id = ?`, page.id).Scan(&count); err != nil {
			return fmt.Errorf("count entities for page %s: %w", page.id, err)
		}
		if count > 0 {
			continue
		}

		zIndex := 0

		// 1. Migrate drawing elements (lower z-index)
		if page.drawingData != "" {
			var elements []domain.DrawingElement
			if err := json.Unmarshal([]byte(page.drawingData), &elements); err == nil {
				for _, el := range elements {
					canvasProps, _ := json.Marshal(drawingElementToCanvasProps(el))
					_, err := tx.Exec(
						`INSERT INTO canvas_entities (id, page_id, type, render_mode, z_index, x, y, width, height, content, file_path, canvas_props, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?)`,
						el.ID, page.id, string(el.Type), domain.RenderCanvas, zIndex,
						el.X, el.Y, el.Width, el.Height, string(canvasProps), now, now,
					)
					if err != nil {
						return fmt.Errorf("insert drawing entity %s: %w", el.ID, err)
					}
					zIndex++
				}
			}
		}

		// 2. Migrate blocks (higher z-index, above drawings)
		blockZBase := 1000
		blocks, err := tx.Query(
			`SELECT id, type, x, y, width, height, content, file_path, style_json, created_at, updated_at
			 FROM blocks WHERE page_id = ? ORDER BY created_at ASC`, page.id,
		)
		if err != nil {
			return fmt.Errorf("query blocks for page %s: %w", page.id, err)
		}
		blockIdx := 0
		for blocks.Next() {
			var b domain.Block
			if err := blocks.Scan(&b.ID, &b.Type, &b.X, &b.Y, &b.Width, &b.Height,
				&b.Content, &b.FilePath, &b.StyleJSON, &b.CreatedAt, &b.UpdatedAt); err != nil {
				blocks.Close()
				return fmt.Errorf("scan block: %w", err)
			}
			_, err := tx.Exec(
				`INSERT INTO canvas_entities (id, page_id, type, render_mode, z_index, x, y, width, height, content, file_path, canvas_props, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
				b.ID, page.id, string(b.Type), domain.RenderDOM, blockZBase+blockIdx,
				b.X, b.Y, b.Width, b.Height, b.Content, b.FilePath, b.CreatedAt, b.UpdatedAt,
			)
			if err != nil {
				blocks.Close()
				return fmt.Errorf("insert block entity %s: %w", b.ID, err)
			}
			blockIdx++
		}
		blocks.Close()
		if err := blocks.Err(); err != nil {
			return err
		}

		// 3. Migrate connections → canvas_connections
		conns, err := tx.Query(
			`SELECT id, from_block_id, to_block_id, label, color, style, created_at, updated_at
			 FROM connections WHERE page_id = ?`, page.id,
		)
		if err != nil {
			// connections table might be empty, that's fine
			if err != sql.ErrNoRows {
				return fmt.Errorf("query connections for page %s: %w", page.id, err)
			}
		}
		if conns != nil {
			for conns.Next() {
				var c struct {
					id, fromID, toID, label, color, style string
					createdAt, updatedAt                   time.Time
				}
				if err := conns.Scan(&c.id, &c.fromID, &c.toID, &c.label, &c.color, &c.style, &c.createdAt, &c.updatedAt); err != nil {
					conns.Close()
					return fmt.Errorf("scan connection: %w", err)
				}
				_, err := tx.Exec(
					`INSERT INTO canvas_connections (id, page_id, from_entity_id, to_entity_id, from_side, from_t, to_side, to_t, label, color, style, created_at, updated_at)
					 VALUES (?, ?, ?, ?, '', 0.5, '', 0.5, ?, ?, ?, ?, ?)`,
					c.id, page.id, c.fromID, c.toID, c.label, c.color, c.style, c.createdAt, c.updatedAt,
				)
				if err != nil {
					conns.Close()
					return fmt.Errorf("insert canvas connection %s: %w", c.id, err)
				}
			}
			conns.Close()
		}
	}

	return tx.Commit()
}

// drawingElementToCanvasProps extracts drawing-specific fields into a JSON-serializable map.
func drawingElementToCanvasProps(el domain.DrawingElement) map[string]any {
	props := map[string]any{
		"strokeColor":     el.StrokeColor,
		"strokeWidth":     el.StrokeWidth,
		"backgroundColor": el.BackgroundColor,
	}
	if el.Points != nil {
		props["points"] = el.Points
	}
	if el.Text != nil {
		props["text"] = *el.Text
	}
	if el.FontSize != nil {
		props["fontSize"] = *el.FontSize
	}
	if el.FontFamily != nil {
		props["fontFamily"] = *el.FontFamily
	}
	if el.FontWeight != nil {
		props["fontWeight"] = *el.FontWeight
	}
	if el.TextColor != nil {
		props["textColor"] = *el.TextColor
	}
	if el.TextAlign != nil {
		props["textAlign"] = *el.TextAlign
	}
	if el.VerticalAlign != nil {
		props["verticalAlign"] = *el.VerticalAlign
	}
	if el.Roundness != nil {
		props["roundness"] = *el.Roundness
	}
	if el.BorderRadius != nil {
		props["borderRadius"] = *el.BorderRadius
	}
	if el.FillStyle != nil {
		props["fillStyle"] = *el.FillStyle
	}
	if el.Opacity != nil {
		props["opacity"] = *el.Opacity
	}
	if el.StrokeDasharray != nil {
		props["strokeDasharray"] = *el.StrokeDasharray
	}
	if el.StartConnection != nil {
		props["startConnection"] = el.StartConnection
	}
	if el.EndConnection != nil {
		props["endConnection"] = el.EndConnection
	}
	if el.ArrowEnd != nil {
		props["arrowEnd"] = *el.ArrowEnd
	}
	if el.ArrowStart != nil {
		props["arrowStart"] = *el.ArrowStart
	}
	if el.Label != nil {
		props["label"] = *el.Label
	}
	if el.LabelT != nil {
		props["labelT"] = *el.LabelT
	}
	return props
}
