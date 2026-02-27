import type { BlockPlugin, PluginRendererProps } from '../sdk'

// ── Renderer Component ─────────────────────────────────────

function DrawingRenderer({ block }: PluginRendererProps) {
    // Render a static SVG preview of drawing elements
    if (!block.content) {
        return (
            <div className="flex items-center justify-center h-full text-text-muted text-xs italic">
                Empty drawing
            </div>
        )
    }

    try {
        const elements = JSON.parse(block.content)
        if (!Array.isArray(elements) || elements.length === 0) {
            return (
                <div className="flex items-center justify-center h-full text-text-muted text-xs italic">
                    Empty drawing
                </div>
            )
        }

        // Compute bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const el of elements) {
            const x1 = el.x, y1 = el.y
            const x2 = el.x + (el.width || 0), y2 = el.y + (el.height || 0)
            if (x1 < minX) minX = x1
            if (y1 < minY) minY = y1
            if (x2 > maxX) maxX = x2
            if (y2 > maxY) maxY = y2
        }

        const pad = 20
        const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`

        return (
            <svg viewBox={vb} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                {elements.map((el: any, i: number) => {
                    const stroke = el.strokeColor || '#888'
                    const sw = el.strokeWidth || 2
                    if (el.type === 'rectangle') {
                        return <rect key={i} x={el.x} y={el.y} width={el.width} height={el.height} stroke={stroke} strokeWidth={sw} fill="none" rx={2} />
                    }
                    if (el.type === 'ellipse') {
                        return <ellipse key={i} cx={el.x + el.width / 2} cy={el.y + el.height / 2} rx={el.width / 2} ry={el.height / 2} stroke={stroke} strokeWidth={sw} fill="none" />
                    }
                    if (el.type === 'freedraw' && el.points) {
                        const d = el.points.map((p: number[], j: number) => `${j === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
                        return <path key={i} d={d} stroke={stroke} strokeWidth={sw} fill="none" />
                    }
                    if (el.type === 'text') {
                        return <text key={i} x={el.x} y={el.y} fill={stroke} fontSize={el.fontSize || 16}>{el.text}</text>
                    }
                    return null
                })}
            </svg>
        )
    } catch {
        return <div className="text-text-muted text-xs p-2">Invalid drawing data</div>
    }
}

// ── Icon ───────────────────────────────────────────────────

function DrawingIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
            <path d="M3 15c1-3 3-5 5-7s4-3 6-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="14" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const drawingPlugin: BlockPlugin = {
    type: 'drawing',
    label: 'Drawing',
    Icon: DrawingIcon,
    defaultSize: { width: 400, height: 300 },
    Renderer: DrawingRenderer,
    headerLabel: 'DRAW',
}
