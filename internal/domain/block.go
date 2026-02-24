package domain

import "time"

type BlockType string

const (
	BlockTypeMarkdown BlockType = "markdown"
	BlockTypeDrawing  BlockType = "drawing"
	BlockTypeImage    BlockType = "image"
	BlockTypeDatabase BlockType = "database"
	BlockTypeCode     BlockType = "code"
	BlockTypeLocalDB  BlockType = "localdb"
)

type Block struct {
	ID        string    `json:"id"`
	PageID    string    `json:"pageId"`
	Type      BlockType `json:"type"`
	X         float64   `json:"x"`
	Y         float64   `json:"y"`
	Width     float64   `json:"width"`
	Height    float64   `json:"height"`
	Content   string    `json:"content"`   // markdown text or drawing JSON
	FilePath  string    `json:"filePath"`  // path to .md file for markdown blocks
	StyleJSON string    `json:"styleJson"` // colors, borders, etc.
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type BlockStore interface {
	CreateBlock(b *Block) error
	GetBlock(id string) (*Block, error)
	ListBlocks(pageID string) ([]Block, error)
	UpdateBlock(b *Block) error
	DeleteBlock(id string) error
	DeleteBlocksByPage(pageID string) error
}
