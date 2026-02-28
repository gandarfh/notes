package app

// ─────────────────────────────────────────────────────────────
// ETL Adapter Bridge
// ─────────────────────────────────────────────────────────────
//
// The ETL sources package uses interfaces (BlockResolver, DBProvider,
// HTTPBlockResolver) to access app infrastructure without creating circular
// deps. This file provides the concrete adapters that satisfy those interfaces
// using the App's services.

import (
	"context"
	"encoding/json"
	"fmt"

	"notes/internal/etl/sources"
)

// ── Setup ──────────────────────────────────────────────────

// setupETLAdapters wires the ETL source adapters using the App's services.
func setupETLAdapters(a *App) {
	sources.SetBlockResolver(&appBlockResolver{app: a})
	sources.SetDBProvider(&appDBProvider{app: a})
	sources.SetHTTPBlockResolver(&appHTTPBlockResolver{app: a})
}

// ── Block Resolver ─────────────────────────────────────────

type appBlockResolver struct{ app *App }

func (r *appBlockResolver) GetBlockContent(ctx context.Context, blockID string) (connID, query string, err error) {
	b, err := r.app.blocks.GetBlock(blockID)
	if err != nil {
		return "", "", fmt.Errorf("resolve block %s: %w", blockID, err)
	}
	var cfg struct {
		ConnectionID string `json:"connectionId"`
		Query        string `json:"query"`
	}
	if err := json.Unmarshal([]byte(b.Content), &cfg); err != nil {
		return "", "", fmt.Errorf("parse block config for %s: %w", blockID, err)
	}
	return cfg.ConnectionID, cfg.Query, nil
}

// ── DB Provider ────────────────────────────────────────────

type appDBProvider struct{ app *App }

func (p *appDBProvider) ExecuteETLQuery(ctx context.Context, connID, query string, fetchSize int) (*sources.QueryPage, error) {
	result, err := p.app.database.ExecuteQuery(ctx, "__etl__", connID, query, fetchSize)
	if err != nil {
		return nil, err
	}
	return &sources.QueryPage{Columns: result.Columns, Rows: result.Rows, HasMore: result.HasMore}, nil
}

func (p *appDBProvider) FetchMoreETLRows(ctx context.Context, connID string, fetchSize int) (*sources.QueryPage, error) {
	result, err := p.app.database.FetchMoreRows(ctx, connID, fetchSize)
	if err != nil {
		return nil, err
	}
	return &sources.QueryPage{Columns: result.Columns, Rows: result.Rows, HasMore: result.HasMore}, nil
}

// ── HTTP Block Resolver ────────────────────────────────────

type appHTTPBlockResolver struct{ app *App }

func (r *appHTTPBlockResolver) GetHTTPBlockContent(blockID string) (url, method, headersJSON, bodyJSON string, err error) {
	b, err := r.app.blocks.GetBlock(blockID)
	if err != nil {
		return "", "", "", "", fmt.Errorf("resolve http block %s: %w", blockID, err)
	}
	var cfg struct {
		URL     string          `json:"url"`
		Method  string          `json:"method"`
		Headers json.RawMessage `json:"headers"`
		Body    json.RawMessage `json:"body"`
	}
	if e := json.Unmarshal([]byte(b.Content), &cfg); e != nil {
		return "", "", "", "", fmt.Errorf("parse http block config: %w", e)
	}

	// Headers may be stored as [{key, value, enabled}] array or {k:v} map.
	headers := make(map[string]string)
	if len(cfg.Headers) > 0 {
		// Try array format first (frontend stores [{key, value, enabled}]).
		var kvPairs []struct {
			Key     string `json:"key"`
			Value   string `json:"value"`
			Enabled *bool  `json:"enabled"`
		}
		if err := json.Unmarshal(cfg.Headers, &kvPairs); err == nil {
			for _, kv := range kvPairs {
				if kv.Key != "" && (kv.Enabled == nil || *kv.Enabled) {
					headers[kv.Key] = kv.Value
				}
			}
		} else {
			// Fallback: try map format.
			_ = json.Unmarshal(cfg.Headers, &headers)
		}
	}

	// Body may be stored as {mode, content} object or plain string.
	var bodyStr string
	if len(cfg.Body) > 0 {
		var bodyObj struct {
			Mode    string `json:"mode"`
			Content string `json:"content"`
		}
		if err := json.Unmarshal(cfg.Body, &bodyObj); err == nil {
			if bodyObj.Mode != "none" {
				bodyStr = bodyObj.Content
			}
		} else {
			// Fallback: try plain string.
			_ = json.Unmarshal(cfg.Body, &bodyStr)
		}
	}

	hdrs, _ := json.Marshal(headers)
	return cfg.URL, cfg.Method, string(hdrs), bodyStr, nil
}
