package mcpserver

import (
	"encoding/json"
	"strings"
)

// parseJSON parses a JSON string into the target type with strict validation.
func parseJSON(data string, target any) error {
	dec := json.NewDecoder(strings.NewReader(data))
	dec.DisallowUnknownFields()
	return dec.Decode(target)
}

// marshalJSON serializes a value to JSON bytes.
func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
