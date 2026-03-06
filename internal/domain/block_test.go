package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBlock_JSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	b := Block{
		ID:        "blk_1",
		PageID:    "page_1",
		Type:      BlockTypeMarkdown,
		X:         100,
		Y:         200,
		Width:     400,
		Height:    300,
		Content:   "# Hello",
		FilePath:  "/tmp/hello.md",
		StyleJSON: `{"color":"red"}`,
		CreatedAt: now,
		UpdatedAt: now,
	}

	data, err := json.Marshal(b)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded Block
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.ID != b.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, b.ID)
	}
	if decoded.PageID != b.PageID {
		t.Errorf("PageID = %q, want %q", decoded.PageID, b.PageID)
	}
	if decoded.Type != b.Type {
		t.Errorf("Type = %q, want %q", decoded.Type, b.Type)
	}
	if decoded.X != 100 || decoded.Y != 200 {
		t.Errorf("position = (%v, %v), want (100, 200)", decoded.X, decoded.Y)
	}
	if decoded.Width != 400 || decoded.Height != 300 {
		t.Errorf("size = (%v, %v), want (400, 300)", decoded.Width, decoded.Height)
	}
	if decoded.Content != "# Hello" {
		t.Errorf("Content = %q, want %q", decoded.Content, b.Content)
	}
	if decoded.FilePath != "/tmp/hello.md" {
		t.Errorf("FilePath = %q, want %q", decoded.FilePath, b.FilePath)
	}
	if decoded.StyleJSON != `{"color":"red"}` {
		t.Errorf("StyleJSON = %q, want %q", decoded.StyleJSON, b.StyleJSON)
	}
}

func TestBlock_RequiredFieldsInJSON(t *testing.T) {
	b := Block{
		ID:     "blk_1",
		PageID: "page_1",
		Type:   BlockTypeCode,
	}

	data, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}

	var raw map[string]any
	json.Unmarshal(data, &raw)

	for _, field := range []string{"id", "pageId", "type", "x", "y", "width", "height"} {
		if _, exists := raw[field]; !exists {
			t.Errorf("required field %q should be present in JSON", field)
		}
	}
}

func TestBlockType_Constants(t *testing.T) {
	tests := []struct {
		bt   BlockType
		want string
	}{
		{BlockTypeMarkdown, "markdown"},
		{BlockTypeDrawing, "drawing"},
		{BlockTypeImage, "image"},
		{BlockTypeDatabase, "database"},
		{BlockTypeCode, "code"},
		{BlockTypeLocalDB, "localdb"},
		{BlockTypeChart, "chart"},
		{BlockTypeETL, "etl"},
		{BlockTypeHTTP, "http"},
	}
	for _, tc := range tests {
		if string(tc.bt) != tc.want {
			t.Errorf("BlockType %v = %q, want %q", tc.bt, string(tc.bt), tc.want)
		}
	}
}
