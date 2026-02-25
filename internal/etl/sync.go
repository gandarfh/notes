package etl

import (
	"context"
	"fmt"
	"time"
)

// ── SyncJob ────────────────────────────────────────────────
// Orchestrates: source.Read → transform chain → destination.Write.
//
// Pattern: Airbyte sync / Singer tap→target pipeline.

// SyncJob holds the configuration for a single ETL sync.
type SyncJob struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	SourceType    string            `json:"sourceType"`
	SourceCfg     SourceConfig      `json:"sourceConfig"`
	Transforms    []TransformConfig `json:"transforms,omitempty"`
	TargetDBID    string            `json:"targetDbId"`
	SyncMode      SyncMode          `json:"syncMode"`
	DedupeKey     string            `json:"dedupeKey,omitempty"`
	TriggerType   string            `json:"triggerType"`   // "manual" | "schedule" | "file_watch"
	TriggerConfig string            `json:"triggerConfig"` // cron expression or watch path
	Enabled       bool              `json:"enabled"`
	LastRunAt     time.Time         `json:"lastRunAt"`
	LastStatus    string            `json:"lastStatus"` // "success" | "error" | "running" | ""
	LastError     string            `json:"lastError"`
	CreatedAt     time.Time         `json:"createdAt"`
	UpdatedAt     time.Time         `json:"updatedAt"`
}

// TransformConfig is a declarative transform definition (stored as JSON).
type TransformConfig struct {
	Type   string         `json:"type"` // "filter" | "rename" | "select" | "dedupe"
	Config map[string]any `json:"config"`
}

// SyncResult is the outcome of running a sync job.
type SyncResult struct {
	JobID       string        `json:"jobId"`
	Status      string        `json:"status"` // "success" | "error"
	RowsRead    int           `json:"rowsRead"`
	RowsWritten int           `json:"rowsWritten"`
	Duration    time.Duration `json:"duration"`
	Error       string        `json:"error,omitempty"`
}

// SyncRunLog is a historical record of a sync run.
type SyncRunLog struct {
	ID          string    `json:"id"`
	JobID       string    `json:"jobId"`
	StartedAt   time.Time `json:"startedAt"`
	FinishedAt  time.Time `json:"finishedAt"`
	Status      string    `json:"status"`
	RowsRead    int       `json:"rowsRead"`
	RowsWritten int       `json:"rowsWritten"`
	Error       string    `json:"error,omitempty"`
}

// ── Engine ─────────────────────────────────────────────────
// The Engine orchestrates sync execution.

// Engine runs sync jobs using the registered sources and a destination.
type Engine struct {
	Dest Destination
}

// RunSync executes a sync job end-to-end.
func (e *Engine) RunSync(ctx context.Context, job *SyncJob) (*SyncResult, error) {
	start := time.Now()
	result := &SyncResult{JobID: job.ID}

	// 1. Resolve source from registry.
	source, err := GetSource(job.SourceType)
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		result.Duration = time.Since(start)
		return result, err
	}

	// 2. Discover schema (for column auto-creation).
	schema, err := source.Discover(ctx, job.SourceCfg)
	if err != nil {
		result.Status = "error"
		result.Error = fmt.Sprintf("discover: %s", err)
		result.Duration = time.Since(start)
		return result, err
	}

	// 3. Read records from source.
	recCh, errCh := source.Read(ctx, job.SourceCfg)

	// 4. Build transformer chain from config.
	transformers := buildTransformers(job.Transforms, job.DedupeKey)

	// 5. Collect + transform records.
	var records []Record
	for rec := range recCh {
		result.RowsRead++
		transformed, keep := ApplyTransformers(rec, transformers)
		if keep {
			records = append(records, transformed)
		}
	}

	// 5b. Apply batch transforms (sort).
	records = ApplyBatchSort(records, transformers)

	// Check for source errors.
	if err := <-errCh; err != nil {
		result.Status = "error"
		result.Error = fmt.Sprintf("read: %s", err)
		result.Duration = time.Since(start)
		return result, err
	}

	// 5c. Derive output schema from actual records (transforms may have changed columns).
	outputSchema := deriveSchemaFromRecords(records, schema)

	// 6. Write to destination.
	written, err := e.Dest.Write(ctx, job.TargetDBID, outputSchema, records, job.SyncMode)
	if err != nil {
		result.Status = "error"
		result.Error = fmt.Sprintf("write: %s", err)
		result.Duration = time.Since(start)
		return result, err
	}

	result.Status = "success"
	result.RowsWritten = written
	result.Duration = time.Since(start)
	return result, nil
}

// Preview executes only the source read phase and returns up to maxRows records.
func (e *Engine) Preview(ctx context.Context, sourceType string, cfg SourceConfig, maxRows int) ([]Record, *Schema, error) {
	source, err := GetSource(sourceType)
	if err != nil {
		return nil, nil, err
	}

	schema, err := source.Discover(ctx, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("discover: %w", err)
	}

	recCh, errCh := source.Read(ctx, cfg)

	var records []Record
	for rec := range recCh {
		records = append(records, rec)
		if len(records) >= maxRows {
			break
		}
	}

	// Drain remaining and check for errors.
	go func() {
		for range recCh {
		}
	}()
	if err := <-errCh; err != nil {
		return records, schema, err
	}

	return records, schema, nil
}

// buildTransformers converts declarative TransformConfig into Transformer instances.
func buildTransformers(configs []TransformConfig, dedupeKey string) []Transformer {
	var ts []Transformer

	for _, tc := range configs {
		switch tc.Type {
		case "filter":
			field, _ := tc.Config["field"].(string)
			op, _ := tc.Config["op"].(string)
			value := tc.Config["value"]
			if field != "" && op != "" {
				ts = append(ts, &FilterTransform{Field: field, Op: op, Value: value})
			}

		case "rename":
			if mapping, ok := tc.Config["mapping"].(map[string]any); ok {
				m := make(map[string]string)
				for k, v := range mapping {
					m[k] = fmt.Sprint(v)
				}
				ts = append(ts, &RenameTransform{Mapping: m})
			}

		case "select":
			if fields, ok := tc.Config["fields"].([]any); ok {
				var ff []string
				for _, f := range fields {
					ff = append(ff, fmt.Sprint(f))
				}
				ts = append(ts, &SelectTransform{Fields: ff})
			}

		case "compute":
			if columns, ok := tc.Config["columns"].([]any); ok {
				var cols []ComputeColumn
				for _, c := range columns {
					if cm, ok := c.(map[string]any); ok {
						name, _ := cm["name"].(string)
						expr, _ := cm["expression"].(string)
						if name != "" && expr != "" {
							cols = append(cols, ComputeColumn{Name: name, Expression: expr})
						}
					}
				}
				if len(cols) > 0 {
					ts = append(ts, &ComputeTransform{Columns: cols})
				}
			}

		case "sort":
			field, _ := tc.Config["field"].(string)
			direction, _ := tc.Config["direction"].(string)
			if direction == "" {
				direction = "asc"
			}
			if field != "" {
				ts = append(ts, &SortTransform{Field: field, Direction: direction})
			}

		case "limit":
			if count, ok := tc.Config["count"].(float64); ok && count > 0 {
				ts = append(ts, NewLimitTransform(int(count)))
			}

		case "type_cast":
			field, _ := tc.Config["field"].(string)
			castType, _ := tc.Config["castType"].(string)
			if field != "" && castType != "" {
				ts = append(ts, &TypeCastTransform{Field: field, CastType: castType})
			}

		case "flatten":
			sourceField, _ := tc.Config["sourceField"].(string)
			fieldsRaw, _ := tc.Config["fields"].([]any)
			if sourceField != "" && len(fieldsRaw) > 0 {
				fields := make(map[string]string)
				for _, f := range fieldsRaw {
					if fm, ok := f.(map[string]any); ok {
						path, _ := fm["path"].(string)
						alias, _ := fm["alias"].(string)
						if path != "" {
							fields[path] = alias
						}
					}
				}
				if len(fields) > 0 {
					ts = append(ts, &FlattenTransform{SourceField: sourceField, Fields: fields})
				}
			}
		}
	}

	// Dedupe is always applied last if a key is specified.
	if dedupeKey != "" {
		ts = append(ts, NewDedupeTransform(dedupeKey))
	}

	return ts
}

// deriveSchemaFromRecords builds a schema from the actual keys present in transformed records.
// It preserves field type hints from the original source schema where available.
func deriveSchemaFromRecords(records []Record, sourceSchema *Schema) *Schema {
	if len(records) == 0 {
		return sourceSchema
	}

	// Build lookup of source field types.
	typeMap := make(map[string]string)
	if sourceSchema != nil {
		for _, f := range sourceSchema.Fields {
			typeMap[f.Name] = f.Type
		}
	}

	// Collect all unique keys from records (preserving insertion order via slice).
	seen := make(map[string]bool)
	var fieldNames []string
	for _, r := range records {
		for k := range r.Data {
			if !seen[k] {
				seen[k] = true
				fieldNames = append(fieldNames, k)
			}
		}
	}

	// Build output schema.
	fields := make([]Field, 0, len(fieldNames))
	for _, name := range fieldNames {
		ft := typeMap[name]
		if ft == "" {
			ft = "string" // default for new fields (e.g. from flatten)
		}
		fields = append(fields, Field{Name: name, Type: ft})
	}

	return &Schema{Fields: fields}
}
