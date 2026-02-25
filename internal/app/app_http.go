package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ── HTTP Block ─────────────────────────────────────────────
// Provides a mini-Postman experience as a canvas block.
// ExecuteHTTPRequest is exposed as a Wails binding.

// HTTPRequestConfig is the config stored in block.content.
type HTTPRequestConfig struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// HTTPResponse is returned to the frontend after executing a request.
type HTTPResponse struct {
	StatusCode  int               `json:"statusCode"`
	StatusText  string            `json:"statusText"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
	DurationMs  int64             `json:"durationMs"`
	ContentType string            `json:"contentType"`
	SizeBytes   int               `json:"sizeBytes"`
}

// ExecuteHTTPRequest runs an HTTP request from a block's config and returns the response.
func (a *App) ExecuteHTTPRequest(blockID string, configJSON string) (*HTTPResponse, error) {
	var cfg HTTPRequestConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.URL == "" {
		return nil, fmt.Errorf("url is required")
	}
	method := cfg.Method
	if method == "" {
		method = "GET"
	}

	var bodyReader io.Reader
	if cfg.Body != "" {
		bodyReader = strings.NewReader(cfg.Body)
	}

	req, err := http.NewRequest(method, cfg.URL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Apply headers.
	for k, v := range cfg.Headers {
		if k != "" {
			req.Header.Set(k, v)
		}
	}

	client := &http.Client{Timeout: 30 * time.Second}

	start := time.Now()
	resp, err := client.Do(req)
	durationMs := time.Since(start).Milliseconds()
	if err != nil {
		return &HTTPResponse{
			StatusCode: 0,
			StatusText: err.Error(),
			DurationMs: durationMs,
		}, nil
	}
	defer resp.Body.Close()

	// Read body (limit to 5MB to prevent memory issues).
	data, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	// Collect response headers.
	respHeaders := make(map[string]string)
	for k := range resp.Header {
		respHeaders[k] = resp.Header.Get(k)
	}

	return &HTTPResponse{
		StatusCode:  resp.StatusCode,
		StatusText:  resp.Status,
		Headers:     respHeaders,
		Body:        string(data),
		DurationMs:  durationMs,
		ContentType: resp.Header.Get("Content-Type"),
		SizeBytes:   len(data),
	}, nil
}

// SaveBlockHTTPConfig persists HTTP request config to a block.
func (a *App) SaveBlockHTTPConfig(blockID string, config string) error {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return err
	}
	b.Content = config
	return a.blocks.UpdateBlock(b)
}
