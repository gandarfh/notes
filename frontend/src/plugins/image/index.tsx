import { useEffect, useState, memo } from 'react'
import type { BlockPlugin, PluginRendererProps } from '../sdk'

// ── Renderer Component ─────────────────────────────────────────

const ImageRenderer = memo(function ImageRenderer({ block, ctx }: PluginRendererProps) {
    const [src, setSrc] = useState('')

    // Load image: prefer valid data URL from content, otherwise load from file on disk
    useEffect(() => {
        // If content is a valid image data URL, use it directly
        if (block.content && block.content.startsWith('data:image/')) {
            setSrc(block.content)
            return
        }

        // Otherwise load from disk via filePath
        if (!block.filePath) {
            setSrc('')
            return
        }

        ctx?.rpc.call<string>('GetImageData', block.id).then(dataUrl => {
            if (dataUrl) setSrc(dataUrl)
        }).catch(() => { })
    }, [block.id, block.content, block.filePath, ctx])

    if (!src) {
        return (
            <div className="flex items-center justify-center h-full text-text-muted text-xs italic">
                No image
            </div>
        )
    }

    return (
        <img
            src={src}
            alt="Block image"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'top left' }}
            draggable={false}
        />
    )
})

// ── Icon ───────────────────────────────────────────────────

function ImageIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
            <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="7" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 13l4-4 3 3 2-2 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
    )
}

// ── Plugin Registration ────────────────────────────────────

export const imagePlugin: BlockPlugin = {
    type: 'image',
    label: 'Image',
    Icon: ImageIcon,
    defaultSize: { width: 300, height: 200 },
    Renderer: ImageRenderer,
    headerLabel: 'IMG',
    capabilities: {
        aspectRatioResize: true,
        headerless: true,
    },
}
