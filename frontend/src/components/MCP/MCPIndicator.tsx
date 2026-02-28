// ─────────────────────────────────────────────────────────────
// MCP Activity Indicator — shows pulsing dot when MCP agent is active
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { pluginBus } from '../../plugins/sdk/runtime/eventBus'
import './MCPIndicator.css'

export function MCPIndicator() {
    const [active, setActive] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        const off = pluginBus.on('mcp:activity', () => {
            setActive(true)
            // Clear previous timer
            if (timerRef.current) clearTimeout(timerRef.current)
            // Fade out after 5 seconds of inactivity
            timerRef.current = setTimeout(() => setActive(false), 5000)
        })

        return () => {
            off()
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    if (!active) return null

    return (
        <div className="mcp-indicator" title="MCP Agent is active">
            <div className="mcp-indicator__dot" />
            <span className="mcp-indicator__label">MCP</span>
        </div>
    )
}
