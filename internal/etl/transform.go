package etl

import (
	"fmt"
	"strconv"
	"strings"
)

// ── Transformer ────────────────────────────────────────────
// Transformers modify records in-flight between source and destination.
// They are composable: each takes a record, returns a (possibly modified)
// record and a boolean indicating whether to keep it.
//
// Pattern: Benthos processor chain.

// Transformer processes a single record.
// Returns (transformed record, keep). If keep is false, the record is dropped.
type Transformer interface {
	Transform(Record) (Record, bool)
}

// TransformerFunc adapts a plain function to the Transformer interface.
type TransformerFunc func(Record) (Record, bool)

func (f TransformerFunc) Transform(r Record) (Record, bool) { return f(r) }

// ── Built-in Transforms ────────────────────────────────────

// FilterTransform drops records where the given field does not match the value.
type FilterTransform struct {
	Field string
	Op    string // "eq" | "neq" | "gt" | "lt" | "contains"
	Value any
}

func (t *FilterTransform) Transform(r Record) (Record, bool) {
	v, ok := r.Data[t.Field]
	if !ok {
		return r, false
	}
	switch t.Op {
	case "eq":
		return r, fmt.Sprint(v) == fmt.Sprint(t.Value)
	case "neq":
		return r, fmt.Sprint(v) != fmt.Sprint(t.Value)
	case "contains":
		return r, strings.Contains(fmt.Sprint(v), fmt.Sprint(t.Value))
	case "gt":
		return r, toFloat(v) > toFloat(t.Value)
	case "lt":
		return r, toFloat(v) < toFloat(t.Value)
	default:
		return r, true
	}
}

// RenameTransform renames fields in a record.
type RenameTransform struct {
	Mapping map[string]string // oldName → newName
}

func (t *RenameTransform) Transform(r Record) (Record, bool) {
	for old, new_ := range t.Mapping {
		if v, ok := r.Data[old]; ok {
			r.Data[new_] = v
			delete(r.Data, old)
		}
	}
	return r, true
}

// SelectTransform keeps only the specified fields.
type SelectTransform struct {
	Fields []string
}

func (t *SelectTransform) Transform(r Record) (Record, bool) {
	filtered := make(map[string]any, len(t.Fields))
	for _, f := range t.Fields {
		if v, ok := r.Data[f]; ok {
			filtered[f] = v
		}
	}
	r.Data = filtered
	return r, true
}

// DedupeTransform drops records with duplicate values for the given key.
type DedupeTransform struct {
	Key  string
	seen map[string]bool
}

func NewDedupeTransform(key string) *DedupeTransform {
	return &DedupeTransform{Key: key, seen: make(map[string]bool)}
}

func (t *DedupeTransform) Transform(r Record) (Record, bool) {
	v := fmt.Sprint(r.Data[t.Key])
	if t.seen[v] {
		return r, false
	}
	t.seen[v] = true
	return r, true
}

// ComputeTransform adds or overwrites fields using simple expressions.
// Expression format: {field_name} references, basic math (+, -, *, /).
type ComputeTransform struct {
	Columns []ComputeColumn
}

type ComputeColumn struct {
	Name       string
	Expression string
}

func (t *ComputeTransform) Transform(r Record) (Record, bool) {
	for _, col := range t.Columns {
		if col.Name == "" || col.Expression == "" {
			continue
		}
		r.Data[col.Name] = evaluateExpr(r.Data, col.Expression)
	}
	return r, true
}

// evaluateExpr resolves {field} references and concatenates string parts.
func evaluateExpr(data map[string]any, expr string) any {
	// Simple: replace {field} with values, try numeric math first.
	resolved := expr
	for k, v := range data {
		placeholder := "{" + k + "}"
		if strings.Contains(resolved, placeholder) {
			resolved = strings.ReplaceAll(resolved, placeholder, fmt.Sprint(v))
		}
	}
	// Try parsing as float (simple numeric result).
	if f, err := strconv.ParseFloat(resolved, 64); err == nil {
		return f
	}
	return resolved
}

// SortTransform sorts all collected records by a field.
// NOTE: This is a batch transform — it must collect ALL records, so it's
// applied after the streaming phase by the engine, not per-record.
type SortTransform struct {
	Field     string
	Direction string // "asc" | "desc"
}

func (t *SortTransform) Transform(r Record) (Record, bool) {
	// Pass-through in streaming mode; actual sort is handled by the engine.
	return r, true
}

// LimitTransform caps the number of records.
type LimitTransform struct {
	Count int
	seen  int
}

func NewLimitTransform(count int) *LimitTransform {
	return &LimitTransform{Count: count}
}

func (t *LimitTransform) Transform(r Record) (Record, bool) {
	t.seen++
	return r, t.seen <= t.Count
}

// TypeCastTransform converts a field's value to a target type.
type TypeCastTransform struct {
	Field    string
	CastType string // "number" | "string" | "bool"
}

func (t *TypeCastTransform) Transform(r Record) (Record, bool) {
	v, ok := r.Data[t.Field]
	if !ok {
		return r, true
	}
	switch t.CastType {
	case "number":
		r.Data[t.Field] = toFloat(v)
	case "string":
		r.Data[t.Field] = fmt.Sprint(v)
	case "bool":
		r.Data[t.Field] = toBool(v)
	}
	return r, true
}

func toBool(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		lower := strings.ToLower(b)
		return lower == "true" || lower == "yes" || lower == "1"
	case float64:
		return b != 0
	case int:
		return b != 0
	default:
		return false
	}
}

// ── Batch Transforms ──────────────────────────────────────

// ApplyBatchSort sorts records if a SortTransform exists in the chain.
func ApplyBatchSort(records []Record, ts []Transformer) []Record {
	for _, t := range ts {
		if st, ok := t.(*SortTransform); ok && st.Field != "" {
			sorted := make([]Record, len(records))
			copy(sorted, records)
			sortRecords(sorted, st.Field, st.Direction)
			return sorted
		}
	}
	return records
}

func sortRecords(records []Record, field, direction string) {
	dir := 1
	if direction == "desc" {
		dir = -1
	}
	// Simple insertion sort (stable, good enough for moderate sizes).
	for i := 1; i < len(records); i++ {
		for j := i; j > 0; j-- {
			a := records[j-1].Data[field]
			b := records[j].Data[field]
			if compareValues(a, b)*dir > 0 {
				records[j-1], records[j] = records[j], records[j-1]
			} else {
				break
			}
		}
	}
}

func compareValues(a, b any) int {
	fa, aOk := toFloatSafe(a)
	fb, bOk := toFloatSafe(b)
	if aOk && bOk {
		if fa < fb {
			return -1
		}
		if fa > fb {
			return 1
		}
		return 0
	}
	sa := fmt.Sprint(a)
	sb := fmt.Sprint(b)
	return strings.Compare(sa, sb)
}

func toFloatSafe(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// ── Helpers ────────────────────────────────────────────────

// ApplyTransformers runs a chain of transformers on a record.
func ApplyTransformers(r Record, ts []Transformer) (Record, bool) {
	for _, t := range ts {
		var keep bool
		r, keep = t.Transform(r)
		if !keep {
			return r, false
		}
	}
	return r, true
}

func toFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	default:
		return 0
	}
}
