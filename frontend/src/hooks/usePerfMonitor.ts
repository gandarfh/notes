/**
 * Performance Monitor — inject into Canvas to profile WKWebView bottlenecks.
 * Shows a real-time overlay with FPS, frame times, and marks hot-path durations.
 *
 * Usage: call usePerfMonitor() inside Canvas component.
 * Press Shift+F12 to toggle the overlay.
 * Remove this file when debugging is done.
 */
import { useEffect, useRef } from 'react'

interface FrameStats {
    fps: number
    avgFrameMs: number
    maxFrameMs: number
    dropCount: number  // frames > 16.7ms (60fps threshold)
}

export function usePerfMonitor() {
    const overlayRef = useRef<HTMLDivElement | null>(null)
    const enabledRef = useRef(false)
    const frameTimes = useRef<number[]>([])
    const lastFrameTime = useRef(performance.now())
    const rafId = useRef(0)
    const markersRef = useRef<Map<string, number[]>>(new Map())

    useEffect(() => {
        // Create overlay element
        const overlay = document.createElement('div')
        overlay.id = 'perf-monitor'
        overlay.style.cssText = `
            position: fixed; bottom: 8px; right: 8px; z-index: 99999;
            background: rgba(0,0,0,0.85); color: #0f0; font-family: monospace;
            font-size: 11px; padding: 8px 12px; border-radius: 6px;
            pointer-events: none; display: none; line-height: 1.6;
            min-width: 200px; white-space: pre;
        `
        document.body.appendChild(overlay)
        overlayRef.current = overlay

        // Toggle with Shift+F12
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'F12' && e.shiftKey) {
                enabledRef.current = !enabledRef.current
                overlay.style.display = enabledRef.current ? 'block' : 'none'
                if (enabledRef.current) startMonitoring()
                else stopMonitoring()
            }
        }
        window.addEventListener('keydown', onKey)

            // Expose marker API globally for hot-path instrumentation
            ; (window as any).__perfMark = (name: string) => {
                if (!enabledRef.current) return
                const marks = markersRef.current.get(name) || []
                marks.push(performance.now())
                markersRef.current.set(name, marks)
            }
            ; (window as any).__perfEnd = (name: string) => {
                if (!enabledRef.current) return
                const marks = markersRef.current.get(name)
                if (!marks || marks.length === 0) return
                const start = marks[marks.length - 1]
                const duration = performance.now() - start
                marks[marks.length - 1] = duration
            }

        function startMonitoring() {
            frameTimes.current = []
            lastFrameTime.current = performance.now()
            tick()
        }

        function stopMonitoring() {
            if (rafId.current) cancelAnimationFrame(rafId.current)
        }

        function tick() {
            const now = performance.now()
            const dt = now - lastFrameTime.current
            lastFrameTime.current = now
            frameTimes.current.push(dt)

            // Keep last 120 frames (~2 seconds)
            if (frameTimes.current.length > 120) frameTimes.current.shift()

            // Update overlay every 10 frames
            if (frameTimes.current.length % 10 === 0) {
                updateOverlay()
            }

            rafId.current = requestAnimationFrame(tick)
        }

        function updateOverlay() {
            const ft = frameTimes.current
            if (ft.length === 0) return

            const avg = ft.reduce((s, v) => s + v, 0) / ft.length
            const max = Math.max(...ft)
            const drops = ft.filter(t => t > 16.7).length
            const fps = 1000 / avg

            let text = `FPS: ${fps.toFixed(0)}  Avg: ${avg.toFixed(1)}ms\n`
            text += `Max: ${max.toFixed(1)}ms  Drops: ${drops}/${ft.length}\n`

            // Show frame time histogram (last 60 frames)
            const recent = ft.slice(-60)
            const barMax = 50 // ms
            text += '─'.repeat(30) + '\n'

            // Simple bar chart (compact)
            const bars = recent.map(t => {
                if (t <= 8) return '▁'
                if (t <= 16.7) return '▃'
                if (t <= 33) return '▅'
                return '█'
            }).join('')
            text += bars + '\n'

            // Show markers
            for (const [name, values] of markersRef.current.entries()) {
                if (values.length > 0) {
                    const recents = values.slice(-30)
                    const mAvg = recents.reduce((s, v) => s + v, 0) / recents.length
                    const mMax = Math.max(...recents)
                    text += `${name}: avg=${mAvg.toFixed(2)}ms max=${mMax.toFixed(2)}ms\n`
                }
            }
            // Reset markers for next period
            markersRef.current.clear()

            if (overlayRef.current) overlayRef.current.textContent = text
        }

        return () => {
            window.removeEventListener('keydown', onKey)
            stopMonitoring()
            overlay.remove()
            delete (window as any).__perfMark
            delete (window as any).__perfEnd
        }
    }, [])
}
