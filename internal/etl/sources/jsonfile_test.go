package sources

import (
	"context"
	"testing"

	"notes/internal/etl"
)

func TestJSONSource_Spec(t *testing.T) {
	src, err := etl.GetSource("json_file")
	if err != nil {
		t.Fatalf("get source: %v", err)
	}
	spec := src.Spec()
	if spec.Type != "json_file" {
		t.Errorf("type = %q", spec.Type)
	}
}

func TestJSONSource_Discover(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "test.json",
		`[{"name":"alice","age":30},{"name":"bob","age":25}]`)

	schema, err := src.Discover(context.Background(), etl.SourceConfig{"filePath": path})
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(schema.Fields) != 2 {
		t.Errorf("fields = %d, want 2", len(schema.Fields))
	}
}

func TestJSONSource_Read_Array(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "arr.json",
		`[{"id":1,"name":"alice"},{"id":2,"name":"bob"}]`)

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})

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
	if records[0].Data["id"] != 1.0 {
		t.Errorf("id = %v", records[0].Data["id"])
	}
}

func TestJSONSource_Read_WithDataPath(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "nested.json",
		`{"data":{"items":[{"x":1},{"x":2},{"x":3}]}}`)

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{
		"filePath": path,
		"dataPath": "data.items",
	})

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
}

func TestJSONSource_Read_SingleObject(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "single.json",
		`{"name":"alice","score":100}`)

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})

	var records []etl.Record
	for r := range recCh {
		records = append(records, r)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(records) != 1 {
		t.Fatalf("records = %d, want 1 (single object)", len(records))
	}
	if records[0].Data["name"] != "alice" {
		t.Errorf("name = %v", records[0].Data["name"])
	}
}

func TestJSONSource_Read_NestedObjectsFlattened(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "nested_obj.json",
		`[{"name":"alice","meta":{"role":"admin"}}]`)

	recCh, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})

	var records []etl.Record
	for r := range recCh {
		records = append(records, r)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("read: %v", err)
	}

	// Nested objects should be serialized as JSON strings
	meta, ok := records[0].Data["meta"].(string)
	if !ok {
		t.Fatalf("meta should be string, got %T", records[0].Data["meta"])
	}
	if meta != `{"role":"admin"}` {
		t.Errorf("meta = %q", meta)
	}
}

func TestJSONSource_Read_MissingFilePath(t *testing.T) {
	src, _ := etl.GetSource("json_file")

	_, errCh := src.Read(context.Background(), etl.SourceConfig{})
	if err := <-errCh; err == nil {
		t.Fatal("expected error for missing filePath")
	}
}

func TestJSONSource_Read_InvalidJSON(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "bad.json", "not json{}")

	_, errCh := src.Read(context.Background(), etl.SourceConfig{"filePath": path})
	if err := <-errCh; err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestJSONSource_Read_InvalidDataPath(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "simple.json", `{"name":"alice"}`)

	_, errCh := src.Read(context.Background(), etl.SourceConfig{
		"filePath": path,
		"dataPath": "nonexistent.path",
	})
	if err := <-errCh; err == nil {
		t.Fatal("expected error for invalid data path")
	}
}

func TestJSONSource_SchemaInference(t *testing.T) {
	src, _ := etl.GetSource("json_file")
	path := writeFile(t, t.TempDir(), "types.json",
		`[{"count":42,"active":true,"name":"test"}]`)

	schema, err := src.Discover(context.Background(), etl.SourceConfig{"filePath": path})
	if err != nil {
		t.Fatalf("discover: %v", err)
	}

	fieldTypes := make(map[string]string)
	for _, f := range schema.Fields {
		fieldTypes[f.Name] = f.Type
	}

	if fieldTypes["count"] != "number" {
		t.Errorf("count type = %q, want number", fieldTypes["count"])
	}
	if fieldTypes["active"] != "boolean" {
		t.Errorf("active type = %q, want boolean", fieldTypes["active"])
	}
	if fieldTypes["name"] != "text" {
		t.Errorf("name type = %q, want text", fieldTypes["name"])
	}
}
