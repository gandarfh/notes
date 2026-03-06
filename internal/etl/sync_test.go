package etl

import (
	"context"
	"testing"
)

// mockSource implements etl.Source for testing.
type mockSource struct {
	spec    SourceSpec
	schema  *Schema
	records []Record
	err     error
}

func (s *mockSource) Spec() SourceSpec { return s.spec }

func (s *mockSource) Discover(_ context.Context, _ SourceConfig) (*Schema, error) {
	return s.schema, nil
}

func (s *mockSource) Read(_ context.Context, _ SourceConfig) (<-chan Record, <-chan error) {
	recCh := make(chan Record, len(s.records))
	errCh := make(chan error, 1)
	for _, r := range s.records {
		recCh <- r
	}
	close(recCh)
	errCh <- s.err
	return recCh, errCh
}

// mockDestination implements etl.Destination for testing.
type mockDestination struct {
	written  int
	records  []Record
	mode     SyncMode
	targetID string
	err      error
}

func (d *mockDestination) Write(_ context.Context, targetID string, _ *Schema, records []Record, mode SyncMode) (int, error) {
	d.targetID = targetID
	d.records = records
	d.mode = mode
	if d.err != nil {
		return 0, d.err
	}
	d.written = len(records)
	return d.written, nil
}

func init() {
	// Register our test source
	RegisterSource(&mockSource{
		spec: SourceSpec{Type: "test", Label: "Test Source"},
		schema: &Schema{
			Fields: []Field{
				{Name: "id", Type: "number"},
				{Name: "name", Type: "text"},
			},
		},
		records: []Record{
			{Data: map[string]any{"id": 1.0, "name": "alice"}},
			{Data: map[string]any{"id": 2.0, "name": "bob"}},
			{Data: map[string]any{"id": 3.0, "name": "charlie"}},
		},
	})
}

func TestEngine_RunSync(t *testing.T) {
	dest := &mockDestination{}
	engine := &Engine{Dest: dest}

	job := &SyncJob{
		ID:         "job-1",
		SourceType: "test",
		SourceCfg:  map[string]any{},
		TargetDBID: "db-1",
		SyncMode:   "replace",
	}

	result, err := engine.RunSync(context.Background(), job)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if result.Status != "success" {
		t.Errorf("status = %q", result.Status)
	}
	if result.RowsRead != 3 {
		t.Errorf("rowsRead = %d, want 3", result.RowsRead)
	}
	if result.RowsWritten != 3 {
		t.Errorf("rowsWritten = %d, want 3", result.RowsWritten)
	}
	if dest.targetID != "db-1" {
		t.Errorf("targetID = %q", dest.targetID)
	}
	if dest.mode != "replace" {
		t.Errorf("mode = %v", dest.mode)
	}
}

func TestEngine_RunSync_WithTransforms(t *testing.T) {
	dest := &mockDestination{}
	engine := &Engine{Dest: dest}

	job := &SyncJob{
		ID:         "job-1",
		SourceType: "test",
		SourceCfg:  map[string]any{},
		TargetDBID: "db-1",
		SyncMode:   "append",
		Transforms: []TransformConfig{
			{Type: "filter", Config: map[string]any{"field": "name", "op": "neq", "value": "bob"}},
		},
	}

	result, err := engine.RunSync(context.Background(), job)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if result.RowsRead != 3 {
		t.Errorf("rowsRead = %d, want 3 (all read)", result.RowsRead)
	}
	if result.RowsWritten != 2 {
		t.Errorf("rowsWritten = %d, want 2 (bob filtered)", result.RowsWritten)
	}
}

func TestEngine_RunSync_UnknownSource(t *testing.T) {
	dest := &mockDestination{}
	engine := &Engine{Dest: dest}

	job := &SyncJob{
		ID:         "job-1",
		SourceType: "nonexistent",
		SourceCfg:  map[string]any{},
	}

	result, err := engine.RunSync(context.Background(), job)
	if err == nil {
		t.Fatal("expected error for unknown source")
	}
	if result.Status != "error" {
		t.Errorf("status = %q, want error", result.Status)
	}
}

func TestEngine_RunSync_DestinationError(t *testing.T) {
	dest := &mockDestination{err: context.DeadlineExceeded}
	engine := &Engine{Dest: dest}

	job := &SyncJob{
		ID:         "job-1",
		SourceType: "test",
		SourceCfg:  map[string]any{},
		TargetDBID: "db-1",
		SyncMode:   "replace",
	}

	result, err := engine.RunSync(context.Background(), job)
	if err == nil {
		t.Fatal("expected error")
	}
	if result.Status != "error" {
		t.Errorf("status = %q", result.Status)
	}
}

func TestEngine_Preview(t *testing.T) {
	dest := &mockDestination{}
	engine := &Engine{Dest: dest}

	records, schema, err := engine.Preview(context.Background(), "test", map[string]any{}, 2)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if len(records) != 2 {
		t.Errorf("records = %d, want 2 (maxRows)", len(records))
	}
	if len(schema.Fields) != 2 {
		t.Errorf("schema fields = %d", len(schema.Fields))
	}
}

// ── Source Registry ─────────────────────────────────────────

func TestGetSource_Found(t *testing.T) {
	s, err := GetSource("test")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if s.Spec().Type != "test" {
		t.Errorf("type = %q", s.Spec().Type)
	}
}

func TestGetSource_NotFound(t *testing.T) {
	_, err := GetSource("nonexistent")
	if err == nil {
		t.Fatal("expected error for unknown source")
	}
}

func TestListSources(t *testing.T) {
	specs := ListSources()
	found := false
	for _, s := range specs {
		if s.Type == "test" {
			found = true
			break
		}
	}
	if !found {
		t.Error("test source should be in list")
	}
}

// ── LocalDBWriter (Destination) ─────────────────────────────

func TestLocalDBWriter_WriteEmpty(t *testing.T) {
	w := &LocalDBWriter{Store: nil}

	written, err := w.Write(context.Background(), "db-1", nil, nil, SyncReplace)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if written != 0 {
		t.Errorf("written = %d, want 0", written)
	}
}

// ── Schema ──────────────────────────────────────────────────

func TestSchema_FieldNames(t *testing.T) {
	s := &Schema{
		Fields: []Field{
			{Name: "id", Type: "number"},
			{Name: "name", Type: "text"},
		},
	}

	names := s.FieldNames()
	if len(names) != 2 {
		t.Fatalf("len = %d", len(names))
	}
	if names[0] != "id" || names[1] != "name" {
		t.Errorf("names = %v", names)
	}
}
