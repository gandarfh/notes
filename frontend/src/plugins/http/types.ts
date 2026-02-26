// ═══════════════════════════════════════════════════════════
// HTTP Plugin — Local Type Definitions
// ═══════════════════════════════════════════════════════════

export interface KeyValuePair {
    key: string
    value: string
    enabled: boolean
}

export interface HTTPBlockConfig {
    method: string
    url: string
    headers: KeyValuePair[]
    queryParams: KeyValuePair[]
    bodyType: 'none' | 'json' | 'form' | 'text'
    body: string
    formData: KeyValuePair[]
}

export interface HTTPResponseData {
    statusCode: number
    statusText: string
    headers: Record<string, string>
    body: string
    durationMs: number
    size: number
}
