package mcpserver

import (
	"testing"
)

func TestParseJSON_StrictMode(t *testing.T) {
	// Known fields only
	var target struct {
		Name string `json:"name"`
	}
	if err := parseJSON(`{"name":"test"}`, &target); err != nil {
		t.Fatalf("valid JSON failed: %v", err)
	}
	if target.Name != "test" {
		t.Errorf("name = %q, want test", target.Name)
	}

	// Unknown field should fail (DisallowUnknownFields)
	var target2 struct {
		Name string `json:"name"`
	}
	if err := parseJSON(`{"name":"test","extra":"bad"}`, &target2); err == nil {
		t.Error("expected error for unknown field, got nil")
	}
}

func TestParseJSON_InvalidJSON(t *testing.T) {
	var target struct{}
	if err := parseJSON(`{invalid`, &target); err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestMarshalJSON(t *testing.T) {
	data, err := marshalJSON(map[string]int{"a": 1})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if string(data) != `{"a":1}` {
		t.Errorf("got %s", data)
	}
}
