package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"time"

	"notes/internal/etl"
)

// ── HTTP Source ─────────────────────────────────────────────
// Fetches data from a REST API endpoint.
// Excellent for integrating with personal APIs like GitHub, Strava, Toggl, etc.

// HTTPBlockResolver provides access to HTTP block content for resolving block references.
type HTTPBlockResolver interface {
	GetHTTPBlockContent(blockID string) (url, method, headers, body string, err error)
}

var httpBlockResolver HTTPBlockResolver

// SetHTTPBlockResolver is called by the app at startup.
func SetHTTPBlockResolver(r HTTPBlockResolver) { httpBlockResolver = r }

type httpSource struct{}

func init() { etl.RegisterSource(&httpSource{}) }

func (s *httpSource) Spec() etl.SourceSpec {
	return etl.SourceSpec{
		Type:  "http",
		Label: "HTTP API",
		Icon:  "IconWorldWww",
		ConfigFields: []etl.ConfigField{
			{Key: "blockId", Label: "HTTP Block", Type: "http_block", Required: false, Help: "Select an HTTP block from this page"},
			{Key: "url", Label: "URL", Type: "string", Required: false, Help: "Full URL to fetch (e.g., https://api.github.com/users/me/repos)"},
			{Key: "method", Label: "Method", Type: "select", Required: false, Options: []string{"GET", "POST"}, Default: "GET"},
			{Key: "headers", Label: "Headers", Type: "textarea", Required: false, Help: "JSON object of headers (e.g., {\"Authorization\": \"Bearer xxx\"})"},
			{Key: "body", Label: "Body", Type: "textarea", Required: false, Help: "Request body (for POST)"},
			{Key: "dataPath", Label: "Data Path", Type: "string", Required: false, Help: "Dot-separated path to the array in the response (e.g., 'data.items')"},
		},
	}
}

func (s *httpSource) Discover(ctx context.Context, cfg etl.SourceConfig) (*etl.Schema, error) {
	// Fetch a small sample to discover schema.
	records, err := fetchHTTP(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return inferSchema(records), nil
}

func (s *httpSource) Read(ctx context.Context, cfg etl.SourceConfig) (<-chan etl.Record, <-chan error) {
	out := make(chan etl.Record, 100)
	errCh := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errCh)

		records, err := fetchHTTP(ctx, cfg)
		if err != nil {
			errCh <- err
			return
		}
		for _, rec := range records {
			select {
			case out <- rec:
			case <-ctx.Done():
				return
			}
		}
	}()

	return out, errCh
}

func fetchHTTP(ctx context.Context, cfg etl.SourceConfig) ([]etl.Record, error) {
	// Resolve from HTTP block reference if blockId is set.
	if blockID, ok := cfg["blockId"].(string); ok && blockID != "" && httpBlockResolver != nil {
		bURL, bMethod, bHeaders, bBody, err := httpBlockResolver.GetHTTPBlockContent(blockID)
		if err != nil {
			return nil, fmt.Errorf("resolve http block: %w", err)
		}
		// Override config with block values (keep dataPath from ETL config).
		cfg["url"] = bURL
		cfg["method"] = bMethod
		cfg["headers"] = bHeaders
		cfg["body"] = bBody
	}

	url, _ := cfg["url"].(string)
	if url == "" {
		return nil, fmt.Errorf("url is required")
	}

	method, _ := cfg["method"].(string)
	if method == "" {
		method = "GET"
	}

	var bodyReader io.Reader
	if body, ok := cfg["body"].(string); ok && body != "" {
		bodyReader = strings.NewReader(body)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Parse headers.
	if headersStr, ok := cfg["headers"].(string); ok && headersStr != "" {
		var headers map[string]string
		if err := json.Unmarshal([]byte(headersStr), &headers); err == nil {
			for k, v := range headers {
				req.Header.Set(k, v)
			}
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	// Parse JSON response.
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}

	// Navigate to dataPath if specified.
	dataPath, _ := cfg["dataPath"].(string)
	if dataPath != "" {
		raw = navigatePath(raw, dataPath)
	}

	return toRecords(raw), nil
}

// navigatePath walks a dot-separated path into nested maps/slices.
func navigatePath(obj any, path string) any {
	parts := strings.Split(path, ".")
	current := obj
	for _, part := range parts {
		switch v := current.(type) {
		case map[string]any:
			current = v[part]
		default:
			return nil
		}
	}
	return current
}

// toRecords converts a raw JSON value into a slice of Records.
func toRecords(raw any) []etl.Record {
	switch v := raw.(type) {
	case []any:
		records := make([]etl.Record, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				records = append(records, etl.Record{Data: flattenMap(m)})
			}
		}
		return records
	case map[string]any:
		// Single object → single record.
		return []etl.Record{{Data: flattenMap(v)}}
	default:
		return nil
	}
}

// flattenMap keeps only scalar values (string, number, bool) from a map.
// Nested objects/arrays are serialized as JSON strings.
func flattenMap(m map[string]any) map[string]any {
	flat := make(map[string]any, len(m))
	for k, v := range m {
		switch v.(type) {
		case string, float64, bool, nil:
			flat[k] = v
		default:
			// Serialize complex values.
			b, _ := json.Marshal(v)
			flat[k] = string(b)
		}
	}
	return flat
}

// inferSchema infers a Schema from a slice of Records.
func inferSchema(records []etl.Record) *etl.Schema {
	fieldSet := make(map[string]string) // name → type
	for _, rec := range records {
		for k, v := range rec.Data {
			if _, exists := fieldSet[k]; !exists {
				fieldSet[k] = inferType(v)
			}
		}
	}

	schema := &etl.Schema{}
	for name, typ := range fieldSet {
		schema.Fields = append(schema.Fields, etl.Field{Name: name, Type: typ})
	}
	return schema
}

func inferType(v any) string {
	if v == nil {
		return "text"
	}
	switch reflect.TypeOf(v).Kind() {
	case reflect.Float64, reflect.Float32, reflect.Int, reflect.Int64:
		return "number"
	case reflect.Bool:
		return "boolean"
	default:
		return "text"
	}
}
