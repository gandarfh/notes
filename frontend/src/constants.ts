/** Shared grid size constant for snapping (canvas, blocks, drawing) */
export const GRID_SIZE = 30

/** Snap a numeric value to the nearest grid point */
export const snapToGrid = (v: number): number => Math.round(v / GRID_SIZE) * GRID_SIZE

/** Dashboard grid: 12 columns, 60px row height, 16px gap between blocks */
export const DASHBOARD_COLS = 12
export const DASHBOARD_ROW_HEIGHT = 60
export const DASHBOARD_GAP = 16
