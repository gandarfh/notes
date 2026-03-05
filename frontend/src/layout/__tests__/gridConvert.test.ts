import { describe, it, expect, beforeEach } from 'vitest'
import { toLayoutItem, toPixels, blocksToLayout, layoutToPixelUpdates, GridUnitCache } from '../gridConvert'

const COL_W = 100 // 1200px / 12 cols
const ROW_H = 60

// ── toLayoutItem ────────────────────────────────────────────

describe('toLayoutItem', () => {
    it('converts pixel block to grid units', () => {
        const item = toLayoutItem({ id: 'a', x: 200, y: 120, width: 300, height: 180 }, COL_W, ROW_H)
        expect(item).toEqual({ i: 'a', x: 2, y: 2, w: 3, h: 3, minW: 1, minH: 1 })
    })

    it('enforces minimum 1 col and 1 row', () => {
        const item = toLayoutItem({ id: 'b', x: 0, y: 0, width: 10, height: 5 }, COL_W, ROW_H)
        expect(item.w).toBe(1)
        expect(item.h).toBe(1)
    })

    it('rounds to nearest grid position', () => {
        const item = toLayoutItem({ id: 'c', x: 140, y: 80, width: 250, height: 100 }, COL_W, ROW_H)
        expect(item.x).toBe(1) // 140/100 = 1.4 → 1
        expect(item.y).toBe(1) // 80/60 = 1.33 → 1
        expect(item.w).toBe(3) // 250/100 = 2.5 → 3
        expect(item.h).toBe(2) // 100/60 = 1.67 → 2
    })
})

// ── toPixels ────────────────────────────────────────────────

describe('toPixels', () => {
    it('converts grid units back to pixels', () => {
        const px = toPixels({ i: 'a', x: 2, y: 3, w: 4, h: 2 }, COL_W, ROW_H)
        expect(px).toEqual({ x: 200, y: 180, width: 400, height: 120 })
    })
})

// ── round-trip ──────────────────────────────────────────────

describe('round-trip conversion', () => {
    it('pixel → grid → pixel preserves grid-aligned positions', () => {
        const original = { id: 'rt', x: 300, y: 180, width: 400, height: 120 }
        const item = toLayoutItem(original, COL_W, ROW_H)
        const back = toPixels(item, COL_W, ROW_H)
        expect(back.x).toBe(original.x)
        expect(back.y).toBe(original.y)
        expect(back.width).toBe(original.width)
        expect(back.height).toBe(original.height)
    })

    it('block at x=0, y=0', () => {
        const original = { id: 'z', x: 0, y: 0, width: 200, height: 120 }
        const item = toLayoutItem(original, COL_W, ROW_H)
        const back = toPixels(item, COL_W, ROW_H)
        expect(back).toEqual({ x: 0, y: 0, width: 200, height: 120 })
    })

    it('block at max x (col 10 with 2-col width)', () => {
        const original = { id: 'max', x: 1000, y: 0, width: 200, height: 60 }
        const item = toLayoutItem(original, COL_W, ROW_H)
        expect(item.x).toBe(10)
        expect(item.w).toBe(2)
        const back = toPixels(item, COL_W, ROW_H)
        expect(back.x).toBe(1000)
        expect(back.width).toBe(200)
    })
})

// ── blocksToLayout ──────────────────────────────────────────

describe('blocksToLayout', () => {
    it('converts a block Map to layout array', () => {
        const blocks = new Map([
            ['a', { id: 'a', x: 0, y: 0, width: 300, height: 120 }],
            ['b', { id: 'b', x: 300, y: 0, width: 300, height: 120 }],
        ])
        const layout = blocksToLayout(blocks, COL_W, ROW_H)
        expect(layout).toHaveLength(2)
        expect(layout[0].i).toBe('a')
        expect(layout[1].i).toBe('b')
    })
})

// ── layoutToPixelUpdates ────────────────────────────────────

describe('layoutToPixelUpdates', () => {
    it('converts layout array to pixel update map', () => {
        const layout = [
            { i: 'a', x: 0, y: 0, w: 3, h: 2 },
            { i: 'b', x: 3, y: 0, w: 3, h: 2 },
        ]
        const updates = layoutToPixelUpdates(layout, COL_W, ROW_H)
        expect(updates.size).toBe(2)
        expect(updates.get('a')).toEqual({ x: 0, y: 0, width: 300, height: 120 })
        expect(updates.get('b')).toEqual({ x: 300, y: 0, width: 300, height: 120 })
    })
})

// ── GridUnitCache ───────────────────────────────────────────

describe('GridUnitCache', () => {
    let cache: GridUnitCache
    const makeBlock = (id: string, x: number, y: number, w: number, h: number) =>
        ({ id, x, y, width: w, height: h })

    beforeEach(() => {
        cache = new GridUnitCache()
    })

    describe('buildLayout', () => {
        it('converts new blocks from pixels and caches them', () => {
            const blockA = makeBlock('a', 200, 120, 300, 180)
            const layout = cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)

            expect(layout).toHaveLength(1)
            expect(layout[0]).toEqual({ i: 'a', x: 2, y: 2, w: 3, h: 3, minW: 1, minH: 1 })
            expect(cache.has('a')).toBe(true)
        })

        it('returns cached grid units for known blocks', () => {
            const blockA = makeBlock('a', 200, 120, 300, 180)
            const layout1 = cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)

            // Same block, same cache → should return identical reference
            const layout2 = cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)
            expect(layout2[0]).toBe(layout1[0])
        })

        it('grid units remain stable when colW changes (container resize)', () => {
            const blockA = makeBlock('a', 200, 120, 300, 180)

            // Initial layout at colW=100
            const layout1 = cache.buildLayout(['a'], () => blockA, 100, ROW_H)
            expect(layout1[0].w).toBe(3) // 300/100 = 3

            // Container resizes → colW=80. Without cache, 300/80=3.75→4 (WRONG).
            // With cache, grid units are stable.
            const layout2 = cache.buildLayout(['a'], () => blockA, 80, ROW_H)
            expect(layout2[0].w).toBe(3) // still 3 — cached, no reconversion
            expect(layout2[0].x).toBe(2) // still 2
        })

        it('grid units remain stable across many container widths', () => {
            const blockA = makeBlock('a', 400, 0, 400, 120)
            cache.buildLayout(['a'], () => blockA, 100, ROW_H) // w=4, x=4

            // Simulate several resize events with different colW values
            for (const cw of [80, 120, 95, 110, 75, 130]) {
                const layout = cache.buildLayout(['a'], () => blockA, cw, ROW_H)
                expect(layout[0].w).toBe(4)
                expect(layout[0].x).toBe(4)
            }
        })

        it('handles adding a new block while keeping existing cached', () => {
            const blockA = makeBlock('a', 0, 0, 300, 120)
            cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)

            const blockB = makeBlock('b', 300, 0, 300, 120)
            const getBlock = (id: string) => id === 'a' ? blockA : blockB
            const layout = cache.buildLayout(['a', 'b'], getBlock, COL_W, ROW_H)

            expect(layout).toHaveLength(2)
            expect(layout[0].i).toBe('a')
            expect(layout[1].i).toBe('b')
            expect(cache.size).toBe(2)
        })

        it('retains cache entries for blocks not in current blockIds (page switch)', () => {
            const blockA = makeBlock('a', 0, 0, 300, 120)
            const blockB = makeBlock('b', 300, 0, 300, 120)
            const getBlock = (id: string) => id === 'a' ? blockA : blockB
            cache.buildLayout(['a', 'b'], getBlock, COL_W, ROW_H)
            expect(cache.size).toBe(2)

            // Switch to a different page (no blocks from this page)
            cache.buildLayout([], () => undefined, COL_W, ROW_H)

            // Cache still has entries — they survive page switches
            expect(cache.has('a')).toBe(true)
            expect(cache.has('b')).toBe(true)
        })

        it('skips blocks when colW is zero', () => {
            const blockA = makeBlock('a', 200, 120, 300, 180)
            const layout = cache.buildLayout(['a'], () => blockA, 0, ROW_H)
            expect(layout).toHaveLength(0)
        })

        it('skips blocks not found by getBlock', () => {
            const layout = cache.buildLayout(['missing'], () => undefined, COL_W, ROW_H)
            expect(layout).toHaveLength(0)
        })
    })

    describe('updateFromLayout (user drag/resize)', () => {
        it('updates cached grid units from RGL layout', () => {
            const blockA = makeBlock('a', 0, 0, 300, 120)
            cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)

            // Simulate user dragging block 'a' to a new position
            cache.updateFromLayout([{ i: 'a', x: 5, y: 3, w: 4, h: 2 }])

            expect(cache.get('a')!.x).toBe(5)
            expect(cache.get('a')!.y).toBe(3)
            expect(cache.get('a')!.w).toBe(4)
        })

        it('updated grid units persist through container resizes', () => {
            const blockA = makeBlock('a', 0, 0, 300, 120)
            cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)

            // User resizes block to w=6
            cache.updateFromLayout([{ i: 'a', x: 0, y: 0, w: 6, h: 2 }])

            // Container resizes — the user's w=6 must survive
            const layout = cache.buildLayout(['a'], () => blockA, 80, ROW_H)
            expect(layout[0].w).toBe(6)
        })
    })

    describe('simulates real-world scenarios', () => {
        it('split pane resize does not alter block sizes', () => {
            // User creates blocks at full width (colW=100, 1200px container)
            const blocks = [
                makeBlock('a', 0, 0, 600, 120),     // 6 cols
                makeBlock('b', 600, 0, 600, 120),    // 6 cols
            ]
            const getBlock = (id: string) => blocks.find(b => b.id === id)
            cache.buildLayout(['a', 'b'], getBlock, 100, ROW_H)

            // User opens split pane → container shrinks to 800px → colW=66.67
            const layout2 = cache.buildLayout(['a', 'b'], getBlock, 800 / 12, ROW_H)
            expect(layout2[0].w).toBe(6) // still 6 cols, not recalculated
            expect(layout2[1].w).toBe(6)

            // User closes split pane → container back to 1200px → colW=100
            const layout3 = cache.buildLayout(['a', 'b'], getBlock, 100, ROW_H)
            expect(layout3[0].w).toBe(6)
            expect(layout3[1].w).toBe(6)
        })

        it('user resizes block, then container resizes — user size preserved', () => {
            const blockA = makeBlock('a', 0, 0, 400, 120) // initially 4 cols
            cache.buildLayout(['a'], () => blockA, COL_W, ROW_H)
            expect(cache.get('a')!.w).toBe(4)

            // User resizes block to 8 cols via drag
            cache.updateFromLayout([{ i: 'a', x: 0, y: 0, w: 8, h: 2 }])

            // Container resizes multiple times — w=8 must never change
            for (const containerW of [900, 1100, 700, 1400, 1200]) {
                const layout = cache.buildLayout(['a'], () => blockA, containerW / 12, ROW_H)
                expect(layout[0].w).toBe(8)
            }
        })

        it('new block added after container resize uses current colW', () => {
            const blockA = makeBlock('a', 0, 0, 400, 120)
            cache.buildLayout(['a'], () => blockA, 100, ROW_H) // colW=100 → w=4

            // Container resizes to 960px → colW=80
            const blockB = makeBlock('b', 0, 120, 240, 120)
            const getBlock = (id: string) => id === 'a' ? blockA : blockB
            const layout = cache.buildLayout(['a', 'b'], getBlock, 80, ROW_H)

            expect(layout[0].w).toBe(4) // cached — stable
            expect(layout[1].w).toBe(3) // new — 240/80 = 3
        })

        it('navigate away and back preserves user resize', () => {
            // Page A: user resizes block to w=8
            const blockA = makeBlock('a', 0, 0, 400, 120)
            cache.buildLayout(['a'], () => blockA, 100, ROW_H)
            cache.updateFromLayout([{ i: 'a', x: 0, y: 0, w: 8, h: 3 }])

            // Navigate to page B (different blocks)
            const blockX = makeBlock('x', 0, 0, 200, 120)
            cache.buildLayout(['x'], () => blockX, 100, ROW_H)

            // Navigate back to page A — cache must still have block 'a'
            const layout = cache.buildLayout(['a'], () => blockA, 100, ROW_H)
            expect(layout[0].w).toBe(8) // user's resize preserved
            expect(layout[0].h).toBe(3)
        })

        it('navigate away and back with different colW preserves user resize', () => {
            // Page A at colW=100: user resizes block to w=6
            const blockA = makeBlock('a', 0, 0, 400, 120)
            cache.buildLayout(['a'], () => blockA, 100, ROW_H)
            cache.updateFromLayout([{ i: 'a', x: 0, y: 0, w: 6, h: 2 }])

            // Navigate to page B
            cache.buildLayout([], () => undefined, 100, ROW_H)

            // Navigate back to page A with split pane open (colW=80)
            // Without cache persistence, 400/80=5 (WRONG). With cache: w=6
            const layout = cache.buildLayout(['a'], () => blockA, 80, ROW_H)
            expect(layout[0].w).toBe(6)
        })
    })
})
