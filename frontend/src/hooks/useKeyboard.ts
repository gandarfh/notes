import { useEffect } from 'react'
import { useAppStore } from '../store'

const GRID_SIZE = 30
const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE

/**
 * Global keyboard shortcuts — vim-like block navigation + actions.
 * Calls are provided via callbacks so this hook is decoupled from terminal logic.
 */
export function useKeyboard(callbacks: {
    onEditBlock: (blockId: string, lineNumber: number) => void
}) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const { editingBlockId, selectedBlockId, blocks, selectBlock, deleteBlock, createBlock } = useAppStore.getState()

            // Don't intercept when terminal is active or typing in input
            if (editingBlockId) return
            const target = e.target as HTMLElement
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
            if (target.isContentEditable) return
            if (target.closest('.cm-editor')) return

            switch (e.key) {
                // ── Navigation ──
                case 'j': {
                    e.preventDefault()
                    navigateBlocks(1)
                    break
                }
                case 'k': {
                    e.preventDefault()
                    navigateBlocks(-1)
                    break
                }
                case 'h': {
                    e.preventDefault()
                    navigateBlocksHorizontal(-1)
                    break
                }
                case 'l': {
                    e.preventDefault()
                    navigateBlocksHorizontal(1)
                    break
                }

                // ── Edit (open Neovim) ──
                case 'Enter':
                case 'i': {
                    if (selectedBlockId) {
                        const block = blocks.get(selectedBlockId)
                        if (block?.type === 'markdown') {
                            e.preventDefault()
                            callbacks.onEditBlock(selectedBlockId, 1)
                        }
                    }
                    break
                }

                // ── Delete ──
                case 'x':
                case 'Delete':
                case 'Backspace': {
                    if (selectedBlockId) {
                        e.preventDefault()
                        deleteBlock(selectedBlockId)
                    }
                    break
                }

                // ── Create new block below ──
                case 'o': {
                    e.preventDefault()
                    const { activePageId } = useAppStore.getState()
                    if (!activePageId) break

                    if (selectedBlockId) {
                        const block = blocks.get(selectedBlockId)
                        if (block) {
                            createBlock('markdown', snap(block.x), snap(block.y + block.height + GRID_SIZE), 320, 220)
                        }
                    } else {
                        createBlock('markdown', snap(120), snap(120), 320, 220)
                    }
                    break
                }

                // ── Viewport alignment (vim H/M/L) ──
                case 'H': {
                    if (selectedBlockId) {
                        e.preventDefault()
                        alignBlockInViewport(selectedBlockId, 'left')
                    }
                    break
                }
                case 'M': {
                    if (selectedBlockId) {
                        e.preventDefault()
                        alignBlockInViewport(selectedBlockId, 'center')
                    }
                    break
                }
                case 'L': {
                    if (selectedBlockId) {
                        e.preventDefault()
                        alignBlockInViewport(selectedBlockId, 'right')
                    }
                    break
                }

                // ── Deselect ──
                case 'Escape': {
                    selectBlock(null)
                    break
                }
            }
        }

        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [callbacks])
}

// ── Navigation helpers ──

function getSortedBlockIds(): string[] {
    const { blocks } = useAppStore.getState()
    return Array.from(blocks.entries())
        .sort(([, a], [, b]) => {
            const dy = a.y - b.y
            if (Math.abs(dy) > 20) return dy
            return a.x - b.x
        })
        .map(([id]) => id)
}

function navigateBlocks(direction: 1 | -1) {
    const { selectedBlockId, selectBlock } = useAppStore.getState()
    const ids = getSortedBlockIds()
    if (ids.length === 0) return

    if (!selectedBlockId) {
        selectBlock(ids[direction === 1 ? 0 : ids.length - 1])
        return
    }

    const idx = ids.indexOf(selectedBlockId)
    const next = idx + direction
    if (next >= 0 && next < ids.length) {
        selectBlock(ids[next])
    }
}

function alignBlockInViewport(blockId: string, align: 'left' | 'center' | 'right') {
    const { blocks, setViewport } = useAppStore.getState()
    const block = blocks.get(blockId)
    if (!block) return

    const canvas = document.querySelector('[data-role="canvas-container"]') as HTMLElement
    if (!canvas) return

    const canvasW = canvas.clientWidth
    const canvasH = canvas.clientHeight
    const pad = 40

    let x: number
    switch (align) {
        case 'left': x = -block.x + pad; break
        case 'center': x = -(block.x + block.width / 2) + canvasW / 2; break
        case 'right': x = -(block.x + block.width) + canvasW - pad; break
    }
    const y = -block.y + canvasH * 0.05

    setViewport(x, y, 1)
}

function navigateBlocksHorizontal(direction: 1 | -1) {
    const { selectedBlockId, blocks, selectBlock } = useAppStore.getState()
    if (!selectedBlockId) return

    const current = blocks.get(selectedBlockId)
    if (!current) return

    // Find blocks on similar Y level
    const sameRow = Array.from(blocks.entries())
        .filter(([, b]) => Math.abs(b.y - current.y) < 40)
        .sort(([, a], [, b]) => a.x - b.x)

    const idx = sameRow.findIndex(([id]) => id === selectedBlockId)
    const next = idx + direction
    if (next >= 0 && next < sameRow.length) {
        selectBlock(sameRow[next][0])
    }
}
