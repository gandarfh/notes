package domain

import "time"

type ConnectionStyle string

const (
	ConnectionStyleSolid  ConnectionStyle = "solid"
	ConnectionStyleDashed ConnectionStyle = "dashed"
	ConnectionStyleDotted ConnectionStyle = "dotted"
)

type Connection struct {
	ID          string          `json:"id"`
	PageID      string          `json:"pageId"`
	FromBlockID string          `json:"fromBlockId"`
	ToBlockID   string          `json:"toBlockId"`
	Label       string          `json:"label"`
	Color       string          `json:"color"`
	Style       ConnectionStyle `json:"style"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

type ConnectionStore interface {
	CreateConnection(c *Connection) error
	GetConnection(id string) (*Connection, error)
	ListConnections(pageID string) ([]Connection, error)
	UpdateConnection(c *Connection) error
	DeleteConnection(id string) error
	DeleteConnectionsByPage(pageID string) error
	DeleteConnectionsByBlock(blockID string) error
}
