package etl

import (
	"testing"
)

func rec(data map[string]any) Record {
	return Record{Data: data}
}

// ── FilterTransform ─────────────────────────────────────────

func TestFilterTransform_Eq(t *testing.T) {
	f := &FilterTransform{Field: "status", Op: "eq", Value: "active"}

	_, keep := f.Transform(rec(map[string]any{"status": "active"}))
	if !keep {
		t.Error("should keep matching record")
	}

	_, keep = f.Transform(rec(map[string]any{"status": "inactive"}))
	if keep {
		t.Error("should drop non-matching record")
	}
}

func TestFilterTransform_Neq(t *testing.T) {
	f := &FilterTransform{Field: "status", Op: "neq", Value: "deleted"}

	_, keep := f.Transform(rec(map[string]any{"status": "active"}))
	if !keep {
		t.Error("should keep non-equal record")
	}

	_, keep = f.Transform(rec(map[string]any{"status": "deleted"}))
	if keep {
		t.Error("should drop equal record")
	}
}

func TestFilterTransform_Contains(t *testing.T) {
	f := &FilterTransform{Field: "name", Op: "contains", Value: "alice"}

	_, keep := f.Transform(rec(map[string]any{"name": "alice smith"}))
	if !keep {
		t.Error("should keep matching record")
	}

	_, keep = f.Transform(rec(map[string]any{"name": "bob"}))
	if keep {
		t.Error("should drop non-matching record")
	}
}

func TestFilterTransform_Gt(t *testing.T) {
	f := &FilterTransform{Field: "age", Op: "gt", Value: 18.0}

	_, keep := f.Transform(rec(map[string]any{"age": 25.0}))
	if !keep {
		t.Error("should keep 25 > 18")
	}

	_, keep = f.Transform(rec(map[string]any{"age": 10.0}))
	if keep {
		t.Error("should drop 10 < 18")
	}
}

func TestFilterTransform_Lt(t *testing.T) {
	f := &FilterTransform{Field: "age", Op: "lt", Value: 18.0}

	_, keep := f.Transform(rec(map[string]any{"age": 10.0}))
	if !keep {
		t.Error("should keep 10 < 18")
	}
}

func TestFilterTransform_MissingField(t *testing.T) {
	f := &FilterTransform{Field: "status", Op: "eq", Value: "active"}

	_, keep := f.Transform(rec(map[string]any{"name": "alice"}))
	if keep {
		t.Error("should drop record with missing field")
	}
}

// ── RenameTransform ─────────────────────────────────────────

func TestRenameTransform(t *testing.T) {
	r := &RenameTransform{Mapping: map[string]string{"old_name": "new_name"}}

	result, keep := r.Transform(rec(map[string]any{"old_name": "alice", "age": 25}))
	if !keep {
		t.Error("should keep record")
	}
	if result.Data["new_name"] != "alice" {
		t.Errorf("new_name = %v", result.Data["new_name"])
	}
	if _, ok := result.Data["old_name"]; ok {
		t.Error("old field should be removed")
	}
	if result.Data["age"] != 25 {
		t.Error("other fields should be preserved")
	}
}

// ── SelectTransform ─────────────────────────────────────────

func TestSelectTransform(t *testing.T) {
	s := &SelectTransform{Fields: []string{"name", "email"}}

	result, keep := s.Transform(rec(map[string]any{"name": "alice", "email": "a@b.com", "age": 25}))
	if !keep {
		t.Error("should keep record")
	}
	if len(result.Data) != 2 {
		t.Errorf("should have 2 fields, got %d", len(result.Data))
	}
	if result.Data["name"] != "alice" {
		t.Errorf("name = %v", result.Data["name"])
	}
	if _, ok := result.Data["age"]; ok {
		t.Error("age should be removed")
	}
}

// ── DedupeTransform ─────────────────────────────────────────

func TestDedupeTransform(t *testing.T) {
	d := NewDedupeTransform("id")

	_, keep := d.Transform(rec(map[string]any{"id": "1", "name": "alice"}))
	if !keep {
		t.Error("first should be kept")
	}

	_, keep = d.Transform(rec(map[string]any{"id": "1", "name": "alice copy"}))
	if keep {
		t.Error("duplicate should be dropped")
	}

	_, keep = d.Transform(rec(map[string]any{"id": "2", "name": "bob"}))
	if !keep {
		t.Error("different key should be kept")
	}
}

// ── ComputeTransform ────────────────────────────────────────

func TestComputeTransform(t *testing.T) {
	c := &ComputeTransform{
		Columns: []ComputeColumn{
			{Name: "full_name", Expression: "{first} {last}"},
		},
	}

	result, _ := c.Transform(rec(map[string]any{"first": "alice", "last": "smith"}))
	if result.Data["full_name"] != "alice smith" {
		t.Errorf("full_name = %v", result.Data["full_name"])
	}
}

func TestComputeTransform_NumericResult(t *testing.T) {
	c := &ComputeTransform{
		Columns: []ComputeColumn{
			{Name: "result", Expression: "{value}"},
		},
	}

	result, _ := c.Transform(rec(map[string]any{"value": 42.0}))
	if result.Data["result"] != 42.0 {
		t.Errorf("result = %v (type %T)", result.Data["result"], result.Data["result"])
	}
}

// ── LimitTransform ──────────────────────────────────────────

func TestLimitTransform(t *testing.T) {
	l := NewLimitTransform(2)

	_, keep := l.Transform(rec(map[string]any{"i": 1}))
	if !keep {
		t.Error("first should be kept")
	}

	_, keep = l.Transform(rec(map[string]any{"i": 2}))
	if !keep {
		t.Error("second should be kept")
	}

	_, keep = l.Transform(rec(map[string]any{"i": 3}))
	if keep {
		t.Error("third should be dropped (limit 2)")
	}
}

// ── TypeCastTransform ───────────────────────────────────────

func TestTypeCastTransform_ToNumber(t *testing.T) {
	tc := &TypeCastTransform{Field: "age", CastType: "number"}

	result, _ := tc.Transform(rec(map[string]any{"age": "25"}))
	if result.Data["age"] != 25.0 {
		t.Errorf("age = %v (type %T)", result.Data["age"], result.Data["age"])
	}
}

func TestTypeCastTransform_ToString(t *testing.T) {
	tc := &TypeCastTransform{Field: "id", CastType: "string"}

	result, _ := tc.Transform(rec(map[string]any{"id": 42}))
	if result.Data["id"] != "42" {
		t.Errorf("id = %v", result.Data["id"])
	}
}

func TestTypeCastTransform_ToBool(t *testing.T) {
	tc := &TypeCastTransform{Field: "active", CastType: "bool"}

	result, _ := tc.Transform(rec(map[string]any{"active": "true"}))
	if result.Data["active"] != true {
		t.Errorf("active = %v", result.Data["active"])
	}

	result, _ = tc.Transform(rec(map[string]any{"active": "false"}))
	if result.Data["active"] != false {
		t.Errorf("active = %v", result.Data["active"])
	}
}

func TestTypeCastTransform_MissingField(t *testing.T) {
	tc := &TypeCastTransform{Field: "x", CastType: "number"}

	_, keep := tc.Transform(rec(map[string]any{"y": 1}))
	if !keep {
		t.Error("should keep record even if field is missing")
	}
}

// ── StringTransform ─────────────────────────────────────────

func TestStringTransform_Upper(t *testing.T) {
	s := &StringTransform{Field: "name", Op: "upper"}

	result, _ := s.Transform(rec(map[string]any{"name": "alice"}))
	if result.Data["name"] != "ALICE" {
		t.Errorf("name = %v", result.Data["name"])
	}
}

func TestStringTransform_Lower(t *testing.T) {
	s := &StringTransform{Field: "name", Op: "lower"}

	result, _ := s.Transform(rec(map[string]any{"name": "ALICE"}))
	if result.Data["name"] != "alice" {
		t.Errorf("name = %v", result.Data["name"])
	}
}

func TestStringTransform_Trim(t *testing.T) {
	s := &StringTransform{Field: "name", Op: "trim"}

	result, _ := s.Transform(rec(map[string]any{"name": "  alice  "}))
	if result.Data["name"] != "alice" {
		t.Errorf("name = %q", result.Data["name"])
	}
}

func TestStringTransform_Replace(t *testing.T) {
	s := &StringTransform{Field: "text", Op: "replace", Search: "foo", ReplaceWith: "bar"}

	result, _ := s.Transform(rec(map[string]any{"text": "foo baz foo"}))
	if result.Data["text"] != "bar baz bar" {
		t.Errorf("text = %v", result.Data["text"])
	}
}

func TestStringTransform_Concat(t *testing.T) {
	s := &StringTransform{
		Op:          "concat",
		TargetField: "full",
		Parts:       []string{"{first}", " ", "{last}"},
	}

	result, _ := s.Transform(rec(map[string]any{"first": "alice", "last": "smith"}))
	if result.Data["full"] != "alice smith" {
		t.Errorf("full = %v", result.Data["full"])
	}
}

func TestStringTransform_Split(t *testing.T) {
	s := &StringTransform{Field: "email", Op: "split", Separator: "@", Index: 0, TargetField: "user"}

	result, _ := s.Transform(rec(map[string]any{"email": "alice@example.com"}))
	if result.Data["user"] != "alice" {
		t.Errorf("user = %v", result.Data["user"])
	}
}

func TestStringTransform_Substring(t *testing.T) {
	s := &StringTransform{Field: "code", Op: "substring", Start: 0, End: 3}

	result, _ := s.Transform(rec(map[string]any{"code": "ABCDEF"}))
	if result.Data["code"] != "ABC" {
		t.Errorf("code = %v", result.Data["code"])
	}
}

// ── DatePartTransform ───────────────────────────────────────

func TestDatePartTransform_Year(t *testing.T) {
	d := &DatePartTransform{Field: "date", Part: "year", TargetField: "yr"}

	result, _ := d.Transform(rec(map[string]any{"date": "2025-06-15"}))
	if result.Data["yr"] != 2025 {
		t.Errorf("yr = %v", result.Data["yr"])
	}
}

func TestDatePartTransform_Month(t *testing.T) {
	d := &DatePartTransform{Field: "date", Part: "month", TargetField: "m"}

	result, _ := d.Transform(rec(map[string]any{"date": "2025-06-15"}))
	if result.Data["m"] != 6 {
		t.Errorf("m = %v", result.Data["m"])
	}
}

func TestDatePartTransform_DefaultTarget(t *testing.T) {
	d := &DatePartTransform{Field: "date", Part: "day"}

	result, _ := d.Transform(rec(map[string]any{"date": "2025-06-15"}))
	if result.Data["date_day"] != 15 {
		t.Errorf("date_day = %v", result.Data["date_day"])
	}
}

// ── DefaultValueTransform ───────────────────────────────────

func TestDefaultValueTransform(t *testing.T) {
	d := &DefaultValueTransform{Field: "status", DefaultValue: "unknown"}

	// Missing field
	result, _ := d.Transform(rec(map[string]any{"name": "alice"}))
	if result.Data["status"] != "unknown" {
		t.Errorf("status = %v", result.Data["status"])
	}

	// Nil value
	result, _ = d.Transform(rec(map[string]any{"status": nil}))
	if result.Data["status"] != "unknown" {
		t.Errorf("status = %v", result.Data["status"])
	}

	// Empty string
	result, _ = d.Transform(rec(map[string]any{"status": ""}))
	if result.Data["status"] != "unknown" {
		t.Errorf("status = %v", result.Data["status"])
	}

	// Existing value should not be changed
	result, _ = d.Transform(rec(map[string]any{"status": "active"}))
	if result.Data["status"] != "active" {
		t.Errorf("status = %v, should preserve existing", result.Data["status"])
	}
}

// ── MathTransform ───────────────────────────────────────────

func TestMathTransform_Round(t *testing.T) {
	m := &MathTransform{Field: "price", Op: "round"}

	result, _ := m.Transform(rec(map[string]any{"price": 3.7}))
	if result.Data["price"] != 4.0 {
		t.Errorf("price = %v", result.Data["price"])
	}
}

func TestMathTransform_Floor(t *testing.T) {
	m := &MathTransform{Field: "price", Op: "floor"}

	result, _ := m.Transform(rec(map[string]any{"price": 3.7}))
	if result.Data["price"] != 3.0 {
		t.Errorf("price = %v", result.Data["price"])
	}
}

func TestMathTransform_Ceil(t *testing.T) {
	m := &MathTransform{Field: "price", Op: "ceil"}

	result, _ := m.Transform(rec(map[string]any{"price": 3.1}))
	if result.Data["price"] != 4.0 {
		t.Errorf("price = %v", result.Data["price"])
	}
}

func TestMathTransform_Abs(t *testing.T) {
	m := &MathTransform{Field: "val", Op: "abs"}

	result, _ := m.Transform(rec(map[string]any{"val": -5.0}))
	if result.Data["val"] != 5.0 {
		t.Errorf("val = %v", result.Data["val"])
	}
}

// ── FlattenTransform ────────────────────────────────────────

func TestFlattenTransform_Map(t *testing.T) {
	f := &FlattenTransform{
		SourceField: "meta",
		Fields:      map[string]string{"name": "meta_name", "nested.key": "nested_key"},
	}

	result, _ := f.Transform(rec(map[string]any{
		"meta": map[string]any{"name": "test", "nested": map[string]any{"key": "val"}},
	}))
	if result.Data["meta_name"] != "test" {
		t.Errorf("meta_name = %v", result.Data["meta_name"])
	}
	if result.Data["nested_key"] != "val" {
		t.Errorf("nested_key = %v", result.Data["nested_key"])
	}
}

func TestFlattenTransform_JSONString(t *testing.T) {
	f := &FlattenTransform{
		SourceField: "json_col",
		Fields:      map[string]string{"x": "out_x"},
	}

	result, _ := f.Transform(rec(map[string]any{
		"json_col": `{"x": 42}`,
	}))
	if result.Data["out_x"] != float64(42) {
		t.Errorf("out_x = %v (type %T)", result.Data["out_x"], result.Data["out_x"])
	}
}

// ── ApplyTransformers ───────────────────────────────────────

func TestApplyTransformers_Chain(t *testing.T) {
	ts := []Transformer{
		&RenameTransform{Mapping: map[string]string{"n": "name"}},
		&FilterTransform{Field: "name", Op: "eq", Value: "alice"},
	}

	r, keep := ApplyTransformers(rec(map[string]any{"n": "alice"}), ts)
	if !keep {
		t.Error("should keep after rename + filter")
	}
	if r.Data["name"] != "alice" {
		t.Errorf("name = %v", r.Data["name"])
	}

	_, keep = ApplyTransformers(rec(map[string]any{"n": "bob"}), ts)
	if keep {
		t.Error("should drop bob after filter")
	}
}

// ── ApplyBatchSort ──────────────────────────────────────────

func TestApplyBatchSort_Asc(t *testing.T) {
	records := []Record{
		rec(map[string]any{"name": "charlie", "age": 30.0}),
		rec(map[string]any{"name": "alice", "age": 20.0}),
		rec(map[string]any{"name": "bob", "age": 25.0}),
	}

	ts := []Transformer{
		&SortTransform{Field: "age", Direction: "asc"},
	}

	sorted := ApplyBatchSort(records, ts)
	if len(sorted) != 3 {
		t.Fatalf("len = %d", len(sorted))
	}
	if sorted[0].Data["name"] != "alice" {
		t.Errorf("first = %v, want alice", sorted[0].Data["name"])
	}
	if sorted[2].Data["name"] != "charlie" {
		t.Errorf("last = %v, want charlie", sorted[2].Data["name"])
	}
}

func TestApplyBatchSort_Desc(t *testing.T) {
	records := []Record{
		rec(map[string]any{"age": 20.0}),
		rec(map[string]any{"age": 30.0}),
		rec(map[string]any{"age": 25.0}),
	}

	ts := []Transformer{
		&SortTransform{Field: "age", Direction: "desc"},
	}

	sorted := ApplyBatchSort(records, ts)
	if sorted[0].Data["age"] != 30.0 {
		t.Errorf("first age = %v, want 30", sorted[0].Data["age"])
	}
}

func TestApplyBatchSort_NoSortTransform(t *testing.T) {
	records := []Record{rec(map[string]any{"a": 1})}
	ts := []Transformer{
		&FilterTransform{Field: "a", Op: "eq", Value: 1},
	}

	sorted := ApplyBatchSort(records, ts)
	if len(sorted) != 1 {
		t.Errorf("should return original records")
	}
}
