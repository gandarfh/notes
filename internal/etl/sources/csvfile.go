package sources

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"strconv"
	"strings"

	"notes/internal/etl"
)

// ── CSV File Source ─────────────────────────────────────────
// Reads records from a local CSV file.

type csvFileSource struct{}

func init() { etl.RegisterSource(&csvFileSource{}) }

func (s *csvFileSource) Spec() etl.SourceSpec {
	return etl.SourceSpec{
		Type:  "csv_file",
		Label: "CSV File",
		Icon:  "IconFileTypeCsv",
		ConfigFields: []etl.ConfigField{
			{Key: "filePath", Label: "File Path", Type: "file", Required: true, Help: "Absolute path to the CSV file"},
			{Key: "delimiter", Label: "Delimiter", Type: "string", Required: false, Default: ",", Help: "Column delimiter (default: comma)"},
			{Key: "hasHeader", Label: "Has Header", Type: "select", Required: false, Options: []string{"true", "false"}, Default: "true", Help: "Whether the first row contains column names"},
		},
	}
}

func (s *csvFileSource) Discover(ctx context.Context, cfg etl.SourceConfig) (*etl.Schema, error) {
	headers, _, err := readCSVFile(cfg)
	if err != nil {
		return nil, err
	}

	schema := &etl.Schema{Fields: make([]etl.Field, len(headers))}
	for i, h := range headers {
		schema.Fields[i] = etl.Field{Name: h, Type: "text"}
	}
	return schema, nil
}

func (s *csvFileSource) Read(ctx context.Context, cfg etl.SourceConfig) (<-chan etl.Record, <-chan error) {
	out := make(chan etl.Record, 100)
	errCh := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errCh)

		headers, rows, err := readCSVFile(cfg)
		if err != nil {
			errCh <- err
			return
		}

		for _, row := range rows {
			data := make(map[string]any, len(headers))
			for j, h := range headers {
				if j < len(row) {
					data[h] = inferCSVValue(row[j])
				}
			}
			select {
			case out <- etl.Record{Data: data}:
			case <-ctx.Done():
				return
			}
		}
	}()

	return out, errCh
}

func readCSVFile(cfg etl.SourceConfig) ([]string, [][]string, error) {
	filePath, _ := cfg["filePath"].(string)
	if filePath == "" {
		return nil, nil, fmt.Errorf("filePath is required")
	}

	f, err := os.Open(filePath)
	if err != nil {
		return nil, nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	reader := csv.NewReader(f)

	// Configure delimiter.
	if delim, ok := cfg["delimiter"].(string); ok && len(delim) > 0 {
		reader.Comma = rune(delim[0])
	}
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	records, err := reader.ReadAll()
	if err != nil {
		return nil, nil, fmt.Errorf("parse csv: %w", err)
	}
	if len(records) == 0 {
		return nil, nil, fmt.Errorf("empty csv file")
	}

	// Check if first row is header.
	hasHeader := true
	if h, ok := cfg["hasHeader"].(string); ok {
		hasHeader = strings.ToLower(h) != "false"
	}

	var headers []string
	var rows [][]string
	if hasHeader {
		headers = records[0]
		rows = records[1:]
	} else {
		// Generate column names: col_1, col_2, ...
		headers = make([]string, len(records[0]))
		for i := range headers {
			headers[i] = fmt.Sprintf("col_%d", i+1)
		}
		rows = records
	}

	return headers, rows, nil
}

// inferCSVValue tries to parse a string as a number or bool.
func inferCSVValue(s string) any {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}

	// Try number.
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}

	// Try bool.
	switch strings.ToLower(s) {
	case "true", "yes", "1":
		return true
	case "false", "no", "0":
		// "0" already matched as number, but just in case.
		return false
	}

	return s
}
