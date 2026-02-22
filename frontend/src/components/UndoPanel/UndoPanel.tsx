import { useCallback } from 'react'
import { useUndoTree, type UndoNode } from '../../store/useUndoTree'
import { useAppStore } from '../../store'
import { api } from '../../bridge/wails'
import type { Block } from '../../bridge/wails'

function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function NodeButton({ node, isCurrent, depth, onSelect }: {
    node: UndoNode
    isCurrent: boolean
    depth: number
    onSelect: (id: string) => void
}) {
    return (
        <button
            onClick={() => onSelect(node.id)}
            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors min-w-0 text-left
                ${isCurrent
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
                }`}
            style={{ paddingLeft: 8 + depth * 12 }}
            title={`${node.label} — ${formatTime(node.timestamp)}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-accent' : 'bg-text-muted/40'}`} />
            <span className="truncate min-w-0 flex-1">{node.label}</span>
            <span className="text-text-muted text-xs shrink-0 whitespace-nowrap">{formatTime(node.timestamp)}</span>
        </button>
    )
}

/**
 * Renders the tree like a git graph:
 * - First child continues at the SAME depth (linear continuation)
 * - Additional children are branches shown INDENTED
 *
 * A → B → C
 * |       |
 * |       → D → E
 * → F → G
 */
function TreeNode({ node, depth, currentId, branchPrefix, onSelect }: {
    node: UndoNode
    depth: number
    currentId: string | null
    branchPrefix: string
    onSelect: (id: string) => void
}) {
    const nodes = useUndoTree(s => s.nodes)
    const isCurrent = node.id === currentId

    // First child = linear continuation (same depth)
    // Remaining children = branches (indented)
    const [firstChildId, ...branchChildIds] = node.children

    return (
        <>
            <NodeButton node={node} isCurrent={isCurrent} depth={depth} onSelect={onSelect} />

            {/* Branch children (2nd, 3rd, etc.) — indented */}
            {branchChildIds.map((childId, i) => {
                const child = nodes.get(childId)
                if (!child) return null
                const version = branchPrefix ? `${branchPrefix}.${i + 1}` : `${i + 1}`
                return (
                    <div key={childId}>
                        <div
                            className="text-text-muted text-[10px] font-medium uppercase tracking-wider py-0.5 select-none"
                            style={{ paddingLeft: 12 + (depth + 1) * 12 }}
                        >
                            ↳ branch {version}
                        </div>
                        <TreeNode
                            node={child}
                            depth={depth + 1}
                            currentId={currentId}
                            branchPrefix={version}
                            onSelect={onSelect}
                        />
                    </div>
                )
            })}

            {/* First child — continues at same depth (main line) */}
            {firstChildId && (() => {
                const child = nodes.get(firstChildId)
                if (!child) return null
                return (
                    <TreeNode
                        key={firstChildId}
                        node={child}
                        depth={depth}
                        currentId={currentId}
                        branchPrefix={branchPrefix}
                        onSelect={onSelect}
                    />
                )
            })()}
        </>
    )
}

export function UndoPanel() {
    const { nodes, currentId, rootId } = useUndoTree()
    const rootNode = rootId ? nodes.get(rootId) : null

    const onSelect = useCallback((nodeId: string) => {
        const { activePageId } = useAppStore.getState()
        if (!activePageId) return
        const snapshot = useUndoTree.getState().goTo(activePageId, nodeId)
        if (snapshot) {
            const blocks = new Map<string, Block>()
            snapshot.blocks.forEach(b => blocks.set(b.id, b))
            useAppStore.setState({
                blocks,
                drawingData: snapshot.drawingData,
                connections: snapshot.connections,
                selectedBlockId: null,
                editingBlockId: null,
            })

            api.restorePageBlocks(activePageId, snapshot.blocks)
            api.updateDrawingData(activePageId, snapshot.drawingData)
        }
    }, [])

    return (
        <div className="w-56 border-l border-border-default bg-surface-secondary flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-border-default flex items-center gap-2">
                <span className="text-sm font-semibold text-text-secondary uppercase tracking-wide">History</span>
                <span className="text-xs text-text-muted ml-auto">{nodes.size} states</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
                {rootNode ? (
                    <TreeNode
                        node={rootNode}
                        depth={0}
                        currentId={currentId}
                        branchPrefix=""
                        onSelect={onSelect}
                    />
                ) : (
                    <div className="text-sm text-text-muted text-center py-4">No history yet</div>
                )}
            </div>
        </div>
    )
}
