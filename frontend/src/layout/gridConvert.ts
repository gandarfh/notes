import type { LayoutItem } from 'react-grid-layout'

/**
 * Convert a block (pixel coords) to an RGL LayoutItem (grid units).
 */
export function toLayoutItem(
    block: { id: string; x: number; y: number; width: number; height: number },
    colW: number,
    rowH: number,
): LayoutItem {
    return {
        i: block.id,
        x: Math.round(block.x / colW),
        y: Math.round(block.y / rowH),
        w: Math.max(1, Math.round(block.width / colW)),
        h: Math.max(1, Math.round(block.height / rowH)),
        minW: 1,
        minH: 1,
    }
}

/**
 * Convert an RGL LayoutItem (grid units) back to pixel coords.
 */
export function toPixels(
    item: LayoutItem,
    colW: number,
    rowH: number,
): { x: number; y: number; width: number; height: number } {
    return {
        x: item.x * colW,
        y: item.y * rowH,
        width: item.w * colW,
        height: item.h * rowH,
    }
}

/**
 * Convert a Map of blocks to an RGL Layout array.
 */
export function blocksToLayout(
    blocks: Map<string, { id: string; x: number; y: number; width: number; height: number }>,
    colW: number,
    rowH: number,
): LayoutItem[] {
    const layout: LayoutItem[] = []
    for (const block of blocks.values()) {
        layout.push(toLayoutItem(block, colW, rowH))
    }
    return layout
}

/**
 * Convert an RGL Layout back to pixel-based position updates.
 * Returns a Map of blockId → { x, y, width, height } in pixels.
 */
export function layoutToPixelUpdates(
    layout: readonly LayoutItem[],
    colW: number,
    rowH: number,
): Map<string, { x: number; y: number; width: number; height: number }> {
    const updates = new Map<string, { x: number; y: number; width: number; height: number }>()
    for (const item of layout) {
        updates.set(item.i, toPixels(item, colW, rowH))
    }
    return updates
}

/**
 * Cache for grid units that prevents rounding drift when colW changes.
 *
 * The problem: blocks store x/y/width/height in pixels. Converting to grid
 * units (Math.round(px / colW)) produces different results when colW changes
 * (e.g. container resize). This cache stores the authoritative grid units
 * so they remain stable regardless of container width changes.
 *
 * - New blocks are converted once from pixels and cached
 * - User drag/resize updates cache via `updateFromLayout`
 * - Container resizes do NOT trigger reconversion
 * - Deleted blocks are cleaned up via `buildLayout`
 */
export class GridUnitCache {
    private cache = new Map<string, LayoutItem>()

    /** Build the RGL layout array for current blocks. Uses cached grid units
     *  for known blocks; converts from pixels only for new blocks. Cleans up
     *  entries for deleted blocks. */
    buildLayout(
        blockIds: string[],
        getBlock: (id: string) => { id: string; x: number; y: number; width: number; height: number } | undefined,
        colW: number,
        rowH: number,
    ): LayoutItem[] {
        const layout: LayoutItem[] = []

        for (const id of blockIds) {
            const cached = this.cache.get(id)
            if (cached) {
                layout.push(cached)
            } else if (colW > 0) {
                const block = getBlock(id)
                if (block) {
                    const item = toLayoutItem(block, colW, rowH)
                    this.cache.set(id, item)
                    layout.push(item)
                }
            }
        }

        return layout
    }

    /** Update cache with RGL's authoritative layout (after user drag/resize). */
    updateFromLayout(layout: readonly LayoutItem[]): void {
        for (const item of layout) {
            this.cache.set(item.i, { ...item })
        }
    }

    /** Get cached grid units for a block (or undefined). */
    get(id: string): LayoutItem | undefined {
        return this.cache.get(id)
    }

    /** Check if a block has cached grid units. */
    has(id: string): boolean {
        return this.cache.has(id)
    }

    /** Clear all cached entries. */
    clear(): void {
        this.cache.clear()
    }

    /** Number of cached entries (for testing). */
    get size(): number {
        return this.cache.size
    }
}
