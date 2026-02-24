import { useRef, useState, useCallback, useMemo, useEffect, memo } from 'react'
import { useAppStore } from '../../store'
import { BlockRegistry } from '../../plugins'
import { clearDrawingSelectionGlobal, closeEditorGlobal } from '../../input/drawingBridge'
import { IconEdit, IconX, IconLink } from '@tabler/icons-react'
import { api } from '../../bridge/wails'

// ── Font-size helpers ──────────────────────────────────────

const FONT_SIZE_KEY = 'md-font-size:'
const DEFAULT_FONT_SIZE = 15
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 48

export function getBlockFontSize(blockId: string): number {
    try {
        const v = localStorage.getItem(FONT_SIZE_KEY + blockId)
        if (v) return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, parseInt(v, 10)))
    } catch { }
    return DEFAULT_FONT_SIZE
}

function setBlockFontSize(blockId: string, size: number) {
    localStorage.setItem(FONT_SIZE_KEY + blockId, String(size))
}

// ── Block Header ───────────────────────────────────────────

const LANGUAGES = [
    { ext: 'txt', label: 'Plain Text' },
    { ext: 'go', label: 'Go' },
    { ext: 'rs', label: 'Rust' },
    { ext: 'py', label: 'Python' },
    { ext: 'js', label: 'JavaScript' },
    { ext: 'ts', label: 'TypeScript' },
    { ext: 'tsx', label: 'TSX' },
    { ext: 'jsx', label: 'JSX' },
    { ext: 'json', label: 'JSON' },
    { ext: 'yaml', label: 'YAML' },
    { ext: 'toml', label: 'TOML' },
    { ext: 'sql', label: 'SQL' },
    { ext: 'sh', label: 'Shell' },
    { ext: 'html', label: 'HTML' },
    { ext: 'css', label: 'CSS' },
    { ext: 'java', label: 'Java' },
    { ext: 'kt', label: 'Kotlin' },
    { ext: 'swift', label: 'Swift' },
    { ext: 'c', label: 'C' },
    { ext: 'cpp', label: 'C++' },
    { ext: 'lua', label: 'Lua' },
    { ext: 'zig', label: 'Zig' },
    { ext: 'rb', label: 'Ruby' },
    { ext: 'proto', label: 'Protobuf' },
    { ext: 'graphql', label: 'GraphQL' },
    { ext: 'dockerfile', label: 'Dockerfile' },
    { ext: 'hcl', label: 'HCL/Terraform' },
    { ext: 'md', label: 'Markdown' },
]

const BlockHeader = memo(function BlockHeader({ type, blockId, filePath, onDelete, onEdit, onLinkFile, onChangeLang }: { type: string; blockId: string; filePath?: string; onDelete: () => void; onEdit?: () => void; onLinkFile?: () => void; onChangeLang?: (ext: string) => void }) {
    const plugin = BlockRegistry.get(type)
    const label = plugin?.headerLabel || type.toUpperCase()
    const isMarkdown = type === 'markdown'
    const isCode = type === 'code'
    const currentExt = filePath?.split('.').pop()?.toLowerCase() || 'txt'

    const [showFontPopup, setShowFontPopup] = useState(false)
    const [fontSize, setFontSize] = useState(() => getBlockFontSize(blockId))
    const popupRef = useRef<HTMLDivElement>(null)

    const changeFontSize = useCallback((delta: number) => {
        setFontSize(prev => {
            const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, prev + delta))
            setBlockFontSize(blockId, next)
            window.dispatchEvent(new CustomEvent('md-fontsize-change', { detail: { blockId, size: next } }))
            return next
        })
    }, [blockId])

    // Close popup on outside click
    useEffect(() => {
        if (!showFontPopup) return
        const handler = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                setShowFontPopup(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showFontPopup])

    return (
        <div
            className="block-header flex items-center justify-between gap-1.5 cursor-move"
            style={{ padding: '6px 10px', background: 'var(--overlay-2)', borderBottom: '1px solid var(--color-border-subtle)', fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}
        >
            <span className="flex items-center gap-1.5" title={filePath || undefined}>
                {label}
                {isCode && onChangeLang && (
                    <select
                        className="code-lang-select"
                        value={currentExt}
                        onChange={e => { e.stopPropagation(); onChangeLang(e.target.value) }}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                    >
                        {LANGUAGES.map(l => (
                            <option key={l.ext} value={l.ext}>{l.label}</option>
                        ))}
                    </select>
                )}
                {filePath && (
                    <span style={{ opacity: 0.5, fontWeight: 400, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {filePath.split('/').pop()}
                    </span>
                )}
            </span>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                {isMarkdown && (
                    <div className="relative" ref={popupRef}>
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowFontPopup(!showFontPopup) }}
                            className="w-[22px] h-[22px] flex items-center justify-center border-none bg-transparent text-text-muted rounded cursor-pointer text-[0.769rem] hover:bg-hover hover:text-text-primary"
                            title="Font size"
                            style={{ fontWeight: 600, letterSpacing: '-0.02em' }}
                        >Aa</button>
                        {showFontPopup && (
                            <div
                                className="absolute z-50 flex items-center gap-1"
                                style={{
                                    top: '100%',
                                    right: 0,
                                    marginTop: '4px',
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-border-default)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '3px 4px',
                                    boxShadow: 'var(--block-shadow)',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <button
                                    onClick={(e) => { e.stopPropagation(); changeFontSize(-1) }}
                                    disabled={fontSize <= MIN_FONT_SIZE}
                                    className="w-[22px] h-[22px] flex items-center justify-center border-none rounded cursor-pointer text-[0.846rem] hover:bg-hover disabled:opacity-30 disabled:cursor-default"
                                    style={{ background: 'transparent', color: 'var(--color-text-secondary)' }}
                                >A−</button>
                                <span
                                    className="text-[0.846rem] font-semibold tabular-nums"
                                    style={{ minWidth: '24px', textAlign: 'center', color: 'var(--color-text-primary)' }}
                                >{fontSize}</span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); changeFontSize(1) }}
                                    disabled={fontSize >= MAX_FONT_SIZE}
                                    className="w-[22px] h-[22px] flex items-center justify-center border-none rounded cursor-pointer text-[0.846rem] hover:bg-hover disabled:opacity-30 disabled:cursor-default"
                                    style={{ background: 'transparent', color: 'var(--color-text-secondary)' }}
                                >A+</button>
                            </div>
                        )}
                    </div>
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

const GRID_SIZE = 30
const snapToGrid = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE

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
            const bType = useAppStore.getState().blocks.get(blockId)?.type

            // Direct DOM update — bypass React/Zustand during resize
            if (elRef.current) {
                if (bType === 'image' && !ev.ctrlKey && !ev.metaKey) {
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

    // ── Ctrl/Cmd+Click to edit (like IDE "go to definition") ──
    const onContentMouseDown = useCallback((e: React.MouseEvent) => {
        if (block?.type !== 'markdown' && block?.type !== 'code' || isEditing) return
        if (!(e.ctrlKey || e.metaKey)) return

        // Cmd/Ctrl+click detected — open editor at clicked line
        e.preventDefault()
        e.stopPropagation()
        const target = e.target as HTMLElement
        const annotated = target.closest('[data-source-line]') as HTMLElement | null
        const line = annotated ? parseInt(annotated.dataset.sourceLine || '1', 10) : 1
        onEditBlock(blockId, line || 1)
    }, [block?.type, isEditing, blockId, onEditBlock])

    // ── Scroll to line after exiting editor ──
    const scrollToLine = useAppStore(s => s.scrollToLine)
    useEffect(() => {
        if (isEditing || !scrollToLine || !elRef.current) return
        // Small delay to let the markdown preview render
        const timer = setTimeout(() => {
            const blockEl = elRef.current
            if (!blockEl) return
            // Find the scrollable content container inside the block
            const scrollContainer = blockEl.querySelector('.block-content') as HTMLElement
            if (!scrollContainer) return
            // Find the closest data-source-line element
            const lineEls = Array.from(scrollContainer.querySelectorAll<HTMLElement>('[data-source-line]'))
            const target = lineEls.reduce<{ el: HTMLElement | null; dist: number }>((acc, el) => {
                const line = parseInt(el.dataset.sourceLine || '0', 10)
                const dist = Math.abs(line - scrollToLine)
                return dist < acc.dist ? { el, dist } : acc
            }, { el: null, dist: Infinity })

            if (target.el) {
                // Scroll within the container, not the page
                const containerRect = scrollContainer.getBoundingClientRect()
                const targetRect = target.el.getBoundingClientRect()
                const offset = targetRect.top - containerRect.top + scrollContainer.scrollTop
                scrollContainer.scrollTo({
                    top: Math.max(0, offset - scrollContainer.clientHeight * 0.3),
                    behavior: 'smooth',
                })
            }
            useAppStore.setState({ scrollToLine: null })
        }, 100)
        return () => clearTimeout(timer)
    }, [isEditing, scrollToLine])

    if (!block || !plugin) return null

    const Renderer = plugin.Renderer

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

    const isImage = block.type === 'image'

    return (
        <div
            ref={elRef}
            data-role="block"
            data-block-id={blockId}
            data-block-type={block.type}
            tabIndex={-1}
            className={`group absolute flex flex-col overflow-hidden pointer-events-auto ${isImage ? 'rounded-sm' : 'rounded-md'}`}
            style={{
                left: block.x,
                top: block.y,
                width: block.width,
                height: block.height,
                background: isImage ? 'transparent' : 'var(--color-block-bg)',
                border: `1px solid ${borderColor}`,
                boxShadow: isImage ? 'none' : boxShadow,
                zIndex: isEditing ? 100 : isSelected ? 50 : undefined,
            }}
            onClick={() => {
                const { editingBlockId } = useAppStore.getState()
                if (editingBlockId && editingBlockId !== blockId) closeEditorGlobal()
                selectBlock(blockId)
                clearDrawingSelectionGlobal()
            }}
        >
            {!isImage && (
                <div onMouseDown={onHeaderMouseDown} onDoubleClick={onHeaderDoubleClick}>
                    <BlockHeader
                        type={block.type}
                        blockId={blockId}
                        filePath={block.filePath}
                        onDelete={() => deleteBlock(blockId)}
                        onEdit={block.type === 'markdown' || block.type === 'code' ? () => onEditBlock(blockId, 1) : undefined}
                        onLinkFile={block.type === 'markdown' || block.type === 'code' ? async () => {
                            const path = await api.pickTextFile()
                            if (!path) return
                            const content = await api.updateBlockFilePath(blockId, path)
                            updateBlock(blockId, { content, filePath: path })
                        } : undefined}
                        onChangeLang={block.type === 'code' ? async (ext: string) => {
                            try {
                                const newPath = await api.changeBlockFileExt(blockId, ext)
                                updateBlock(blockId, { filePath: newPath })
                            } catch (e) {
                                console.error('[Code] changeFileExt:', e)
                            }
                        } : undefined}
                    />
                </div>
            )}

            {isEditing && (block.type === 'markdown' || block.type === 'code') ? (
                <div
                    className="block-content w-full flex-1 min-h-0 overflow-hidden p-0"
                    data-terminal-container
                    data-block-id={blockId}
                />
            ) : (
                <div
                    className={`block-content w-full flex-1 min-h-0 overflow-auto ${isImage || block.type === 'database' ? 'p-0' : 'p-3'}`}
                    onMouseDown={isImage ? onHeaderMouseDown : onContentMouseDown}
                >
                    <Renderer
                        block={block}
                        isEditing={isEditing}
                        isSelected={isSelected}
                        onContentChange={(content) => updateBlock(blockId, { content })}
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

            {/* Floating delete button for image blocks */}
            {isImage && (
                <button
                    onClick={(e) => { e.stopPropagation(); deleteBlock(blockId) }}
                    className="absolute z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-100 flex items-center justify-center border-none rounded-full cursor-pointer"
                    style={{
                        top: 6, right: 6,
                        width: 22, height: 22,
                        background: 'var(--backdrop-bg)',
                    }}
                    title="Delete image"
                >×</button>
            )}
        </div>
    )
})
