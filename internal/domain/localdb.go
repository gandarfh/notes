package domain

import "time"

// ColumnType defines the data type of a local database column.
type ColumnType string

const (
	ColTypeText        ColumnType = "text"
	ColTypeNumber      ColumnType = "number"
	ColTypeDate        ColumnType = "date"
	ColTypeDatetime    ColumnType = "datetime"
	ColTypeSelect      ColumnType = "select"
	ColTypeMultiSelect ColumnType = "multi-select"
	ColTypeCheckbox    ColumnType = "checkbox"
	ColTypeURL         ColumnType = "url"
	ColTypePerson      ColumnType = "person"
	ColTypeTimer       ColumnType = "timer"
	ColTypeFormula     ColumnType = "formula"
	ColTypeRelation    ColumnType = "relation"
	ColTypeRollup      ColumnType = "rollup"
	ColTypeProgress    ColumnType = "progress"
	ColTypeRating      ColumnType = "rating"
)

// LocalDatabase represents a user-created structured table stored locally.
// ConfigJSON holds column definitions and view settings.
type LocalDatabase struct {
	ID         string    `json:"id"`
	BlockID    string    `json:"blockId"`
	Name       string    `json:"name"`
	ConfigJSON string    `json:"configJson"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// LocalDBRow is a single row in a local database.
// DataJSON stores column values as { "col_id": value }.
type LocalDBRow struct {
	ID         string    `json:"id"`
	DatabaseID string    `json:"databaseId"`
	DataJSON   string    `json:"dataJson"`
	SortOrder  int       `json:"sortOrder"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// LocalDatabaseStore manages CRUD for local databases and their rows.
type LocalDatabaseStore interface {
	CreateDatabase(db *LocalDatabase) error
	GetDatabase(id string) (*LocalDatabase, error)
	GetDatabaseByBlock(blockID string) (*LocalDatabase, error)
	UpdateDatabase(db *LocalDatabase) error
	DeleteDatabase(id string) error

	CreateRow(row *LocalDBRow) error
	GetRow(id string) (*LocalDBRow, error)
	ListRows(databaseID string) ([]LocalDBRow, error)
	UpdateRow(row *LocalDBRow) error
	DeleteRow(id string) error
	DeleteRowsByDatabase(databaseID string) error
	ReorderRows(databaseID string, rowIDs []string) error
}
