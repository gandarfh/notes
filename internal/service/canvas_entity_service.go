package service

import (
	"fmt"

	"notes/internal/domain"
	"notes/internal/storage"

	"github.com/google/uuid"
)

// CanvasEntityService manages the lifecycle of unified canvas entities.
type CanvasEntityService struct {
	entities    *storage.CanvasEntityStore
	connections *storage.CanvasConnectionStore
	emitter     EventEmitter
}

// NewCanvasEntityService creates a CanvasEntityService.
func NewCanvasEntityService(
	entities *storage.CanvasEntityStore,
	connections *storage.CanvasConnectionStore,
	emitter EventEmitter,
) *CanvasEntityService {
	return &CanvasEntityService{
		entities:    entities,
		connections: connections,
		emitter:     emitter,
	}
}

// CreateEntity creates a new canvas entity on a page.
func (s *CanvasEntityService) CreateEntity(pageID, entityType string, x, y, w, h float64) (*domain.CanvasEntity, error) {
	e := &domain.CanvasEntity{
		ID:          uuid.New().String(),
		PageID:      pageID,
		Type:        entityType,
		RenderMode:  domain.RenderModeForType(entityType),
		X:           x,
		Y:           y,
		Width:       w,
		Height:      h,
		CanvasProps: "{}",
	}
	if err := s.entities.CreateCanvasEntity(e); err != nil {
		return nil, fmt.Errorf("create entity: %w", err)
	}
	return e, nil
}

// GetEntity returns a canvas entity by ID.
func (s *CanvasEntityService) GetEntity(id string) (*domain.CanvasEntity, error) {
	return s.entities.GetCanvasEntity(id)
}

// ListEntities returns all entities for a page, ordered by z-index.
func (s *CanvasEntityService) ListEntities(pageID string) ([]domain.CanvasEntity, error) {
	return s.entities.ListCanvasEntities(pageID)
}

// UpdateEntity applies a partial patch to an existing entity.
func (s *CanvasEntityService) UpdateEntity(id string, patch domain.CanvasEntityPatch) error {
	e, err := s.entities.GetCanvasEntity(id)
	if err != nil {
		return err
	}
	patch.Apply(e)
	return s.entities.UpdateCanvasEntity(e)
}

// DeleteEntity removes an entity and its associated connections.
func (s *CanvasEntityService) DeleteEntity(id string) error {
	if err := s.connections.DeleteCanvasConnectionsByEntity(id); err != nil {
		return fmt.Errorf("delete entity connections: %w", err)
	}
	return s.entities.DeleteCanvasEntity(id)
}

// BatchUpdateEntities applies patches to multiple entities atomically.
func (s *CanvasEntityService) BatchUpdateEntities(patches []domain.CanvasEntityPatchWithID) error {
	entities := make([]domain.CanvasEntity, 0, len(patches))
	for _, p := range patches {
		e, err := s.entities.GetCanvasEntity(p.ID)
		if err != nil {
			return fmt.Errorf("get entity %s for batch: %w", p.ID, err)
		}
		p.Patch.Apply(e)
		entities = append(entities, *e)
	}
	return s.entities.BatchUpdateCanvasEntities(entities)
}

// UpdateZOrder sets the z-order for all entities on a page.
func (s *CanvasEntityService) UpdateZOrder(pageID string, orderedIDs []string) error {
	return s.entities.UpdateEntityZOrder(pageID, orderedIDs)
}

// CreateConnection creates a connection between two entities.
func (s *CanvasEntityService) CreateConnection(pageID, fromID, toID string) (*domain.CanvasConnection, error) {
	c := &domain.CanvasConnection{
		ID:           uuid.New().String(),
		PageID:       pageID,
		FromEntityID: fromID,
		ToEntityID:   toID,
		FromT:        0.5,
		ToT:          0.5,
		Color:        "#666666",
		Style:        domain.ConnectionStyleSolid,
	}
	if err := s.connections.CreateCanvasConnection(c); err != nil {
		return nil, fmt.Errorf("create connection: %w", err)
	}
	return c, nil
}

// GetConnection returns a canvas connection by ID.
func (s *CanvasEntityService) GetConnection(id string) (*domain.CanvasConnection, error) {
	return s.connections.GetCanvasConnection(id)
}

// ListConnections returns all connections for a page.
func (s *CanvasEntityService) ListConnections(pageID string) ([]domain.CanvasConnection, error) {
	return s.connections.ListCanvasConnections(pageID)
}

// UpdateConnection updates an existing canvas connection.
func (s *CanvasEntityService) UpdateConnection(c *domain.CanvasConnection) error {
	return s.connections.UpdateCanvasConnection(c)
}

// DeleteConnection removes a canvas connection.
func (s *CanvasEntityService) DeleteConnection(id string) error {
	return s.connections.DeleteCanvasConnection(id)
}
