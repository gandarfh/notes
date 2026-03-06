package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"

	"notes/internal/domain"
)

// DrawingService provides thread-safe operations on drawing elements.
// It uses per-page mutexes to prevent race conditions in the
// get-modify-save cycle.
type DrawingService struct {
	notebooks *NotebookService
	locks     sync.Map // map[string]*sync.Mutex
	idCounter atomic.Uint64
}

// NewDrawingService creates a DrawingService.
func NewDrawingService(notebooks *NotebookService) *DrawingService {
	return &DrawingService{
		notebooks: notebooks,
	}
}

// pageLock returns a per-page mutex (created on first access).
func (s *DrawingService) pageLock(pageID string) *sync.Mutex {
	v, _ := s.locks.LoadOrStore(pageID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// WithElements acquires the page lock, loads elements, calls fn, and saves
// the returned elements. Event emission is the caller's responsibility
// (MCP handlers emit "mcp:drawing-changed", app layer may emit differently).
// This eliminates the race condition in the get-modify-save cycle.
func (s *DrawingService) WithElements(ctx context.Context, pageID string,
	fn func([]domain.DrawingElement) ([]domain.DrawingElement, error)) error {

	mu := s.pageLock(pageID)
	mu.Lock()
	defer mu.Unlock()

	elements, err := s.loadElements(pageID)
	if err != nil {
		return err
	}

	result, err := fn(elements)
	if err != nil {
		return err
	}

	return s.saveElements(pageID, result)
}

// GetElements returns all drawing elements for a page (read-only).
func (s *DrawingService) GetElements(pageID string) ([]domain.DrawingElement, error) {
	mu := s.pageLock(pageID)
	mu.Lock()
	defer mu.Unlock()
	return s.loadElements(pageID)
}

// FindElement returns a single element by ID, or an error if not found.
// WARNING: Do not call from within a WithElements closure — it will deadlock.
// Use the elements slice passed to the closure instead.
func (s *DrawingService) FindElement(pageID, elementID string) (*domain.DrawingElement, error) {
	elements, err := s.GetElements(pageID)
	if err != nil {
		return nil, err
	}
	for i := range elements {
		if elements[i].ID == elementID {
			return &elements[i], nil
		}
	}
	return nil, fmt.Errorf("element %q not found", elementID)
}

// AddElement appends a single element.
func (s *DrawingService) AddElement(ctx context.Context, pageID string, el domain.DrawingElement) error {
	return s.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		return append(elements, el), nil
	})
}

// AddElements appends multiple elements.
func (s *DrawingService) AddElements(ctx context.Context, pageID string, els []domain.DrawingElement) error {
	return s.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		return append(elements, els...), nil
	})
}

// UpdateElement applies a patch to a single element by ID.
func (s *DrawingService) UpdateElement(ctx context.Context, pageID, elementID string, patch domain.DrawingPatch) error {
	return s.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		for i := range elements {
			if elements[i].ID == elementID {
				patch.Apply(&elements[i])
				return elements, nil
			}
		}
		return nil, fmt.Errorf("element %q not found", elementID)
	})
}

// UpdateElements applies patches to multiple elements.
func (s *DrawingService) UpdateElements(ctx context.Context, pageID string, patches map[string]domain.DrawingPatch) error {
	return s.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		for i := range elements {
			if p, ok := patches[elements[i].ID]; ok {
				p.Apply(&elements[i])
			}
		}
		return elements, nil
	})
}

// DeleteElement removes a single element by ID.
func (s *DrawingService) DeleteElement(ctx context.Context, pageID, elementID string) error {
	return s.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		for i := range elements {
			if elements[i].ID == elementID {
				return append(elements[:i], elements[i+1:]...), nil
			}
		}
		return nil, fmt.Errorf("element %q not found", elementID)
	})
}

// DeleteElements removes multiple elements by ID.
func (s *DrawingService) DeleteElements(ctx context.Context, pageID string, ids []string) error {
	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}
	return s.WithElements(ctx, pageID, func(elements []domain.DrawingElement) ([]domain.DrawingElement, error) {
		filtered := make([]domain.DrawingElement, 0, len(elements))
		for _, el := range elements {
			if !idSet[el.ID] {
				filtered = append(filtered, el)
			}
		}
		return filtered, nil
	})
}

// MoveElement updates the position of an element.
func (s *DrawingService) MoveElement(ctx context.Context, pageID, elementID string, x, y float64) error {
	patch := domain.DrawingPatch{X: &x, Y: &y}
	return s.UpdateElement(ctx, pageID, elementID, patch)
}

// ResizeElement updates the dimensions of an element.
func (s *DrawingService) ResizeElement(ctx context.Context, pageID, elementID string, w, h float64) error {
	patch := domain.DrawingPatch{Width: &w, Height: &h}
	return s.UpdateElement(ctx, pageID, elementID, patch)
}

// ClearAll removes all elements from a page.
func (s *DrawingService) ClearAll(ctx context.Context, pageID string) error {
	return s.WithElements(ctx, pageID, func(_ []domain.DrawingElement) ([]domain.DrawingElement, error) {
		return []domain.DrawingElement{}, nil
	})
}

// GenID generates a unique element ID with the "el_" prefix.
func (s *DrawingService) GenID() string {
	n := s.idCounter.Add(1)
	b := make([]byte, 4)
	rand.Read(b)
	return fmt.Sprintf("el_%d_%s", n, hex.EncodeToString(b))
}

// ── internal helpers ──────────────────────────────────────────

func (s *DrawingService) loadElements(pageID string) ([]domain.DrawingElement, error) {
	state, err := s.notebooks.GetPageState(pageID)
	if err != nil {
		return nil, err
	}
	if state.Page.DrawingData == "" || state.Page.DrawingData == "[]" {
		return nil, nil
	}
	var elements []domain.DrawingElement
	if err := json.Unmarshal([]byte(state.Page.DrawingData), &elements); err != nil {
		return nil, fmt.Errorf("parse drawing data: %w", err)
	}
	return elements, nil
}

func (s *DrawingService) saveElements(pageID string, elements []domain.DrawingElement) error {
	data, err := json.Marshal(elements)
	if err != nil {
		return err
	}
	return s.notebooks.UpdateDrawingData(pageID, string(data))
}
