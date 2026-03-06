package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestConnection_JSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	c := Connection{
		ID:          "conn_1",
		PageID:      "page_1",
		FromBlockID: "blk_1",
		ToBlockID:   "blk_2",
		Label:       "depends on",
		Color:       "#ff0000",
		Style:       ConnectionStyleDashed,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	data, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded Connection
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.ID != c.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, c.ID)
	}
	if decoded.FromBlockID != "blk_1" || decoded.ToBlockID != "blk_2" {
		t.Errorf("endpoints = (%q, %q), want (blk_1, blk_2)", decoded.FromBlockID, decoded.ToBlockID)
	}
	if decoded.Label != "depends on" {
		t.Errorf("Label = %q, want %q", decoded.Label, c.Label)
	}
	if decoded.Color != "#ff0000" {
		t.Errorf("Color = %q, want %q", decoded.Color, c.Color)
	}
	if decoded.Style != ConnectionStyleDashed {
		t.Errorf("Style = %q, want %q", decoded.Style, ConnectionStyleDashed)
	}
}

func TestConnection_RequiredFieldsInJSON(t *testing.T) {
	c := Connection{
		ID:          "conn_1",
		PageID:      "page_1",
		FromBlockID: "blk_1",
		ToBlockID:   "blk_2",
	}

	data, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}

	var raw map[string]any
	json.Unmarshal(data, &raw)

	for _, field := range []string{"id", "pageId", "fromBlockId", "toBlockId", "style"} {
		if _, exists := raw[field]; !exists {
			t.Errorf("required field %q should be present in JSON", field)
		}
	}
}

func TestConnectionStyle_Constants(t *testing.T) {
	tests := []struct {
		cs   ConnectionStyle
		want string
	}{
		{ConnectionStyleSolid, "solid"},
		{ConnectionStyleDashed, "dashed"},
		{ConnectionStyleDotted, "dotted"},
	}
	for _, tc := range tests {
		if string(tc.cs) != tc.want {
			t.Errorf("ConnectionStyle %v = %q, want %q", tc.cs, string(tc.cs), tc.want)
		}
	}
}
