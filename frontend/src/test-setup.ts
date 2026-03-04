// Global test setup — provides browser globals for Node environment
const storage = new Map<string, string>()

globalThis.localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v) },
    removeItem: (k: string) => { storage.delete(k) },
    clear: () => storage.clear(),
    get length() { return storage.size },
    key: (_i: number) => null,
} as Storage

const mockCtx2d = {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
}

globalThis.document = {
    documentElement: { style: { setProperty: () => {}, fontSize: '' }, dataset: {}, getAttribute: () => null },
    createElement: () => ({ getContext: () => mockCtx2d }),
} as any
