package service

import "testing"

func TestSanitizeColor(t *testing.T) {
	tests := []struct {
		color, fallback, want string
	}{
		// Valid palette colors
		{"#e03131", "#000", "#e03131"},
		{"#a5d8ff", "#000", "#a5d8ff"},
		{"transparent", "#000", "transparent"},
		// Case insensitive — returns normalized (lowercase)
		{"#E03131", "#000", "#e03131"},
		// Invalid → fallback
		{"#xyz123", "#000000", "#000000"},
		{"red", "#000000", "#000000"},
		// Empty → fallback
		{"", "#ffffff", "#ffffff"},
		// Whitespace trimmed and normalized
		{" #e03131 ", "#000", "#e03131"},
	}
	for _, tc := range tests {
		got := SanitizeColor(tc.color, tc.fallback)
		if got != tc.want {
			t.Errorf("SanitizeColor(%q, %q) = %q, want %q", tc.color, tc.fallback, got, tc.want)
		}
	}
}

func TestValidDrawingColors_Coverage(t *testing.T) {
	// Verify all expected colors are in the map
	expected := []string{
		"#1e1e2e", "#545475", "#828298", "#bfbfcf", "#e8e8f0",
		"#e03131", "#f08c00", "#2f9e44", "#1971c2", "#9c36b5",
		"#ffc9c9", "#ffec99", "#b2f2bb", "#a5d8ff", "#eebefa",
		"transparent", "#343446",
		"#e0e0e0", "#ffffff", "#000000",
	}
	for _, c := range expected {
		if !ValidDrawingColors[c] {
			t.Errorf("missing color %q from ValidDrawingColors", c)
		}
	}

	// Total count
	if len(ValidDrawingColors) != len(expected) {
		t.Errorf("ValidDrawingColors has %d entries, expected %d", len(ValidDrawingColors), len(expected))
	}
}
