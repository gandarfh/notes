// ═══════════════════════════════════════════════════════════
// useLoadingState — shared loading + error state hook
// ═══════════════════════════════════════════════════════════

import { useState, useCallback, useRef } from 'react'

export interface LoadingState<T> {
    data: T | null
    loading: boolean
    error: string | null
    run: (...args: any[]) => Promise<T | null>
    reset: () => void
}

/**
 * Shared hook for managing async loading + error states.
 * 
 * @example
 * const { data, loading, error, run } = useLoadingState(
 *     async () => ctx.rpc.call<Row[]>('ListLocalDBRows', dbId)
 * )
 * 
 * useEffect(() => { run() }, [dbId])
 * 
 * if (loading) return <div>Loading...</div>
 * if (error) return <div className="error">{error}</div>
 */
export function useLoadingState<T>(
    asyncFn: (...args: any[]) => Promise<T>,
): LoadingState<T> {
    const [data, setData] = useState<T | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const mountedRef = useRef(true)

    // Track mount state to avoid setting state on unmounted component
    useState(() => {
        return () => { mountedRef.current = false }
    })

    const run = useCallback(async (...args: any[]): Promise<T | null> => {
        setLoading(true)
        setError(null)
        try {
            const result = await asyncFn(...args)
            if (mountedRef.current) {
                setData(result)
                setLoading(false)
            }
            return result
        } catch (err: any) {
            if (mountedRef.current) {
                setError(err?.message || String(err))
                setLoading(false)
            }
            return null
        }
    }, [asyncFn])

    const reset = useCallback(() => {
        setData(null)
        setLoading(false)
        setError(null)
    }, [])

    return { data, loading, error, run, reset }
}
