package sources

import (
	"context"
	"fmt"

	"notes/internal/etl"
)

// ── Database Source ────────────────────────────────────────
// Reads data from an external database connection.
// Reuses the existing dbclient.Connector infrastructure via a provider interface.

// QueryPage mirrors dbclient.QueryPage to avoid circular imports.
type QueryPage struct {
	Columns []string
	Rows    [][]any
	HasMore bool
}

// DBProvider abstracts how we get connector access.
// The app layer implements this and injects it at startup.
type DBProvider interface {
	ExecuteETLQuery(ctx context.Context, connID, query string, fetchSize int) (*QueryPage, error)
	FetchMoreETLRows(ctx context.Context, connID string, fetchSize int) (*QueryPage, error)
}

var dbProvider DBProvider

// SetDBProvider is called by the app at startup.
func SetDBProvider(p DBProvider) { dbProvider = p }

// BlockResolver provides access to block content for resolving database block references.
type BlockResolver interface {
	GetBlockContent(ctx context.Context, blockID string) (connectionID string, query string, err error)
}

var blockResolver BlockResolver

// SetBlockResolver is called by the app at startup.
func SetBlockResolver(r BlockResolver) { blockResolver = r }

type databaseSource struct{}

func init() { etl.RegisterSource(&databaseSource{}) }

func (s *databaseSource) Spec() etl.SourceSpec {
	return etl.SourceSpec{
		Type:  "database",
		Label: "Database Query",
		Icon:  "IconDatabase",
		ConfigFields: []etl.ConfigField{
			{Key: "blockId", Label: "Database Block", Type: "db_block", Required: true, Help: "Select a database block from this page"},
		},
	}
}

// resolveDBConfig extracts connectionId and query from config.
// Supports both direct fields (legacy) and blockId reference.
func resolveDBConfig(ctx context.Context, cfg etl.SourceConfig) (string, string, error) {
	// New: resolve from block reference.
	if blockID, ok := cfg["blockId"].(string); ok && blockID != "" {
		if blockResolver == nil {
			return "", "", fmt.Errorf("block resolver not initialized")
		}
		return blockResolver.GetBlockContent(ctx, blockID)
	}

	// Legacy: direct connectionId + query.
	connID, _ := cfg["connectionId"].(string)
	query, _ := cfg["query"].(string)
	if connID == "" || query == "" {
		return "", "", fmt.Errorf("blockId or connectionId+query required")
	}
	return connID, query, nil
}

func (s *databaseSource) Discover(ctx context.Context, cfg etl.SourceConfig) (*etl.Schema, error) {
	connID, query, err := resolveDBConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if dbProvider == nil {
		return nil, fmt.Errorf("database provider not initialized")
	}

	page, err := dbProvider.ExecuteETLQuery(ctx, connID, query, 1)
	if err != nil {
		return nil, err
	}

	schema := &etl.Schema{Fields: make([]etl.Field, len(page.Columns))}
	for i, col := range page.Columns {
		schema.Fields[i] = etl.Field{Name: col, Type: "text"}
	}
	return schema, nil
}

func (s *databaseSource) Read(ctx context.Context, cfg etl.SourceConfig) (<-chan etl.Record, <-chan error) {
	out := make(chan etl.Record, 100)
	errCh := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errCh)

		connID, query, err := resolveDBConfig(ctx, cfg)
		if err != nil {
			errCh <- err
			return
		}
		if dbProvider == nil {
			errCh <- fmt.Errorf("database provider not initialized")
			return
		}

		page, err := dbProvider.ExecuteETLQuery(ctx, connID, query, 500)
		if err != nil {
			errCh <- fmt.Errorf("execute: %w", err)
			return
		}

		if !emitPage(ctx, out, page) {
			return
		}

		for page.HasMore {
			page, err = dbProvider.FetchMoreETLRows(ctx, connID, 500)
			if err != nil {
				errCh <- fmt.Errorf("fetch more: %w", err)
				return
			}
			if !emitPage(ctx, out, page) {
				return
			}
		}
	}()

	return out, errCh
}

func emitPage(ctx context.Context, out chan<- etl.Record, page *QueryPage) bool {
	for _, row := range page.Rows {
		data := make(map[string]any, len(page.Columns))
		for i, col := range page.Columns {
			if i < len(row) {
				data[col] = row[i]
			}
		}
		select {
		case out <- etl.Record{Data: data}:
		case <-ctx.Done():
			return false
		}
	}
	return true
}
