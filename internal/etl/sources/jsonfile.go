package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"notes/internal/etl"
)

// ── JSON File Source ────────────────────────────────────────
// Reads records from a local JSON file.

type jsonFileSource struct{}

func init() { etl.RegisterSource(&jsonFileSource{}) }

func (s *jsonFileSource) Spec() etl.SourceSpec {
	return etl.SourceSpec{
		Type:  "json_file",
		Label: "JSON File",
		Icon:  "IconFileTypeJs",
		ConfigFields: []etl.ConfigField{
			{Key: "filePath", Label: "File Path", Type: "file", Required: true, Help: "Absolute path to the JSON file"},
			{Key: "dataPath", Label: "Data Path", Type: "string", Required: false, Help: "Dot-separated path to the array (e.g., 'data.items'). Leave empty if root is an array."},
		},
	}
}

func (s *jsonFileSource) Discover(ctx context.Context, cfg etl.SourceConfig) (*etl.Schema, error) {
	records, err := readJSONFile(cfg)
	if err != nil {
		return nil, err
	}
	return inferSchema(records), nil
}

func (s *jsonFileSource) Read(ctx context.Context, cfg etl.SourceConfig) (<-chan etl.Record, <-chan error) {
	out := make(chan etl.Record, 100)
	errCh := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errCh)

		records, err := readJSONFile(cfg)
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

func readJSONFile(cfg etl.SourceConfig) ([]etl.Record, error) {
	filePath, _ := cfg["filePath"].(string)
	if filePath == "" {
		return nil, fmt.Errorf("filePath is required")
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}

	// Navigate to dataPath if specified.
	if dataPath, ok := cfg["dataPath"].(string); ok && dataPath != "" {
		parts := strings.Split(dataPath, ".")
		current := raw
		for _, part := range parts {
			if m, ok := current.(map[string]any); ok {
				current = m[part]
			} else {
				return nil, fmt.Errorf("invalid data path: %q not found", part)
			}
		}
		raw = current
	}

	return toRecords(raw), nil
}
