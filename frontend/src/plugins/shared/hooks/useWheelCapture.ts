// ═══════════════════════════════════════════════════════════
// useWheelCapture — stop wheel propagation for scrollable blocks
// ═══════════════════════════════════════════════════════════

import { useEffect, type RefObject } from 'react'

/**
 * Prevents canvas zoom/pan when scrolling inside a selected block.
 * Stops wheel event propagation so Canvas doesn't intercept it.
 *
 * Used by: localdb, http, chart, database (and any future scrollable plugin).
 */
export function useWheelCapture(
    ref: RefObject<HTMLElement | null>,
    isSelected: boolean,
): void {
    useEffect(() => {
        const el = ref.current
        if (!el || !isSelected) return

        const handler = (e: WheelEvent) => {
            e.stopPropagation()
        }

        el.addEventListener('wheel', handler, { passive: true })
        return () => el.removeEventListener('wheel', handler)
    }, [ref, isSelected])
}
