package service

import "strings"

// ValidDrawingColors is the set of allowed drawing colors.
// Must match the palette defined in frontend ColorPicker.tsx + StylePanel.tsx BG_COLORS.
var ValidDrawingColors = map[string]bool{
	// Grayscale
	"#1e1e2e": true, "#545475": true, "#828298": true, "#bfbfcf": true, "#e8e8f0": true,
	// Vivid
	"#e03131": true, "#f08c00": true, "#2f9e44": true, "#1971c2": true, "#9c36b5": true,
	// Pastel
	"#ffc9c9": true, "#ffec99": true, "#b2f2bb": true, "#a5d8ff": true, "#eebefa": true,
	// Special
	"transparent": true, "#343446": true,
	// Stroke defaults
	"#e0e0e0": true, "#ffffff": true, "#000000": true,
}

// SanitizeColor returns the color if it's in the palette, otherwise returns the fallback.
func SanitizeColor(color, fallback string) string {
	if color == "" {
		return fallback
	}
	normalized := strings.ToLower(strings.TrimSpace(color))
	if ValidDrawingColors[normalized] {
		return normalized
	}
	return fallback
}
