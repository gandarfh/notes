package storage

import (
	"testing"
	"time"

	"notes/internal/domain"
)

func newQueryResultStore(t *testing.T) *QueryResultStore {
	t.Helper()
	return NewQueryResultStore(newTestDB(t))
}

func TestQueryResultStore_UpsertAndGet(t *testing.T) {
	s := newQueryResultStore(t)

	r := &domain.QueryResult{
		ID:          "qr-1",
		BlockID:     "block-1",
		Query:       "SELECT * FROM users",
		ColumnsJSON: `["id","name"]`,
		RowsJSON:    `[[1,"alice"]]`,
		TotalRows:   1,
		HasMore:     false,
		DurationMs:  42,
		Error:       "",
		IsWrite:     false,
	}
	if err := s.UpsertResult(r); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, err := s.GetResultByBlock("block-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil result")
	}
	if got.Query != "SELECT * FROM users" {
		t.Errorf("query = %q", got.Query)
	}
	if got.ColumnsJSON != `["id","name"]` {
		t.Errorf("columns = %q", got.ColumnsJSON)
	}
	if got.TotalRows != 1 {
		t.Errorf("totalRows = %d", got.TotalRows)
	}
	if got.HasMore {
		t.Error("hasMore should be false")
	}
	if got.IsWrite {
		t.Error("isWrite should be false")
	}
}

func TestQueryResultStore_BooleanConversion(t *testing.T) {
	s := newQueryResultStore(t)

	r := &domain.QueryResult{
		ID:           "qr-1",
		BlockID:      "block-1",
		Query:        "INSERT INTO users VALUES (1)",
		ColumnsJSON:  "[]",
		RowsJSON:     "[]",
		HasMore:      true,
		IsWrite:      true,
		AffectedRows: 5,
	}
	s.UpsertResult(r)

	got, _ := s.GetResultByBlock("block-1")
	if !got.HasMore {
		t.Error("hasMore should be true")
	}
	if !got.IsWrite {
		t.Error("isWrite should be true")
	}
	if got.AffectedRows != 5 {
		t.Errorf("affectedRows = %d, want 5", got.AffectedRows)
	}
}

func TestQueryResultStore_UpsertOverwrite(t *testing.T) {
	s := newQueryResultStore(t)

	r := &domain.QueryResult{
		ID: "qr-1", BlockID: "block-1", Query: "old query",
		ColumnsJSON: "[]", RowsJSON: "[]",
	}
	s.UpsertResult(r)

	r.Query = "new query"
	r.TotalRows = 10
	if err := s.UpsertResult(r); err != nil {
		t.Fatalf("upsert overwrite: %v", err)
	}

	got, _ := s.GetResultByBlock("block-1")
	if got.Query != "new query" {
		t.Errorf("query = %q, want new query", got.Query)
	}
	if got.TotalRows != 10 {
		t.Errorf("totalRows = %d, want 10", got.TotalRows)
	}
}

func TestQueryResultStore_GetByBlock_NotFound(t *testing.T) {
	s := newQueryResultStore(t)

	got, err := s.GetResultByBlock("nonexistent")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != nil {
		t.Error("expected nil for nonexistent block")
	}
}

func TestQueryResultStore_DeleteByBlock(t *testing.T) {
	s := newQueryResultStore(t)

	r := &domain.QueryResult{
		ID: "qr-1", BlockID: "block-1", Query: "SELECT 1",
		ColumnsJSON: "[]", RowsJSON: "[]",
	}
	s.UpsertResult(r)

	if err := s.DeleteResultsByBlock("block-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	got, _ := s.GetResultByBlock("block-1")
	if got != nil {
		t.Error("expected nil after delete")
	}
}

func TestQueryResultStore_AutoTimestamp(t *testing.T) {
	s := newQueryResultStore(t)

	r := &domain.QueryResult{
		ID: "qr-1", BlockID: "block-1", Query: "SELECT 1",
		ColumnsJSON: "[]", RowsJSON: "[]",
	}
	s.UpsertResult(r)

	got, _ := s.GetResultByBlock("block-1")
	if got.ExecutedAt.IsZero() {
		t.Error("ExecutedAt should be auto-set")
	}
}

func TestQueryResultStore_ExplicitTimestamp(t *testing.T) {
	s := newQueryResultStore(t)

	ts := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
	r := &domain.QueryResult{
		ID: "qr-1", BlockID: "block-1", Query: "SELECT 1",
		ColumnsJSON: "[]", RowsJSON: "[]", ExecutedAt: ts,
	}
	s.UpsertResult(r)

	got, _ := s.GetResultByBlock("block-1")
	if got.ExecutedAt.Year() != 2025 {
		t.Errorf("ExecutedAt year = %d, want 2025", got.ExecutedAt.Year())
	}
}
