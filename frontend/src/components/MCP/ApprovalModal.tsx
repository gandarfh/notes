import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../../bridge/wails'
import { pluginBus } from '../../plugins/sdk/runtime/eventBus'
import './ApprovalModal.css'

interface PendingAction {
    id: string
    tool: string
    description: string
    createdAt: string
    metadata?: string
}

export function ApprovalModal() {
    const [actions, setActions] = useState<PendingAction[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    const dismiss = useCallback((id: string) => {
        setActions(prev => prev.filter(a => a.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const approve = useCallback((id: string) => {
        api.approveAction(id)
        // Don't emit 'mcp:approval-dismissed' — highlight stays until element is actually deleted
        dismiss(id)
    }, [dismiss])

    const reject = useCallback((id: string) => {
        api.rejectAction(id)
        pluginBus.emit('mcp:approval-dismissed', { id })
        dismiss(id)
    }, [dismiss])

    // ── Block highlight on pending delete ──
    const highlightedBlocksRef = useRef<Map<string, string[]>>(new Map()) // actionId → blockIds

    const clearBlockHighlights = useCallback((actionId: string) => {
        const blockIds = highlightedBlocksRef.current.get(actionId)
        if (blockIds) {
            for (const bid of blockIds) {
                const el = document.querySelector(`[data-block-id="${bid}"]`) as HTMLElement | null
                if (el) el.classList.remove('mcp-pending-delete')
            }
            highlightedBlocksRef.current.delete(actionId)
        }
    }, [])

    useEffect(() => {
        const unsubRequired = pluginBus.on('mcp:approval-required', (data: PendingAction) => {
            setActions(prev => {
                if (prev.some(a => a.id === data.id)) return prev
                return [...prev, data]
            })
            const timer = setTimeout(() => dismiss(data.id), 118000)
            timersRef.current.set(data.id, timer)

            // Highlight blocks pending deletion
            const meta = parseMetadata(data.metadata)
            if (meta.blockIds?.length) {
                highlightedBlocksRef.current.set(data.id, meta.blockIds)
                for (const id of meta.blockIds) {
                    const el = document.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null
                    if (el) el.classList.add('mcp-pending-delete')
                }
            }
        })

        const unsubDismissed = pluginBus.on('mcp:approval-dismissed', (data: { id: string }) => {
            clearBlockHighlights(data.id)
            dismiss(data.id)
        })

        return () => {
            unsubRequired()
            unsubDismissed()
            timersRef.current.forEach(t => clearTimeout(t))
        }
    }, [dismiss, clearBlockHighlights])

    if (actions.length === 0) return null

    return (
        <div className="mcp-approval-container">
            {actions.map(action => (
                <ApprovalToast
                    key={action.id}
                    action={action}
                    onApprove={approve}
                    onReject={reject}
                />
            ))}
        </div>
    )
}

function parseMetadata(meta?: string): { elementIds?: string[], blockIds?: string[] } {
    if (!meta || meta === '{}') return {}
    try { return JSON.parse(meta) } catch { return {} }
}

function humanizeTool(tool: string): string {
    return tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function ApprovalToast({
    action,
    onApprove,
    onReject,
}: {
    action: PendingAction
    onApprove: (id: string) => void
    onReject: (id: string) => void
}) {
    const meta = parseMetadata(action.metadata)
    const isDestructive = action.tool.includes('delete') || action.tool.includes('clear')

    return (
        <div className={`mcp-approval-toast ${isDestructive ? 'mcp-destructive' : ''}`}>
            <div className={`mcp-approval-indicator ${isDestructive ? 'destructive' : ''}`} />
            <div className="mcp-approval-content">
                <div className="mcp-approval-title">{humanizeTool(action.tool)}</div>
                <div className="mcp-approval-desc">{action.description}</div>
                {meta.elementIds && meta.elementIds.length > 0 && (
                    <div className="mcp-approval-targets">
                        {meta.elementIds.map(id => (
                            <span key={id} className="mcp-target-badge">{id}</span>
                        ))}
                    </div>
                )}
            </div>
            <div className="mcp-approval-actions">
                <button
                    className="mcp-approval-btn mcp-reject"
                    onClick={() => onReject(action.id)}
                >
                    Deny
                </button>
                <button
                    className={`mcp-approval-btn ${isDestructive ? 'mcp-approve-destructive' : 'mcp-approve'}`}
                    onClick={() => onApprove(action.id)}
                >
                    {isDestructive ? 'Delete' : 'Allow'}
                </button>
            </div>
        </div>
    )
}
