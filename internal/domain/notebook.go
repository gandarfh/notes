package domain

import "time"

type Notebook struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Icon      string    `json:"icon"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Page struct {
	ID           string    `json:"id"`
	NotebookID   string    `json:"notebookId"`
	Name         string    `json:"name"`
	Order        int       `json:"order"`
	ViewportX    float64   `json:"viewportX"`
	ViewportY    float64   `json:"viewportY"`
	ViewportZoom float64   `json:"viewportZoom"`
	DrawingData  string    `json:"drawingData"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type NotebookStore interface {
	CreateNotebook(nb *Notebook) error
	GetNotebook(id string) (*Notebook, error)
	ListNotebooks() ([]Notebook, error)
	UpdateNotebook(nb *Notebook) error
	DeleteNotebook(id string) error

	CreatePage(p *Page) error
	GetPage(id string) (*Page, error)
	ListPages(notebookID string) ([]Page, error)
	UpdatePage(p *Page) error
	DeletePage(id string) error
	DeletePagesByNotebook(notebookID string) error
}
