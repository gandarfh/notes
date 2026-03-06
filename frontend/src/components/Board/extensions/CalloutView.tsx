import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import {
    IconInfoCircle,
    IconAlertTriangle,
    IconCircleCheck,
    IconCircleX,
} from '@tabler/icons-react'
import type { ComponentType } from 'react'

const calloutConfig: Record<string, { Icon: ComponentType<{ size?: number }>; label: string }> = {
    info: { Icon: IconInfoCircle, label: 'Info' },
    warning: { Icon: IconAlertTriangle, label: 'Warning' },
    success: { Icon: IconCircleCheck, label: 'Success' },
    error: { Icon: IconCircleX, label: 'Error' },
}

const typeOrder = ['info', 'warning', 'success', 'error']

export function CalloutView({ node, updateAttributes }: any) {
    const type = node.attrs.type || 'info'
    const config = calloutConfig[type] || calloutConfig.info
    const { Icon } = config

    const cycleType = () => {
        const idx = typeOrder.indexOf(type)
        const next = typeOrder[(idx + 1) % typeOrder.length]
        updateAttributes({ type: next })
    }

    return (
        <NodeViewWrapper className={`doc-callout doc-callout-${type}`}>
            <button
                className="doc-callout-icon"
                onClick={cycleType}
                contentEditable={false}
                title={`${config.label} — click to change`}
            >
                <Icon size={18} />
            </button>
            <NodeViewContent className="doc-callout-content" />
        </NodeViewWrapper>
    )
}
