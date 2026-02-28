package mcpserver

import "encoding/json"

// parseJSON parses a JSON string into the target type.
func parseJSON(data string, target any) error {
	return json.Unmarshal([]byte(data), target)
}

// marshalJSON serializes a value to JSON bytes.
func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
