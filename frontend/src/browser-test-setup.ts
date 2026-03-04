/**
 * Browser test setup — mocks the Wails bridge so frontend code
 * can run in a real Chromium environment without the Go backend.
 */

// Mock Wails RPC bridge — all methods return resolved promises
;(window as any).go = {
    app: {
        App: new Proxy({}, {
            get: () => (..._args: any[]) => Promise.resolve(undefined),
        }),
    },
}

// Mock Wails runtime events
;(window as any).runtime = {
    EventsOn: (_event: string, _callback: Function) => () => {},
    EventsEmit: (_event: string, ..._data: any[]) => {},
    EventsOff: (_event: string) => {},
}
