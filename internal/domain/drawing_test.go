package domain

import (
	"encoding/json"
	"testing"
)

func strPtr(s string) *string    { return &s }
func f64Ptr(f float64) *float64  { return &f }
func boolPtr(b bool) *bool       { return &b }

func TestDrawingElement_JSONRoundTrip(t *testing.T) {
	el := DrawingElement{
		ID:              "el_1",
		Type:            DrawingTypeRectangle,
		X:               100,
		Y:               200,
		Width:           300,
		Height:          150,
		StrokeColor:     "#e8e8f0",
		StrokeWidth:     2,
		BackgroundColor: "transparent",
		Text:            strPtr("hello"),
		FontSize:        f64Ptr(16),
		Roundness:       boolPtr(true),
		BorderRadius:    f64Ptr(8),
	}

	data, err := json.Marshal(el)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded DrawingElement
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.ID != el.ID || decoded.Type != el.Type {
		t.Errorf("ID/Type mismatch: %v vs %v", decoded, el)
	}
	if decoded.X != 100 || decoded.Y != 200 || decoded.Width != 300 {
		t.Error("position/size mismatch")
	}
	if decoded.Text == nil || *decoded.Text != "hello" {
		t.Error("text mismatch")
	}
	if decoded.FontSize == nil || *decoded.FontSize != 16 {
		t.Error("fontSize mismatch")
	}
}

func TestDrawingElement_OmitsNilOptionals(t *testing.T) {
	el := DrawingElement{
		ID:              "el_1",
		Type:            DrawingTypeEllipse,
		StrokeColor:     "#000",
		StrokeWidth:     1,
		BackgroundColor: "transparent",
	}

	data, err := json.Marshal(el)
	if err != nil {
		t.Fatal(err)
	}

	// Optional fields should not appear in JSON when nil
	var raw map[string]any
	json.Unmarshal(data, &raw)

	for _, field := range []string{"text", "fontSize", "fontFamily", "roundness", "label", "startConnection"} {
		if _, exists := raw[field]; exists {
			t.Errorf("nil field %q should be omitted from JSON", field)
		}
	}

	// Required fields should always be present (even if zero)
	for _, field := range []string{"id", "type", "x", "y", "width", "height", "strokeColor", "strokeWidth", "backgroundColor"} {
		if _, exists := raw[field]; !exists {
			t.Errorf("required field %q should be present in JSON", field)
		}
	}
}

func TestDrawingConnection_JSONRoundTrip(t *testing.T) {
	conn := DrawingConnection{
		ElementID: "shape_1",
		Side:      "right",
		T:         0.5,
	}

	data, err := json.Marshal(conn)
	if err != nil {
		t.Fatal(err)
	}

	var decoded DrawingConnection
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}

	if decoded.ElementID != "shape_1" || decoded.Side != "right" || decoded.T != 0.5 {
		t.Errorf("connection mismatch: %+v", decoded)
	}
}

func TestDrawingElement_ArrowWithConnections(t *testing.T) {
	el := DrawingElement{
		ID:          "arrow_1",
		Type:        DrawingTypeOrtho,
		StrokeColor: "#e8e8f0",
		StrokeWidth: 2,
		BackgroundColor: "transparent",
		Points:      [][]float64{{0, 0}, {100, 0}, {100, 100}},
		StartConnection: &DrawingConnection{ElementID: "s1", Side: "right", T: 0.5},
		EndConnection:   &DrawingConnection{ElementID: "s2", Side: "left", T: 0.5},
		ArrowEnd:    strPtr("arrow"),
		ArrowStart:  strPtr("none"),
	}

	data, err := json.Marshal(el)
	if err != nil {
		t.Fatal(err)
	}

	var decoded DrawingElement
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}

	if decoded.StartConnection == nil || decoded.StartConnection.ElementID != "s1" {
		t.Error("startConnection mismatch")
	}
	if decoded.EndConnection == nil || decoded.EndConnection.Side != "left" {
		t.Error("endConnection mismatch")
	}
	if len(decoded.Points) != 3 {
		t.Errorf("points len = %d, want 3", len(decoded.Points))
	}
}

func TestDrawingPatch_Apply(t *testing.T) {
	el := DrawingElement{
		ID:              "el_1",
		Type:            DrawingTypeRectangle,
		X:               10,
		Y:               20,
		Width:           100,
		Height:          50,
		StrokeColor:     "#000",
		StrokeWidth:     1,
		BackgroundColor: "transparent",
	}

	patch := DrawingPatch{
		X:               f64Ptr(50),
		Y:               f64Ptr(60),
		StrokeColor:     strPtr("#fff"),
		Text:            strPtr("updated"),
		BackgroundColor: strPtr("#e03131"),
	}

	patch.Apply(&el)

	if el.X != 50 || el.Y != 60 {
		t.Errorf("position not updated: (%v, %v)", el.X, el.Y)
	}
	if el.StrokeColor != "#fff" {
		t.Errorf("strokeColor = %q, want #fff", el.StrokeColor)
	}
	if el.Text == nil || *el.Text != "updated" {
		t.Error("text not updated")
	}
	if el.BackgroundColor != "#e03131" {
		t.Errorf("backgroundColor = %q, want #e03131", el.BackgroundColor)
	}
	// Unpatched fields should remain unchanged
	if el.Width != 100 || el.Height != 50 {
		t.Error("unpatched size changed")
	}
	if el.ID != "el_1" {
		t.Error("ID changed")
	}
}

func TestDrawingPatch_Apply_NilFieldsNoOp(t *testing.T) {
	el := DrawingElement{
		X:           10,
		StrokeColor: "#000",
		Text:        strPtr("original"),
	}

	// Empty patch — should change nothing
	patch := DrawingPatch{}
	patch.Apply(&el)

	if el.X != 10 || el.StrokeColor != "#000" {
		t.Error("empty patch should not change anything")
	}
	if el.Text == nil || *el.Text != "original" {
		t.Error("empty patch should not change text")
	}
}

func TestDrawingElement_IsArrowElement(t *testing.T) {
	tests := []struct {
		typ  DrawingElementType
		want bool
	}{
		{DrawingTypeArrow, true},
		{DrawingTypeOrtho, true},
		{DrawingTypeRectangle, false},
		{DrawingTypeText, false},
		{DrawingTypeGroup, false},
	}
	for _, tc := range tests {
		el := DrawingElement{Type: tc.typ}
		if got := el.IsArrowElement(); got != tc.want {
			t.Errorf("IsArrowElement(%q) = %v, want %v", tc.typ, got, tc.want)
		}
	}
}

func TestDrawingElement_IsGroupElement(t *testing.T) {
	// Type == group
	el := DrawingElement{Type: DrawingTypeGroup}
	if !el.IsGroupElement() {
		t.Error("type=group should be group")
	}

	// isGroup flag = true
	el = DrawingElement{Type: DrawingTypeRectangle, IsGroup: boolPtr(true)}
	if !el.IsGroupElement() {
		t.Error("isGroup=true should be group")
	}

	// Regular element
	el = DrawingElement{Type: DrawingTypeRectangle}
	if el.IsGroupElement() {
		t.Error("regular element should not be group")
	}
}

func TestDrawingElement_Center(t *testing.T) {
	el := DrawingElement{X: 100, Y: 200, Width: 60, Height: 40}
	if el.CenterX() != 130 || el.CenterY() != 220 {
		t.Errorf("center = (%v, %v), want (130, 220)", el.CenterX(), el.CenterY())
	}
}
