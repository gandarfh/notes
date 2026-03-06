package sources

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"notes/internal/etl"
)

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	return path
}

func TestCSVSource_Spec(t *testing.T) {
	src, err := etl.GetSource("csv_file")
	if err != nil {
		t.Fatalf("get source: %v", err)
	}
	spec := src.Spec()
	if spec.Type != "csv_file" {
		t.Errorf("type = %q", spec.Type)
	}
	if spec.Label == "" {
		t.Error("label should not be empty")
	}
}

func TestCSVSource_Discover(t *testing.T) {
	src, _ := etl.GetSource("csv_file")
	path := writeFile(t, t.TempDir(), "test.csv", "name,age,active\nalice,30,true\n")

	schema, err := src.Discover(context.Background(), etl.SourceConfig{"filePath": path})
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(schema.Fields) != 3 {
		t.Errorf("fields = %d, want 3", len(schema.Fields))
	}
}

func TestCSVSource_Read(t *testing.T) {
	src, _ := etl.GetSource("csv_file")
	path := writeFile(t, t.TempDir(), "test.csv", "id,name\n1,alice\n2,bob\n3,charlie\n")

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})

	var records []etl.Record
	for r := range recCh {
		records = append(records, r)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(records) != 3 {
		t.Fatalf("records = %d, want 3", len(records))
	}
	// id should be inferred as number
	if records[0].Data["id"] != 1.0 {
		t.Errorf("id = %v, want 1.0", records[0].Data["id"])
	}
	if records[0].Data["name"] != "alice" {
		t.Errorf("name = %v", records[0].Data["name"])
	}
}

func TestCSVSource_Read_NoHeader(t *testing.T) {
	src, _ := etl.GetSource("csv_file")
	path := writeFile(t, t.TempDir(), "noheader.csv", "alice,30\nbob,25\n")

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{
		"filePath":  path,
		"hasHeader": "false",
	})

	var records []etl.Record
	for r := range recCh {
		records = append(records, r)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	// Should use col_1, col_2 as headers
	if records[0].Data["col_1"] != "alice" {
		t.Errorf("col_1 = %v", records[0].Data["col_1"])
	}
}

func TestCSVSource_Read_CustomDelimiter(t *testing.T) {
	src, _ := etl.GetSource("csv_file")
	path := writeFile(t, t.TempDir(), "tab.csv", "name\tage\nalice\t30\n")

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{
		"filePath":  path,
		"delimiter": "\t",
	})

	var records []etl.Record
	for r := range recCh {
		records = append(records, r)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(records) != 1 {
		t.Fatalf("records = %d, want 1", len(records))
	}
	if records[0].Data["name"] != "alice" {
		t.Errorf("name = %v", records[0].Data["name"])
	}
}

func TestCSVSource_Read_EmptyFile(t *testing.T) {
	src, _ := etl.GetSource("csv_file")
	path := writeFile(t, t.TempDir(), "empty.csv", "")

	_, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})
	if err := <-errCh; err == nil {
		t.Fatal("expected error for empty CSV")
	}
}

func TestCSVSource_Read_MissingFilePath(t *testing.T) {
	src, _ := etl.GetSource("csv_file")

	_, errCh := src.Read(context.Background(), etl.SourceConfig{})
	if err := <-errCh; err == nil {
		t.Fatal("expected error for missing filePath")
	}
}

func TestCSVSource_Read_FileNotFound(t *testing.T) {
	src, _ := etl.GetSource("csv_file")

	_, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": "/nonexistent/file.csv"})
	if err := <-errCh; err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestCSVSource_Read_ValueInference(t *testing.T) {
	src, _ := etl.GetSource("csv_file")
	// Note: CSV parser treats blank lines specially, so use explicit empty value
	path := writeFile(t, t.TempDir(), "types.csv", "val\n42.5\ntrue\nfalse\nyes\nno\nhello\n")

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})

	var records []etl.Record
	for r := range recCh {
		records = append(records, r)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(records) != 6 {
		t.Fatalf("records = %d, want 6", len(records))
	}
	if records[0].Data["val"] != 42.5 {
		t.Errorf("number: got %v", records[0].Data["val"])
	}
	if records[1].Data["val"] != true {
		t.Errorf("true: got %v", records[1].Data["val"])
	}
	if records[2].Data["val"] != false {
		t.Errorf("false: got %v", records[2].Data["val"])
	}
	if records[3].Data["val"] != true { // yes
		t.Errorf("yes: got %v", records[3].Data["val"])
	}
	if records[4].Data["val"] != false { // no
		t.Errorf("no: got %v", records[4].Data["val"])
	}
	if records[5].Data["val"] != "hello" {
		t.Errorf("string: got %v", records[5].Data["val"])
	}
}

func TestCSVSource_ContextCancellation(t *testing.T) {
	src, _ := etl.GetSource("csv_file")

	// Create a large CSV
	content := "id\n"
	for i := 0; i < 1000; i++ {
		content += "1\n"
	}
	path := writeFile(t, t.TempDir(), "large.csv", content)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	recCh, _ := src.Read(ctx, etl.SourceConfig{"filePath": path})

	count := 0
	for range recCh {
		count++
	}
	// Should not read all records due to cancellation
	// (though it might read some since the goroutine may start before cancel propagates)
	if count >= 1000 {
		t.Error("expected fewer records due to cancellation")
	}
}
