package etl

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
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
	CastType string // "number" | "string" | "bool" | "date" | "datetime"
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
	case "date":
		if parsed, ok := tryParseTime(v); ok {
			r.Data[t.Field] = parsed.Format("2006-01-02")
		}
	case "datetime":
		if parsed, ok := tryParseTime(v); ok {
			r.Data[t.Field] = parsed.Format(time.RFC3339)
		}
	}
	return r, true
}

// StringTransform performs string manipulation on a field.
type StringTransform struct {
	Field       string   // source field
	Op          string   // "upper" | "lower" | "trim" | "replace" | "concat" | "split" | "substring"
	Search      string   // for replace
	ReplaceWith string   // for replace
	Parts       []string // for concat: mix of field refs {field} and literals
	TargetField string   // output field (for concat, split)
	Separator   string   // for split
	Index       int      // for split: which part to pick
	Start       int      // for substring
	End         int      // for substring
}

func (t *StringTransform) Transform(r Record) (Record, bool) {
	switch t.Op {
	case "upper":
		if v, ok := r.Data[t.Field]; ok {
			r.Data[t.Field] = strings.ToUpper(fmt.Sprint(v))
		}
	case "lower":
		if v, ok := r.Data[t.Field]; ok {
			r.Data[t.Field] = strings.ToLower(fmt.Sprint(v))
		}
	case "trim":
		if v, ok := r.Data[t.Field]; ok {
			r.Data[t.Field] = strings.TrimSpace(fmt.Sprint(v))
		}
	case "replace":
		if v, ok := r.Data[t.Field]; ok {
			r.Data[t.Field] = strings.ReplaceAll(fmt.Sprint(v), t.Search, t.ReplaceWith)
		}
	case "concat":
		out := t.TargetField
		if out == "" {
			out = t.Field
		}
		var sb strings.Builder
		for _, part := range t.Parts {
			if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
				ref := part[1 : len(part)-1]
				sb.WriteString(fmt.Sprint(r.Data[ref]))
			} else {
				sb.WriteString(part)
			}
		}
		r.Data[out] = sb.String()
	case "split":
		if v, ok := r.Data[t.Field]; ok {
			parts := strings.Split(fmt.Sprint(v), t.Separator)
			out := t.TargetField
			if out == "" {
				out = t.Field
			}
			if t.Index >= 0 && t.Index < len(parts) {
				r.Data[out] = parts[t.Index]
			} else {
				r.Data[out] = ""
			}
		}
	case "substring":
		if v, ok := r.Data[t.Field]; ok {
			s := fmt.Sprint(v)
			start := t.Start
			end := t.End
			if start < 0 {
				start = 0
			}
			if end <= 0 || end > len(s) {
				end = len(s)
			}
			if start > len(s) {
				start = len(s)
			}
			if start > end {
				start = end
			}
			r.Data[t.Field] = s[start:end]
		}
	}
	return r, true
}

// DatePartTransform extracts a part of a date/datetime field into a new column.
type DatePartTransform struct {
	Field       string // source field containing a date
	Part        string // "year" | "month" | "day" | "hour" | "minute" | "weekday" | "week"
	TargetField string // output column name
}

func (t *DatePartTransform) Transform(r Record) (Record, bool) {
	v, ok := r.Data[t.Field]
	if !ok {
		return r, true
	}
	parsed, pOk := tryParseTime(v)
	if !pOk {
		return r, true
	}
	out := t.TargetField
	if out == "" {
		out = t.Field + "_" + t.Part
	}
	switch t.Part {
	case "year":
		r.Data[out] = parsed.Year()
	case "month":
		r.Data[out] = int(parsed.Month())
	case "day":
		r.Data[out] = parsed.Day()
	case "hour":
		r.Data[out] = parsed.Hour()
	case "minute":
		r.Data[out] = parsed.Minute()
	case "weekday":
		r.Data[out] = int(parsed.Weekday())
	case "week":
		_, week := parsed.ISOWeek()
		r.Data[out] = week
	}
	return r, true
}

// DefaultValueTransform fills null/empty fields with a default value.
type DefaultValueTransform struct {
	Field        string
	DefaultValue string
}

func (t *DefaultValueTransform) Transform(r Record) (Record, bool) {
	v, ok := r.Data[t.Field]
	if !ok || v == nil || fmt.Sprint(v) == "" {
		r.Data[t.Field] = t.DefaultValue
	}
	return r, true
}

// MathTransform applies a math function to a numeric field.
type MathTransform struct {
	Field string
	Op    string // "round" | "ceil" | "floor" | "abs"
}

func (t *MathTransform) Transform(r Record) (Record, bool) {
	v, ok := r.Data[t.Field]
	if !ok {
		return r, true
	}
	f := toFloat(v)
	switch t.Op {
	case "round":
		r.Data[t.Field] = math.Round(f)
	case "ceil":
		r.Data[t.Field] = math.Ceil(f)
	case "floor":
		r.Data[t.Field] = math.Floor(f)
	case "abs":
		r.Data[t.Field] = math.Abs(f)
	}
	return r, true
}

// ── Date Parsing Helpers ──────────────────────────────────

// Common date/datetime formats to try when parsing.
var dateFormats = []string{
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02",
	"02/01/2006 15:04:05",
	"02/01/2006",
	"01/02/2006",
	"Jan 2, 2006",
}

// tryParseTime attempts to parse a value as a time.Time.
func tryParseTime(v any) (time.Time, bool) {
	switch tv := v.(type) {
	case time.Time:
		return tv, true
	case string:
		// Try date format strings first.
		for _, layout := range dateFormats {
			if t, err := time.Parse(layout, tv); err == nil {
				return t, true
			}
		}
		// Try as numeric string (Unix timestamp from MongoDB, etc.)
		if f, err := strconv.ParseFloat(tv, 64); err == nil {
			return parseUnixTimestamp(f)
		}
	case float64:
		return parseUnixTimestamp(tv)
	case int:
		return parseUnixTimestamp(float64(tv))
	case int64:
		return parseUnixTimestamp(float64(tv))
	}
	return time.Time{}, false
}

// parseUnixTimestamp converts a numeric value to time, auto-detecting seconds vs milliseconds.
func parseUnixTimestamp(v float64) (time.Time, bool) {
	// Unix timestamp in seconds (10 digits: 2001–2286)
	if v > 1e9 && v < 1e13 {
		return time.Unix(int64(v), 0), true
	}
	// Unix timestamp in milliseconds (13 digits)
	if v >= 1e13 {
		return time.UnixMilli(int64(v)), true
	}
	return time.Time{}, false
}

// FlattenTransform extracts fields from a JSON/map column into new top-level columns.
type FlattenTransform struct {
	SourceField string            // column containing JSON/map data
	Fields      map[string]string // path → output column name
}

func (t *FlattenTransform) Transform(r Record) (Record, bool) {
	raw, ok := r.Data[t.SourceField]
	if !ok {
		return r, true
	}

	// Resolve to map
	var m map[string]any
	switch v := raw.(type) {
	case map[string]any:
		m = v
	case string:
		if err := json.Unmarshal([]byte(v), &m); err != nil {
			return r, true
		}
	default:
		return r, true
	}

	for path, outCol := range t.Fields {
		if outCol == "" {
			outCol = path
		}
		r.Data[outCol] = extractPath(m, path)
	}
	return r, true
}

// extractPath navigates dot-separated paths like "providers.gitProvider".
func extractPath(m map[string]any, path string) any {
	parts := strings.Split(path, ".")
	var current any = m
	for _, p := range parts {
		cm, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = cm[p]
	}
	return current
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
