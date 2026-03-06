package app

import "notes/internal/domain"

// ─────────────────────────────────────────────────────────────
// Canvas Entity Handlers — thin delegates to CanvasEntityService
// ─────────────────────────────────────────────────────────────

func (a *App) CreateCanvasEntity(pageID, entityType string, x, y, w, h float64) (*domain.CanvasEntity, error) {
	return a.canvasEntities.CreateEntity(pageID, entityType, x, y, w, h)
}

func (a *App) GetCanvasEntity(id string) (*domain.CanvasEntity, error) {
	return a.canvasEntities.GetEntity(id)
}

func (a *App) ListCanvasEntities(pageID string) ([]domain.CanvasEntity, error) {
	return a.canvasEntities.ListEntities(pageID)
}

func (a *App) UpdateCanvasEntity(id string, patch domain.CanvasEntityPatch) error {
	return a.canvasEntities.UpdateEntity(id, patch)
}

func (a *App) DeleteCanvasEntity(id string) error {
	return a.canvasEntities.DeleteEntity(id)
}

func (a *App) BatchUpdateCanvasEntities(patches []domain.CanvasEntityPatchWithID) error {
	return a.canvasEntities.BatchUpdateEntities(patches)
}

func (a *App) UpdateEntityZOrder(pageID string, orderedIDs []string) error {
	return a.canvasEntities.UpdateZOrder(pageID, orderedIDs)
}

// ─────────────────────────────────────────────────────────────
// Canvas Connections
// ─────────────────────────────────────────────────────────────

func (a *App) CreateCanvasConnection(pageID, fromEntityID, toEntityID string) (*domain.CanvasConnection, error) {
	return a.canvasEntities.CreateConnection(pageID, fromEntityID, toEntityID)
}

func (a *App) GetCanvasConnection(id string) (*domain.CanvasConnection, error) {
	return a.canvasEntities.GetConnection(id)
}

func (a *App) ListCanvasConnections(pageID string) ([]domain.CanvasConnection, error) {
	return a.canvasEntities.ListConnections(pageID)
}

func (a *App) UpdateCanvasConnection(id, fromEntityID, toEntityID, fromSide, toSide, label, color, style string, fromT, toT float64) error {
	c, err := a.canvasEntities.GetConnection(id)
	if err != nil {
		return err
	}
	c.FromEntityID = fromEntityID
	c.ToEntityID = toEntityID
	c.FromSide = fromSide
	c.FromT = fromT
	c.ToSide = toSide
	c.ToT = toT
	c.Label = label
	c.Color = color
	c.Style = domain.ConnectionStyle(style)
	return a.canvasEntities.UpdateConnection(c)
}

func (a *App) DeleteCanvasConnection(id string) error {
	return a.canvasEntities.DeleteConnection(id)
}
