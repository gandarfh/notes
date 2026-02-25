package etl

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"notes/internal/domain"
)

// ── Destination ────────────────────────────────────────────
// A Destination writes records into a target system.
// For now, the only destination is LocalDB.
//
// Pattern: Singer target protocol.

// SyncMode determines how records are written to the destination.
type SyncMode string

const (
	SyncReplace SyncMode = "replace" // delete all existing rows, insert fresh
	SyncAppend  SyncMode = "append"  // add rows without deleting existing
)

// Destination writes records to a target system.
type Destination interface {
	Write(ctx context.Context, targetID string, schema *Schema, records []Record, mode SyncMode) (int, error)
}

// ── LocalDB Destination ────────────────────────────────────
// Writes records into a LocalDatabase (the internal structured tables).

// LocalDBWriter implements Destination for LocalDB.
type LocalDBWriter struct {
	Store domain.LocalDatabaseStore
}

func (w *LocalDBWriter) Write(ctx context.Context, targetID string, schema *Schema, records []Record, mode SyncMode) (int, error) {
	if len(records) == 0 {
		return 0, nil
	}

	// On replace mode, delete all existing rows first.
	if mode == SyncReplace {
		if err := w.Store.DeleteRowsByDatabase(targetID); err != nil {
			return 0, fmt.Errorf("clear target: %w", err)
		}
		// Reset columns to exactly match the output schema.
		if err := w.resetColumns(targetID, schema); err != nil {
			return 0, fmt.Errorf("reset columns: %w", err)
		}
	} else {
		// Append mode: add any missing columns.
		if err := w.ensureColumns(targetID, schema); err != nil {
			return 0, fmt.Errorf("ensure columns: %w", err)
		}
	}

	// Resolve column name → column ID mapping.
	colMap, err := w.columnNameToID(targetID)
	if err != nil {
		return 0, fmt.Errorf("resolve columns: %w", err)
	}

	// Bulk insert records.
	written := 0
	for i, rec := range records {
		select {
		case <-ctx.Done():
			return written, ctx.Err()
		default:
		}

		// Map field names to column IDs.
		rowData := make(map[string]any, len(rec.Data))
		for k, v := range rec.Data {
			if colID, ok := colMap[k]; ok {
				rowData[colID] = v
			}
		}

		dataJSON, _ := json.Marshal(rowData)
		row := &domain.LocalDBRow{
			ID:         uuid.New().String(),
			DatabaseID: targetID,
			DataJSON:   string(dataJSON),
			SortOrder:  i + 1,
		}
		if err := w.Store.CreateRow(row); err != nil {
			return written, fmt.Errorf("create row %d: %w", i, err)
		}
		written++
	}

	return written, nil
}

// resetColumns replaces all columns in the LocalDB config to exactly match the schema.
// Used in replace mode so the target structure matches the transformed output.
func (w *LocalDBWriter) resetColumns(dbID string, schema *Schema) error {
	db, err := w.Store.GetDatabase(dbID)
	if err != nil {
		return err
	}

	// Parse existing config to preserve non-column fields (e.g. activeView).
	var raw map[string]any
	if err := json.Unmarshal([]byte(db.ConfigJSON), &raw); err != nil {
		raw = make(map[string]any)
	}

	// Build new columns from schema.
	cols := make([]map[string]any, 0, len(schema.Fields))
	for _, f := range schema.Fields {
		cols = append(cols, map[string]any{
			"id":    uuid.New().String(),
			"name":  f.Name,
			"type":  mapFieldType(f.Type),
			"width": 150,
		})
	}
	raw["columns"] = cols

	configBytes, _ := json.Marshal(raw)
	db.ConfigJSON = string(configBytes)
	db.UpdatedAt = time.Now()
	return w.Store.UpdateDatabase(db)
}

// ensureColumns adds any missing columns to the LocalDB config.
func (w *LocalDBWriter) ensureColumns(dbID string, schema *Schema) error {
	db, err := w.Store.GetDatabase(dbID)
	if err != nil {
		return err
	}

	var cfg struct {
		Columns    []map[string]any `json:"columns"`
		ActiveView string           `json:"activeView"`
	}
	if err := json.Unmarshal([]byte(db.ConfigJSON), &cfg); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	// Build set of existing column names.
	existing := make(map[string]bool)
	for _, col := range cfg.Columns {
		if name, ok := col["name"].(string); ok {
			existing[name] = true
		}
	}

	// Add missing fields from schema.
	for _, f := range schema.Fields {
		if existing[f.Name] {
			continue
		}
		cfg.Columns = append(cfg.Columns, map[string]any{
			"id":    uuid.New().String(),
			"name":  f.Name,
			"type":  mapFieldType(f.Type),
			"width": 150,
		})
	}

	configBytes, _ := json.Marshal(cfg)
	db.ConfigJSON = string(configBytes)
	db.UpdatedAt = time.Now()
	return w.Store.UpdateDatabase(db)
}

// columnNameToID builds a mapping from column name to column ID.
func (w *LocalDBWriter) columnNameToID(dbID string) (map[string]string, error) {
	db, err := w.Store.GetDatabase(dbID)
	if err != nil {
		return nil, err
	}

	var cfg struct {
		Columns []map[string]any `json:"columns"`
	}
	if err := json.Unmarshal([]byte(db.ConfigJSON), &cfg); err != nil {
		return nil, err
	}

	m := make(map[string]string)
	for _, col := range cfg.Columns {
		name, _ := col["name"].(string)
		id, _ := col["id"].(string)
		if name != "" && id != "" {
			m[name] = id
		}
	}
	return m, nil
}

// mapFieldType converts ETL field types to LocalDB column types.
func mapFieldType(t string) string {
	switch t {
	case "number":
		return "number"
	case "boolean":
		return "checkbox"
	case "datetime":
		return "datetime"
	default:
		return "text"
	}
}
