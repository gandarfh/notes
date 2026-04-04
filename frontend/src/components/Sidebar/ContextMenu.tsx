// frontend/src/components/Sidebar/ContextMenu.tsx
import { useEffect, useRef } from 'react'

interface MenuItem {
    label: string
    action: () => void
    danger?: boolean
}

interface Props {
    x: number
    y: number
    items: MenuItem[]
    onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [onClose])

    return (
        <div ref={ref} className="sb-context-menu" style={{ left: x, top: y }}>
            {items.map((item, i) =>
                item.label === '---' ? (
                    <div key={i} className="sb-context-divider" />
                ) : (
                    <button
                        key={i}
                        className={`sb-context-item ${item.danger ? 'sb-danger' : ''}`}
                        onClick={() => { item.action(); onClose() }}
                    >
                        {item.label}
                    </button>
                )
            )}
        </div>
    )
}
