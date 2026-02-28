import { GRID_SIZE, snapToGrid as snap } from '../../constants'
/**
 * Layer 4: Block — Vim-like block navigation and actions.
 *
 * j/k/h/l navigation, Enter/i edit, d/x/Delete/Backspace delete,
 * o create, H/M/L align, F fullscreen, Escape deselect.
 *
 * Only active when NOT editing and no drawing element is selected.
 */
import { registerLayer } from '../InputManager'
import { useAppStore } from '../../store'
import { BlockRegistry } from '../../plugins'


// Track original dimensions before snap resize (Shift+H/M/L)
const snapState = new Map<string, { origW: number; origH: number }>()

function restoreSnappedBlock(blockId: string) {
    const saved = snapState.get(blockId)
    if (!saved) return
    snapState.delete(blockId)
    const { blocks, resizeBlock, saveBlockPosition } = useAppStore.getState()
    const block = blocks.get(blockId)
    if (!block) return
    resizeBlock(blockId, saved.origW, saved.origH)
    saveBlockPosition(blockId)
}

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
                        if (block && BlockRegistry.get(block.type)?.capabilities?.editable) {
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
                case 'F':
                    if (selectedBlockId) { fullscreenBlock(selectedBlockId); return true }
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
    // Auto-restore snapped blocks when selection changes
    useAppStore.subscribe((state, prev) => {
        if (state.selectedBlockId !== prev.selectedBlockId && prev.selectedBlockId) {
            restoreSnappedBlock(prev.selectedBlockId)
        }
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

function focusBlockElement(blockId: string) {
    // Focus the DOM element so the block becomes "active" (matches mouse click behavior)
    const el = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement
    if (el) el.focus({ preventScroll: true })
}

function navigateBlocks(direction: 1 | -1) {
    const { selectedBlockId, selectBlock } = useAppStore.getState()
    const ids = getSortedBlockIds()
    if (ids.length === 0) return

    if (!selectedBlockId) {
        const id = ids[direction === 1 ? 0 : ids.length - 1]
        selectBlock(id)
        focusBlockElement(id)
        return
    }

    const idx = ids.indexOf(selectedBlockId)
    const next = idx + direction
    if (next >= 0 && next < ids.length) {
        selectBlock(ids[next])
        focusBlockElement(ids[next])
    }
}

function alignBlockInViewport(blockId: string, align: 'left' | 'center' | 'right') {
    const { blocks, setViewport, resizeBlock, saveBlockPosition } = useAppStore.getState()
    const block = blocks.get(blockId)
    if (!block) return

    const canvas = document.querySelector('[data-role="canvas-container"]') as HTMLElement
    if (!canvas) return

    const canvasW = canvas.clientWidth
    const canvasH = canvas.clientHeight
    const pad = 40

    // Save original dimensions before snap (only first time)
    if (!snapState.has(blockId)) {
        snapState.set(blockId, { origW: block.width, origH: block.height })
    }

    // Resize: 45% width for sides, 60% for center; 98% height for all
    const widthPct = align === 'center' ? 0.6 : 0.45
    const newW = snap(canvasW * widthPct)
    const newH = snap(canvasH * 0.98)
    resizeBlock(blockId, newW, newH)

    // Viewport (camera): zoom 1, position to show block at left/center/right of screen
    let x: number
    switch (align) {
        case 'left': x = -block.x + pad; break
        case 'center': x = -(block.x + newW / 2) + canvasW / 2; break
        case 'right': x = -(block.x + newW) + canvasW - pad; break
    }
    const y = -block.y + canvasH * 0.01

    setViewport(x, y, 1)
}

function fullscreenBlock(blockId: string) {
    const { blocks, setViewport, resizeBlock, saveBlockPosition } = useAppStore.getState()
    const block = blocks.get(blockId)
    if (!block) return

    const canvas = document.querySelector('[data-role="canvas-container"]') as HTMLElement
    if (!canvas) return

    const canvasW = canvas.clientWidth
    const canvasH = canvas.clientHeight
    const pad = 20

    // Save original dimensions before snap (only first time)
    if (!snapState.has(blockId)) {
        snapState.set(blockId, { origW: block.width, origH: block.height })
    }

    // Resize to fill viewport
    const newW = snap(canvasW - pad * 2)
    const newH = snap(canvasH - pad * 2)
    resizeBlock(blockId, newW, newH)

    // Center camera on block — same formula as alignBlockInViewport('center')
    const x = -(block.x + newW / 2) + canvasW / 2
    const y = -block.y + canvasH * 0.01

    setViewport(x, y, 1)
    saveBlockPosition(blockId)
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
        focusBlockElement(sameRow[next][0])
    }
}
