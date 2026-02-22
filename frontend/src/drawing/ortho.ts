/**
 * Orthogonal Connector Routing
 * Based on jose-mdz's algorithm: rulers → grid → spots → graph → Dijkstra → simplify
 * Adapted for arrow-local coordinates (origin = arrow start point)
 */
import { type AnchorSide, type DrawingElement, GRID } from './types'

export interface Rect { x: number; y: number; w: number; h: number }

// ── Helpers ────────────────────────────────────────────────

interface Pt { x: number; y: number }
const pt = (x: number, y: number): Pt => ({ x, y })
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) // manhattan

function rectContains(r: Rect, p: Pt, margin: number): boolean {
    return p.x >= r.x - margin && p.x <= r.x + r.w + margin &&
        p.y >= r.y - margin && p.y <= r.y + r.h + margin
}

/** Does an axis-aligned segment cross strictly through a rect interior? */
function edgeCrossesRect(a: Pt, b: Pt, r: Rect): boolean {
    if (Math.abs(a.y - b.y) < 0.5) {
        const y = a.y
        if (y <= r.y || y >= r.y + r.h) return false
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x)
        return minX < r.x + r.w && maxX > r.x
    }
    if (Math.abs(a.x - b.x) < 0.5) {
        const x = a.x
        if (x <= r.x || x >= r.x + r.w) return false
        const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y)
        return minY < r.y + r.h && maxY > r.y
    }
    return false
}

// ── Dijkstra on a sparse point graph ───────────────────────

type Dir = 'h' | 'v'

interface GNode {
    pt: Pt
    dist: number
    prev: GNode | null
    dir: Dir | null  // direction we arrived from
}

function buildGraphAndRoute(spots: Pt[], origin: Pt, destination: Pt, shapeRects: Rect[]): Pt[] {
    // Index spots by x and y for fast neighbor lookup
    const byX = new Map<number, Pt[]>()
    const byY = new Map<number, Pt[]>()
    for (const s of spots) {
        const xs = Math.round(s.x * 100)
        const ys = Math.round(s.y * 100)
        if (!byX.has(xs)) byX.set(xs, [])
        byX.get(xs)!.push(s)
        if (!byY.has(ys)) byY.set(ys, [])
        byY.get(ys)!.push(s)
    }

    // Sort each column/row by the other coordinate
    for (const arr of byX.values()) arr.sort((a, b) => a.y - b.y)
    for (const arr of byY.values()) arr.sort((a, b) => a.x - b.x)

    // Build adjacency: connect each spot to its nearest neighbor in same row/column
    const key = (p: Pt) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
    const adj = new Map<string, { to: Pt; w: number; dir: Dir }[]>()
    for (const s of spots) adj.set(key(s), [])

    // Block edges that cross through actual shape bodies (not inflated)
    const blocked = (a: Pt, b: Pt) => shapeRects.some(o => edgeCrossesRect(a, b, o))

    for (const arr of byX.values()) {
        for (let i = 0; i < arr.length - 1; i++) {
            const a = arr[i], b = arr[i + 1]
            if (blocked(a, b)) continue
            const w = Math.abs(b.y - a.y)
            adj.get(key(a))!.push({ to: b, w, dir: 'v' })
            adj.get(key(b))!.push({ to: a, w, dir: 'v' })
        }
    }
    for (const arr of byY.values()) {
        for (let i = 0; i < arr.length - 1; i++) {
            const a = arr[i], b = arr[i + 1]
            if (blocked(a, b)) continue
            const w = Math.abs(b.x - a.x)
            adj.get(key(a))!.push({ to: b, w, dir: 'h' })
            adj.get(key(b))!.push({ to: a, w, dir: 'h' })
        }
    }

    // Dijkstra with bend penalty
    const nodes = new Map<string, GNode>()
    for (const s of spots) nodes.set(key(s), { pt: s, dist: Infinity, prev: null, dir: null })

    const originNode = nodes.get(key(origin))
    const destNode = nodes.get(key(destination))
    if (!originNode || !destNode) return [origin, destination] // fallback

    originNode.dist = 0
    const visited = new Set<string>()
    const queue: GNode[] = [originNode]

    while (queue.length > 0) {
        // Get node with smallest distance
        let minIdx = 0
        for (let i = 1; i < queue.length; i++) {
            if (queue[i].dist < queue[minIdx].dist) minIdx = i
        }
        const cur = queue[minIdx]
        queue.splice(minIdx, 1)

        const ck = key(cur.pt)
        if (visited.has(ck)) continue
        visited.add(ck)

        if (ck === key(destination)) break

        const edges = adj.get(ck) || []
        for (const edge of edges) {
            const ek = key(edge.to)
            if (visited.has(ek)) continue
            const neighbor = nodes.get(ek)
            if (!neighbor) continue

            // Bend penalty: penalize direction changes heavily
            const bendPenalty = (cur.dir && cur.dir !== edge.dir) ? Math.pow(edge.w + 1, 2) : 0
            const newDist = cur.dist + edge.w + bendPenalty

            if (newDist < neighbor.dist) {
                neighbor.dist = newDist
                neighbor.prev = cur
                neighbor.dir = edge.dir
                queue.push(neighbor)
            }
        }
    }

    // Reconstruct path
    const path: Pt[] = []
    let n: GNode | null = destNode
    while (n) {
        path.unshift(n.pt)
        n = n.prev
    }

    return path.length >= 2 ? path : [origin, destination]
}

// ── Main routing function ──────────────────────────────────

export function computeOrthoRoute(
    dx: number, dy: number,
    startSide?: AnchorSide, endSide?: AnchorSide,
    startRect?: Rect, endRect?: Rect,
): number[][] {
    const margin = GRID

    // Simple fallback if no side info
    if (!startSide && !endSide) {
        return [[0, 0], [dx, 0], [dx, dy]]
    }

    // Compute origin/destination extrusions (antenna points)
    const origin = pt(0, 0)    // arrow start
    const dest = pt(dx, dy)    // arrow end

    const extrudeDir: Record<AnchorSide, Pt> = {
        top: pt(0, -margin), bottom: pt(0, margin),
        left: pt(-margin, 0), right: pt(margin, 0),
    }

    const antenna1 = startSide ? pt(extrudeDir[startSide].x, extrudeDir[startSide].y) : origin
    const antenna2 = endSide ? pt(dx + extrudeDir[endSide].x, dy + extrudeDir[endSide].y) : dest

    // Build inflated obstacle rects
    const obstacles: Rect[] = []
    if (startRect) obstacles.push({
        x: startRect.x - margin, y: startRect.y - margin,
        w: startRect.w + margin * 2, h: startRect.h + margin * 2,
    })
    if (endRect) obstacles.push({
        x: endRect.x - margin, y: endRect.y - margin,
        w: endRect.w + margin * 2, h: endRect.h + margin * 2,
    })

    // Build rulers from obstacle edges + antenna points
    const vRulers: number[] = []
    const hRulers: number[] = []

    for (const obs of obstacles) {
        vRulers.push(obs.x, obs.x + obs.w)
        hRulers.push(obs.y, obs.y + obs.h)
    }

    // Add antenna coordinates as rulers
    const startVertical = startSide === 'top' || startSide === 'bottom'
    const endVertical = endSide === 'top' || endSide === 'bottom'
    if (startVertical) vRulers.push(antenna1.x); else hRulers.push(antenna1.y)
    if (endVertical) vRulers.push(antenna2.x); else hRulers.push(antenna2.y)

    // Make unique and sorted
    const uniqSort = (arr: number[]) => [...new Set(arr.map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b)
    const vr = uniqSort(vRulers)
    const hr = uniqSort(hRulers)

    // Global bounds with margin
    const allX = [origin.x, dest.x, antenna1.x, antenna2.x, ...vr]
    const allY = [origin.y, dest.y, antenna1.y, antenna2.y, ...hr]
    const boundsL = Math.min(...allX) - margin
    const boundsT = Math.min(...allY) - margin
    const boundsR = Math.max(...allX) + margin
    const boundsB = Math.max(...allY) + margin

    // Generate grid cells from rulers
    const cellXs = [boundsL, ...vr, boundsR]
    const cellYs = [boundsT, ...hr, boundsB]

    // Generate spots from grid intersections + cell edges/centers
    const rawSpots: Pt[] = []
    for (const x of cellXs) {
        for (const y of cellYs) {
            rawSpots.push(pt(x, y))
        }
    }
    // Add midpoints between consecutive rulers
    for (let i = 0; i < cellXs.length - 1; i++) {
        const mx = (cellXs[i] + cellXs[i + 1]) / 2
        for (const y of cellYs) rawSpots.push(pt(mx, y))
        for (let j = 0; j < cellYs.length - 1; j++) {
            const my = (cellYs[j] + cellYs[j + 1]) / 2
            rawSpots.push(pt(mx, my))
        }
    }
    for (let j = 0; j < cellYs.length - 1; j++) {
        const my = (cellYs[j] + cellYs[j + 1]) / 2
        for (const x of cellXs) rawSpots.push(pt(x, my))
    }

    // Always include antenna points
    rawSpots.push(antenna1, antenna2)

    // Filter out spots inside original shape rects
    const originalObstacles: Rect[] = []
    if (startRect) originalObstacles.push(startRect)
    if (endRect) originalObstacles.push(endRect)

    const spots = rawSpots.filter(p => {
        for (const obs of originalObstacles) {
            if (rectContains(obs, p, 1)) return false
        }
        return true
    })

    // Deduplicate spots
    const seen = new Set<string>()
    const uniqueSpots: Pt[] = []
    for (const s of spots) {
        const k = `${Math.round(s.x * 100)},${Math.round(s.y * 100)}`
        if (!seen.has(k)) { seen.add(k); uniqueSpots.push(s) }
    }

    // Run Dijkstra pathfinding (block edges through original shape bodies)
    const path = buildGraphAndRoute(uniqueSpots, antenna1, antenna2, originalObstacles)

    // Compose final path: origin → antenna path → destination
    const fullPath = [origin, ...path, dest]

    // Simplify: remove collinear points
    const simplified: Pt[] = [fullPath[0]]
    for (let i = 1; i < fullPath.length - 1; i++) {
        const prev = fullPath[i - 1], cur = fullPath[i], next = fullPath[i + 1]
        const sameX = Math.abs(prev.x - cur.x) < 0.5 && Math.abs(cur.x - next.x) < 0.5
        const sameY = Math.abs(prev.y - cur.y) < 0.5 && Math.abs(cur.y - next.y) < 0.5
        if (!sameX && !sameY) simplified.push(cur)
    }
    simplified.push(fullPath[fullPath.length - 1])

    // Convert to number[][] and deduplicate
    const result: number[][] = simplified.map(p => [p.x, p.y])
    const clean: number[][] = [result[0]]
    for (let i = 1; i < result.length; i++) {
        if (Math.abs(result[i][0] - clean[clean.length - 1][0]) > 0.5 ||
            Math.abs(result[i][1] - clean[clean.length - 1][1]) > 0.5) {
            clean.push(result[i])
        }
    }

    return clean.length >= 2 ? clean : [[0, 0], [dx, dy]]
}

// ── Utilities for manual editing ──────────────────────────

/** Remove redundant collinear waypoints from ortho-arrow */
export function simplifyOrthoPoints(el: DrawingElement): void {
    if (!el.points || el.points.length < 3) return
    let i = 0
    while (i < el.points.length - 2) {
        const a = el.points[i], b = el.points[i + 1], c = el.points[i + 2]
        const sameX = Math.abs(a[0] - b[0]) < 1 && Math.abs(b[0] - c[0]) < 1
        const sameY = Math.abs(a[1] - b[1]) < 1 && Math.abs(b[1] - c[1]) < 1
        if (sameX || sameY) {
            el.points.splice(i + 1, 1)
        } else {
            i++
        }
    }
}

/** Ensure every segment is strictly horizontal or vertical */
export function enforceOrthogonality(el: DrawingElement): void {
    if (!el.points || el.points.length < 2) return
    for (let i = 0; i < el.points.length - 1; i++) {
        const a = el.points[i], b = el.points[i + 1]
        const adx = Math.abs(a[0] - b[0])
        const ady = Math.abs(a[1] - b[1])
        if (adx > 0.5 && ady > 0.5) {
            if (adx <= ady) {
                b[0] = a[0]
            } else {
                b[1] = a[1]
            }
        }
    }
}
