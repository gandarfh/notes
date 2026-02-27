/** Shared grid size constant for snapping (canvas, blocks, drawing) */
export const GRID_SIZE = 30

/** Snap a numeric value to the nearest grid point */
export const snapToGrid = (v: number): number => Math.round(v / GRID_SIZE) * GRID_SIZE
