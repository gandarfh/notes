package etl

// ── Record ─────────────────────────────────────────────────
// Common intermediate data format.
// All sources emit Records, all destinations consume Records.
// Inspired by the Airbyte record protocol / Singer record message.

// Field describes a single column in a dataset.
type Field struct {
	Name string `json:"name"`
	Type string `json:"type"` // "text" | "number" | "boolean" | "datetime"
}

// Schema describes the shape of records coming from a source.
type Schema struct {
	Fields []Field `json:"fields"`
}

// FieldNames returns an ordered list of field names.
func (s *Schema) FieldNames() []string {
	names := make([]string, len(s.Fields))
	for i, f := range s.Fields {
		names[i] = f.Name
	}
	return names
}

// Record is a single row of data flowing through the pipeline.
type Record struct {
	Data map[string]any `json:"data"`
}
