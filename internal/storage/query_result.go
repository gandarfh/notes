package storage

import (
	"database/sql"
	"fmt"
	"time"

	"notes/internal/domain"
)

// QueryResultStore manages cached query results in SQLite.
type QueryResultStore struct {
	db *DB
}

// NewQueryResultStore creates a new QueryResultStore.
func NewQueryResultStore(db *DB) *QueryResultStore {
	return &QueryResultStore{db: db}
}

// UpsertResult inserts or replaces the cached result for a block.
func (s *QueryResultStore) UpsertResult(r *domain.QueryResult) error {
	if r.ExecutedAt.IsZero() {
		r.ExecutedAt = time.Now()
	}

	hasMore := 0
	if r.HasMore {
		hasMore = 1
	}
	isWrite := 0
	if r.IsWrite {
		isWrite = 1
	}

	_, err := s.db.Conn().Exec(
		`INSERT INTO query_results (id, block_id, query, columns_json, rows_json, total_rows, has_more, executed_at, duration_ms, error, is_write, affected_rows)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   query=excluded.query, columns_json=excluded.columns_json, rows_json=excluded.rows_json,
		   total_rows=excluded.total_rows, has_more=excluded.has_more, executed_at=excluded.executed_at,
		   duration_ms=excluded.duration_ms, error=excluded.error, is_write=excluded.is_write,
		   affected_rows=excluded.affected_rows`,
		r.ID, r.BlockID, r.Query, r.ColumnsJSON, r.RowsJSON, r.TotalRows, hasMore,
		r.ExecutedAt, r.DurationMs, r.Error, isWrite, r.AffectedRows,
	)
	return err
}

// GetResultByBlock retrieves the latest cached result for a block.
func (s *QueryResultStore) GetResultByBlock(blockID string) (*domain.QueryResult, error) {
	row := s.db.Conn().QueryRow(
		`SELECT id, block_id, query, columns_json, rows_json, total_rows, has_more,
		        executed_at, duration_ms, error, is_write, affected_rows
		 FROM query_results WHERE block_id = ? ORDER BY executed_at DESC LIMIT 1`, blockID,
	)

	r := &domain.QueryResult{}
	var hasMore, isWrite int
	err := row.Scan(&r.ID, &r.BlockID, &r.Query, &r.ColumnsJSON, &r.RowsJSON, &r.TotalRows,
		&hasMore, &r.ExecutedAt, &r.DurationMs, &r.Error, &isWrite, &r.AffectedRows)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan query result: %w", err)
	}
	r.HasMore = hasMore == 1
	r.IsWrite = isWrite == 1
	return r, nil
}

// DeleteResultsByBlock removes all cached results for a block.
func (s *QueryResultStore) DeleteResultsByBlock(blockID string) error {
	_, err := s.db.Conn().Exec(`DELETE FROM query_results WHERE block_id = ?`, blockID)
	return err
}
