/**
 * Layer 4: Block — Vim-like block navigation and actions.
 *
 * j/k/h/l navigation, Enter/i edit, d/x/Delete/Backspace delete,
 * o create, H/M/L align, Escape deselect.
 *
 * Only active when NOT editing and no drawing element is selected.
 */
import { registerLayer } from '../InputManager'
import { useAppStore } from '../../store'

const GRID_SIZE = 30
const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE

type BlockLayerCallbacks = {
    onEditBlock: (blockId: string, lineNumber: number) => void
}

let callbacks: BlockLayerCallbacks | null = null

export function initLayer4(cb: BlockLayerCallbacks) {
    callbacks = cb
    registerLayer({
        id: 'block',
        priority: 4,
        isActive: () => {
            const { editingBlockId } = useAppStore.getState()
            return !editingBlockId
        },
        onKeyDown: (e) => {
            if (!callbacks) return false
            const { editingBlockId, selectedBlockId, blocks, selectBlock, deleteBlock, createBlock } = useAppStore.getState()

            if (editingBlockId) return false
            const target = e.target as HTMLElement
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false
            if (target.isContentEditable) return false
            if (target.closest('.cm-editor')) return false

            switch (e.key) {
                // ── Navigation ──
                case 'j':
                    navigateBlocks(1)
                    return true
                case 'k':
                    navigateBlocks(-1)
                    return true
                case 'h':
                    navigateBlocksHorizontal(-1)
                    return true
                case 'l':
                    navigateBlocksHorizontal(1)
                    return true

                // ── Edit (open Neovim) ──
                case 'Enter':
                case 'i': {
                    if (selectedBlockId) {
                        const block = blocks.get(selectedBlockId)
                        if (block?.type === 'markdown') {
                            callbacks.onEditBlock(selectedBlockId, 1)
                            return true
                        }
                    }
                    return false
                }

                // ── Delete ──
                case 'd':
                case 'x':
                case 'Delete':
                case 'Backspace': {
                    if (selectedBlockId) {
                        deleteBlock(selectedBlockId)
                        return true
                    }
                    return false
                }

                // ── Create new block below ──
                case 'o': {
                    const { activePageId } = useAppStore.getState()
                    if (!activePageId) return false

                    if (selectedBlockId) {
                        const block = blocks.get(selectedBlockId)
                        if (block) {
                            createBlock('markdown', snap(block.x), snap(block.y + block.height + GRID_SIZE), 320, 220)
                        }
                    } else {
                        createBlock('markdown', snap(120), snap(120), 320, 220)
                    }
                    return true
                }

                // ── Viewport alignment (vim H/M/L) ──
                case 'H':
                    if (selectedBlockId) { alignBlockInViewport(selectedBlockId, 'left'); return true }
                    return false
                case 'M':
                    if (selectedBlockId) { alignBlockInViewport(selectedBlockId, 'center'); return true }
                    return false
                case 'L':
                    if (selectedBlockId) { alignBlockInViewport(selectedBlockId, 'right'); return true }
                    return false

                // ── Deselect ──
                case 'Escape':
                    if (selectedBlockId) {
                        selectBlock(null)
                        return true
                    }
                    return false

                default:
                    return false
            }
        },
    })
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

    const sameRow = Array.from(blocks.entries())
        .filter(([, b]) => Math.abs(b.y - current.y) < 40)
        .sort(([, a], [, b]) => a.x - b.x)

    const idx = sameRow.findIndex(([id]) => id === selectedBlockId)
    const next = idx + direction
    if (next >= 0 && next < sameRow.length) {
        selectBlock(sameRow[next][0])
    }
}
