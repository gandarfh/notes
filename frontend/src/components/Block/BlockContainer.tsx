import { GRID_SIZE, snapToGrid } from '../../constants'
import { useRef, useState, useCallback, useMemo, useEffect, memo } from 'react'
import { useAppStore } from '../../store'
import { BlockRegistry } from '../../plugins'
import { clearDrawingSelectionGlobal, closeEditorGlobal } from '../../input/drawingBridge'
import { IconEdit, IconX, IconLink } from '@tabler/icons-react'
import { api } from '../../bridge/wails'
import { createPluginContext } from '../../plugins/sdk/runtime/contextFactory'

// ── Block Header ───────────────────────────────────────────

const BlockHeader = memo(function BlockHeader({
    type, blockId, filePath, onDelete, onEdit, onLinkFile,
}: {
    type: string
    blockId: string
    filePath?: string
    onDelete: () => void
    onEdit?: () => void
    onLinkFile?: () => void
}) {
    const plugin = BlockRegistry.get(type)
    const label = plugin?.headerLabel || type.toUpperCase()
    // Track block filePath in store so HeaderExtension re-renders when language changes
    const blockFilePath = useAppStore(s => s.blocks.get(blockId)?.filePath)
    const ctx = useMemo(() => {
        const block = useAppStore.getState().blocks.get(blockId)
        return block ? createPluginContext(block) : null
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blockId, blockFilePath])

    return (
        <div
            className="block-header flex items-center justify-between gap-1.5 cursor-move"
            style={{ padding: '6px 10px', background: 'var(--overlay-2)', borderBottom: '1px solid var(--color-border-subtle)', fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}
        >
            <span className="flex items-center gap-1.5" title={filePath || undefined}>
                {label}
                {filePath && (
                    <span style={{ opacity: 0.5, fontWeight: 400, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {filePath.split('/').pop()}
                    </span>
                )}
            </span>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                {/* Plugin-owned header controls */}
                {plugin?.HeaderExtension && ctx && (
                    <plugin.HeaderExtension blockId={blockId} ctx={ctx} />
                )}
                {onLinkFile && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onLinkFile() }}
                        className="w-[22px] h-[22px] flex items-center justify-center border-none bg-transparent text-text-muted rounded cursor-pointer text-[0.846rem] hover:bg-hover hover:text-text-primary"
                        title="Link external file"
                    ><IconLink size={14} /></button>
                )}
                {onEdit && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onEdit() }}
                        className="w-[22px] h-[22px] flex items-center justify-center border-none bg-transparent text-text-muted rounded cursor-pointer text-[0.846rem] hover:bg-hover hover:text-text-primary"
                        title="Edit in Neovim"
                    ><IconEdit size={14} /></button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete() }}
                    className="w-[22px] h-[22px] flex items-center justify-center border-none bg-transparent text-text-muted rounded cursor-pointer text-[0.846rem] hover:bg-hover hover:text-text-primary"
                    title="Delete"
                ><IconX size={14} /></button>
            </div>
        </div>
    )
})

// ── Block Container ────────────────────────────────────────

interface BlockContainerProps {
    blockId: string
    onEditBlock: (blockId: string, lineNumber: number) => void
}


export const BlockContainer = memo(function BlockContainer({ blockId, onEditBlock }: BlockContainerProps) {
    const block = useAppStore(s => s.blocks.get(blockId))
    const isSelected = useAppStore(s => s.selectedBlockId === blockId)
    const isEditing = useAppStore(s => s.editingBlockId === blockId)
    const selectBlock = useAppStore(s => s.selectBlock)
    const deleteBlock = useAppStore(s => s.deleteBlock)
    const moveBlock = useAppStore(s => s.moveBlock)
    const resizeBlock = useAppStore(s => s.resizeBlock)
    const saveBlockPosition = useAppStore(s => s.saveBlockPosition)
    const updateBlock = useAppStore(s => s.updateBlock)

    const elRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
    const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

    const plugin = useMemo(() => block ? BlockRegistry.get(block.type) : undefined, [block?.type])

    // ── Drag ──
    const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return
        if (isEditing) return
        e.stopPropagation()
        const { editingBlockId } = useAppStore.getState()
        if (editingBlockId && editingBlockId !== blockId) closeEditorGlobal()
        selectBlock(blockId)
        clearDrawingSelectionGlobal()

        if (!block) return
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: block.x, origY: block.y }

        const onMove = (ev: MouseEvent) => {
            const d = dragRef.current
            if (!d) return
            const zoom = useAppStore.getState().viewport.zoom
            const dx = (ev.clientX - d.startX) / zoom
            const dy = (ev.clientY - d.startY) / zoom
            // Direct DOM update — bypass React/Zustand during drag for zero re-renders
            if (elRef.current) {
                elRef.current.style.left = `${d.origX + dx}px`
                elRef.current.style.top = `${d.origY + dy}px`
            }
        }

        const onUp = () => {
            dragRef.current = null
            // Read final position from DOM, snap to grid, commit once to store
            const el = elRef.current
            if (el) {
                const finalX = snapToGrid(parseFloat(el.style.left))
                const finalY = snapToGrid(parseFloat(el.style.top))
                moveBlock(blockId, finalX, finalY)
            }
            saveBlockPosition(blockId)
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }

        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [blockId, block, isEditing, selectBlock, moveBlock, saveBlockPosition])

    // ── Double-click header to focus (zoom 100% + center) ──
    const onHeaderDoubleClick = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return
        if (!block) return
        e.preventDefault()
        e.stopPropagation()

        const canvas = document.querySelector('[data-role="canvas-container"]') as HTMLElement
        if (!canvas) return

        const canvasW = canvas.clientWidth
        const canvasH = canvas.clientHeight

        // Center block horizontally, place it at ~30% from top vertically
        const x = -(block.x + block.width / 2) + canvasW / 2
        const y = -(block.y) + canvasH * 0.05

        useAppStore.getState().setViewport(x, y, 1)
    }, [block])

    // ── Resize ──
    const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        const { editingBlockId } = useAppStore.getState()
        if (editingBlockId && editingBlockId !== blockId) closeEditorGlobal()
        selectBlock(blockId)
        clearDrawingSelectionGlobal()

        if (!block) return
        const aspectRatio = block.width / block.height
        resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: block.width, origH: block.height }

        const onMove = (ev: MouseEvent) => {
            const r = resizeRef.current
            if (!r) return
            const zoom = useAppStore.getState().viewport.zoom
            const dw = (ev.clientX - r.startX) / zoom
            const dh = (ev.clientY - r.startY) / zoom
            const blockType = useAppStore.getState().blocks.get(blockId)?.type
            const p = blockType ? BlockRegistry.get(blockType) : undefined

            // Direct DOM update — bypass React/Zustand during resize
            if (elRef.current) {
                if (p?.capabilities?.aspectRatioResize && !ev.ctrlKey && !ev.metaKey) {
                    const newW = Math.max(60, r.origW + dw)
                    const newH = newW / aspectRatio
                    elRef.current.style.width = `${newW}px`
                    elRef.current.style.height = `${Math.max(60, newH)}px`
                } else {
                    elRef.current.style.width = `${Math.max(120, r.origW + dw)}px`
                    elRef.current.style.height = `${Math.max(80, r.origH + dh)}px`
                }
            }
        }

        const onUp = () => {
            resizeRef.current = null
            // Read final size from DOM, snap to grid, commit once to store
            const el = elRef.current
            if (el) {
                const finalW = snapToGrid(Math.max(60, parseFloat(el.style.width)))
                const finalH = snapToGrid(Math.max(60, parseFloat(el.style.height)))
                resizeBlock(blockId, finalW, finalH)
            }
            saveBlockPosition(blockId)
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }

        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [blockId, block, selectBlock, resizeBlock, saveBlockPosition])

    // ── Ctrl/Cmd+Click to edit (capability: editable) ──
    const onContentMouseDown = useCallback((e: React.MouseEvent) => {
        if (!plugin?.capabilities?.editable || isEditing) return
        if (!(e.ctrlKey || e.metaKey)) return
        e.preventDefault()
        e.stopPropagation()
        const target = e.target as HTMLElement
        const annotated = target.closest('[data-source-line]') as HTMLElement | null
        const line = annotated ? parseInt(annotated.dataset.sourceLine || '1', 10) : 1
        onEditBlock(blockId, line || 1)
    }, [plugin, isEditing, blockId, onEditBlock])

    if (!block || !plugin) return null

    const Renderer = plugin.Renderer
    const caps = plugin.capabilities ?? {}
    const isNoBg = caps.headerless   // no block background/header/shadow (e.g. image)

    const borderColor = isEditing
        ? 'var(--color-accent)'
        : isSelected
            ? 'var(--color-block-selected)'
            : 'var(--color-block-border)'

    const boxShadow = isEditing
        ? 'var(--block-shadow-editing)'
        : isSelected
            ? 'var(--block-shadow-selected)'
            : 'var(--block-shadow)'

    // Stable ctx reference — memoized on block.id only.
    // contextFactory reads live data from the store at call-time, so we don't
    // need to recreate ctx every time block.content / block.x / etc. change.
    // Recreating ctx on every block update was causing all plugin useEffects
    // that depend on [rpc], [ctx], [events] etc. to re-fire on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ctx = useMemo(() => createPluginContext(block), [block.id])

    return (
        <div
            ref={elRef}
            data-role="block"
            data-block-id={blockId}
            data-block-type={block.type}
            tabIndex={-1}
            className={`group absolute flex flex-col overflow-hidden pointer-events-auto ${caps.smallBorderRadius ? 'rounded-sm' : 'rounded-md'}`}
            style={{
                left: block.x,
                top: block.y,
                width: block.width,
                height: block.height,
                background: isNoBg ? 'transparent' : 'var(--color-block-bg)',
                border: `1px solid ${borderColor}`,
                boxShadow: isNoBg ? 'none' : boxShadow,
                zIndex: isEditing ? 100 : isSelected ? 50 : undefined,
            }}
            onClick={() => {
                const { editingBlockId } = useAppStore.getState()
                if (editingBlockId && editingBlockId !== blockId) closeEditorGlobal()
                selectBlock(blockId)
                clearDrawingSelectionGlobal()
            }}
        >
            {!isNoBg && (
                <div onMouseDown={onHeaderMouseDown} onDoubleClick={onHeaderDoubleClick}>
                    <BlockHeader
                        type={block.type}
                        blockId={blockId}
                        filePath={block.filePath}
                        onDelete={() => deleteBlock(blockId)}
                        onEdit={caps.editable ? () => onEditBlock(blockId, 1) : undefined}
                        onLinkFile={caps.editable ? async () => {
                            const path = await api.pickTextFile()
                            if (!path) return
                            const content = await api.updateBlockFilePath(blockId, path)
                            updateBlock(blockId, { content, filePath: path })
                        } : undefined}
                    />
                </div>
            )}

            {isEditing && caps.editable ? (
                <div
                    className="block-content w-full flex-1 min-h-0 overflow-hidden p-0"
                    data-terminal-container
                    data-block-id={blockId}
                />
            ) : (
                <div
                    className={`block-content w-full flex-1 min-h-0 overflow-auto ${caps.zeroPadding ? 'p-0' : 'p-3'}`}
                    onMouseDown={isNoBg ? onHeaderMouseDown : onContentMouseDown}
                >
                    <Renderer
                        block={block}
                        isEditing={isEditing}
                        isSelected={isSelected}
                        ctx={ctx}
                        onContentChange={(content) => {
                            updateBlock(blockId, { content })
                            useAppStore.getState().saveBlockContent(blockId, content)
                        }}
                    />
                </div>
            )}

            {/* Resize handle */}
            <div
                onMouseDown={onResizeMouseDown}
                className={`absolute pointer-events-auto z-10 transition-opacity duration-100 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: 'var(--color-accent)',
                    bottom: -4, right: -4, cursor: 'se-resize',
                }}
            />

            {/* Floating delete button for no-bg blocks (e.g. image) */}
            {isNoBg && (
                <button
                    onClick={(e) => { e.stopPropagation(); deleteBlock(blockId) }}
                    className="absolute z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-100 flex items-center justify-center border-none rounded-full cursor-pointer"
                    style={{
                        top: 6, right: 6,
                        width: 22, height: 22,
                        background: 'var(--backdrop-bg)',
                    }}
                    title="Delete"
                >×</button>
            )}
        </div>
    )
})
