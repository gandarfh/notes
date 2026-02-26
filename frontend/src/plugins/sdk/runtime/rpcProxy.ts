// ═══════════════════════════════════════════════════════════
// RPC Proxy — calls Go backend methods via Wails bindings
// ═══════════════════════════════════════════════════════════

function getWailsApp(): Record<string, Function> {
    const app = (window as any)?.go?.app?.App
    if (!app) {
        throw new Error('[RPC] Wails App bindings not available')
    }
    return app
}

/**
 * Call a Go method on the App struct by name.
 *
 * @example
 * const dbs = await rpcCall<LocalDatabase[]>('ListLocalDatabases')
 * const result = await rpcCall('ExecuteQuery', blockId, connId, query, 50)
 */
export async function rpcCall<T = any>(method: string, ...args: any[]): Promise<T> {
    const app = getWailsApp()
    const fn = app[method]
    if (typeof fn !== 'function') {
        throw new Error(`[RPC] Method '${method}' does not exist on App`)
    }
    return fn(...args) as Promise<T>
}
