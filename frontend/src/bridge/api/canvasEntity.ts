// ─────────────────────────────────────────────────────────────
// Canvas Entity API — unified entities + connections
// ─────────────────────────────────────────────────────────────

import type { CanvasEntity, CanvasEntityPatch, CanvasEntityPatchWithID, CanvasConnection } from '../wails'

function go() { return window.go.app.App }

export const canvasEntityAPI = {
    createEntity: (pageID: string, type: string, x: number, y: number, w: number, h: number): Promise<CanvasEntity> =>
        go().CreateCanvasEntity(pageID, type, x, y, w, h),
    getEntity: (id: string): Promise<CanvasEntity> =>
        go().GetCanvasEntity(id),
    listEntities: (pageID: string): Promise<CanvasEntity[]> =>
        go().ListCanvasEntities(pageID),
    updateEntity: (id: string, patch: CanvasEntityPatch): Promise<void> =>
        go().UpdateCanvasEntity(id, patch),
    deleteEntity: (id: string): Promise<void> =>
        go().DeleteCanvasEntity(id),
    batchUpdate: (patches: CanvasEntityPatchWithID[]): Promise<void> =>
        go().BatchUpdateCanvasEntities(patches),
    updateZOrder: (pageID: string, orderedIDs: string[]): Promise<void> =>
        go().UpdateEntityZOrder(pageID, orderedIDs),

    // Connections
    createConnection: (pageID: string, fromID: string, toID: string): Promise<CanvasConnection> =>
        go().CreateCanvasConnection(pageID, fromID, toID),
    getConnection: (id: string): Promise<CanvasConnection> =>
        go().GetCanvasConnection(id),
    listConnections: (pageID: string): Promise<CanvasConnection[]> =>
        go().ListCanvasConnections(pageID),
    updateConnection: (id: string, fromID: string, toID: string, fromSide: string, toSide: string, label: string, color: string, style: string, fromT: number, toT: number): Promise<void> =>
        go().UpdateCanvasConnection(id, fromID, toID, fromSide, toSide, label, color, style, fromT, toT),
    deleteConnection: (id: string): Promise<void> =>
        go().DeleteCanvasConnection(id),
}
