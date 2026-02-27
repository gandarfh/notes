// ═══════════════════════════════════════════════════════════
// useBlockConfig — parse/persist block config from content
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useCallback, useMemo } from 'react'
import type { PluginContext } from '../../sdk'

/**
 * Hook that manages a typed config stored in block.content as JSON.
 * Handles parsing, ref tracking, and persistence via ctx.storage.
 *
 * @example
 * const { config, configRef, updateConfig } = useBlockConfig(ctx, {
 *   connectionId: '',
 *   query: '',
 *   fetchSize: 50,
 * })
 */
export function useBlockConfig<T extends Record<string, any>>(
    ctx: PluginContext,
    defaultConfig: T,
) {
    const parse = useCallback((raw: string): T => {
        try {
            return { ...defaultConfig, ...JSON.parse(raw || '{}') } as T
        } catch {
            return { ...defaultConfig }
        }
    }, []) // defaultConfig is stable (object literal at call site)

    const initialContent = ctx.storage.getContent()
    const [config, setConfig] = useState<T>(() => parse(initialContent))
    const configRef = useRef(config)
    configRef.current = config

    // Track external content changes (e.g. undo/redo, other tabs)
    const lastContentRef = useRef(initialContent)
    const currentContent = ctx.storage.getContent()
    if (currentContent !== lastContentRef.current) {
        lastContentRef.current = currentContent
        const parsed = parse(currentContent)
        setConfig(parsed)
        configRef.current = parsed
    }

    const updateConfig = useCallback((partial: Partial<T>) => {
        const next = { ...configRef.current, ...partial }
        setConfig(next)
        configRef.current = next
        const json = JSON.stringify(next)
        lastContentRef.current = json
        ctx.storage.setContent(json)
    }, [ctx])

    const updateConfigDebounced = useCallback((partial: Partial<T>) => {
        const next = { ...configRef.current, ...partial }
        setConfig(next)
        configRef.current = next
        const json = JSON.stringify(next)
        lastContentRef.current = json
        ctx.storage.setContentDebounced(json)
    }, [ctx])

    const replaceConfig = useCallback((full: T) => {
        setConfig(full)
        configRef.current = full
        const json = JSON.stringify(full)
        lastContentRef.current = json
        ctx.storage.setContent(json)
    }, [ctx])

    return {
        config,
        configRef,
        updateConfig,
        updateConfigDebounced,
        replaceConfig,
    }
}
