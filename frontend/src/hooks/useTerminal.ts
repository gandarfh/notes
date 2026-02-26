import { useRef, useCallback, useEffect } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { api, onEvent } from '../bridge/wails'
import { useAppStore } from '../store'

export interface TerminalHandle {
    write: (data: Uint8Array | string) => void
    dispose: () => void
}

/**
 * Hook that manages a single inline terminal (xterm.js + Neovim).
 * Returns open/close functions that the BlockContainer can call.
 */
export function useTerminal() {
    const xtermRef = useRef<XTerm | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const resizeObsRef = useRef<ResizeObserver | null>(null)
    const cleanupEventsRef = useRef<(() => void)[]>([])

    const dispose = useCallback(() => {
        resizeObsRef.current?.disconnect()
        resizeObsRef.current = null
        xtermRef.current?.dispose()
        xtermRef.current = null
        fitAddonRef.current = null
        cleanupEventsRef.current.forEach(fn => fn())
        cleanupEventsRef.current = []
    }, [])

    /**
     * Mount xterm.js terminal into a container element.
     * Wires up PTY communication via Wails backend.
     */
    const open = useCallback(async (container: HTMLElement, blockId: string, lineNumber: number = 1) => {
        dispose()

        const { setEditing, resizeBlock, blocks } = useAppStore.getState()
        setEditing(blockId)

        // Expand block for comfortable terminal
        const block = blocks.get(blockId)
        if (block) {
            const minW = 520, minH = 380
            if (block.width < minW || block.height < minH) {
                resizeBlock(blockId, Math.max(block.width, minW), Math.max(block.height, minH))
                useAppStore.getState().saveBlockPosition(blockId)
            }
        }

        const fitAddon = new FitAddon()
        const xterm = new XTerm({
            fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', monospace",
            fontSize: 13,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'block',
            allowProposedApi: true,
            scrollback: 1000,
        })

        xterm.loadAddon(fitAddon)
        xterm.open(container)

        // WebGL renderer
        try {
            const webgl = new WebglAddon()
            webgl.onContextLoss(() => webgl.dispose())
            xterm.loadAddon(webgl)
        } catch { }

        xtermRef.current = xterm
        fitAddonRef.current = fitAddon

        // Forward keystrokes to PTY
        xterm.onData((data) => {
            api.terminalWrite(data).catch(() => { })
        })

        // Fit and get initial dims
        let initialCols = 80, initialRows = 24
        try {
            fitAddon.fit()
            const dims = fitAddon.proposeDimensions()
            if (dims) { initialCols = dims.cols; initialRows = dims.rows }
        } catch { }

        // Watch container resize
        const obs = new ResizeObserver(() => {
            try {
                fitAddon.fit()
                const dims = fitAddon.proposeDimensions()
                if (dims) api.terminalResize(dims.cols, dims.rows).catch(() => { })
            } catch { }
        })
        obs.observe(container)
        resizeObsRef.current = obs

        // Listen for PTY output
        const unsub1 = onEvent('terminal:data', (encoded: string) => {
            const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
            xtermRef.current?.write(bytes)
        })

        // Listen for Neovim exit
        const unsub2 = onEvent('terminal:exit', (data: { cursorLine: number } | null) => {
            close(data?.cursorLine)
        })

        cleanupEventsRef.current = [unsub1, unsub2]

        // Focus
        setTimeout(() => xterm.focus(), 30)

        // Send resize + start editor
        try {
            await api.terminalResize(initialCols, initialRows)
            await api.openBlockInEditor(blockId, lineNumber)
        } catch (e) {
            console.error('Failed to open editor:', e)
            close()
        }
    }, [dispose])

    const close = useCallback((cursorLine?: number) => {
        dispose()
        const { editingBlockId } = useAppStore.getState()
        // Batch state update so React processes in one render cycle
        useAppStore.setState({
            editingBlockId: null,
            scrollToLine: cursorLine || null,
        })
        // Keep the block selected and focused after exiting editor
        if (editingBlockId) {
            useAppStore.getState().selectBlock(editingBlockId)
            requestAnimationFrame(() => {
                const el = document.querySelector(`[data-block-id="${editingBlockId}"]`) as HTMLElement
                if (el) el.focus({ preventScroll: true })
            })
        }
    }, [dispose])

    // Cleanup on unmount
    useEffect(() => () => dispose(), [dispose])

    return { open, close }
}
