// frontend/src/components/Sidebar/SidebarHeader.tsx
import { useState, useRef, useEffect } from 'react'

interface Props {
    onNewNotebook: () => void
    onNewPage: () => void
    onNewBoard: () => void
    hasActiveNotebook: boolean
}

export function SidebarHeader({ onNewNotebook, onNewPage, onNewBoard, hasActiveNotebook }: Props) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    return (
        <div className="sb-header" ref={ref}>
            <button className="sb-new-btn" onClick={() => setOpen(!open)}>
                + New
            </button>
            {open && (
                <div className="sb-new-dropdown">
                    <button
                        className="sb-context-item"
                        onClick={() => { onNewNotebook(); setOpen(false) }}
                    >
                        New Notebook
                    </button>
                    {hasActiveNotebook && (
                        <>
                            <button
                                className="sb-context-item"
                                onClick={() => { onNewPage(); setOpen(false) }}
                            >
                                New Page
                            </button>
                            <button
                                className="sb-context-item"
                                onClick={() => { onNewBoard(); setOpen(false) }}
                            >
                                New Board
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
