import { useState, useRef, useEffect, useCallback } from 'react'
import { IconPlus, IconNotebook, IconFile, IconLayout } from '@tabler/icons-react'

interface Props {
    onNewNotebook: () => void
    onNewPage: () => void
    onNewBoard: () => void
    hasActiveNotebook: boolean
}

export function SidebarHeader({ onNewNotebook, onNewPage, onNewBoard, hasActiveNotebook }: Props) {
    const [open, setOpen] = useState(false)
    const btnRef = useRef<HTMLButtonElement>(null)
    const dropRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (dropRef.current && !dropRef.current.contains(e.target as Node) &&
                btnRef.current && !btnRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    const getDropdownPos = useCallback(() => {
        if (!btnRef.current) return { top: 0, left: 0 }
        const rect = btnRef.current.getBoundingClientRect()
        return { top: rect.bottom + 4, left: rect.left }
    }, [])

    const pos = open ? getDropdownPos() : { top: 0, left: 0 }

    return (
        <div className="sb-header">
            <button ref={btnRef} className="sb-new-btn" onClick={() => setOpen(!open)}>
                <IconPlus size={14} />
            </button>
            {open && (
                <div
                    ref={dropRef}
                    className="sb-new-dropdown"
                    style={{ position: 'fixed', top: pos.top, left: pos.left, width: 200 }}
                >
                    <button
                        className="sb-context-item"
                        onClick={() => { onNewNotebook(); setOpen(false) }}
                    >
                        <IconNotebook size={14} /> Notebook
                    </button>
                    {hasActiveNotebook && (
                        <>
                            <button
                                className="sb-context-item"
                                onClick={() => { onNewPage(); setOpen(false) }}
                            >
                                <IconFile size={14} /> Canvas Page
                            </button>
                            <button
                                className="sb-context-item"
                                onClick={() => { onNewBoard(); setOpen(false) }}
                            >
                                <IconLayout size={14} /> Document Page
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
