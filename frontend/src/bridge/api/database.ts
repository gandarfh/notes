// ─────────────────────────────────────────────────────────────
// External Database + HTTP API
// ─────────────────────────────────────────────────────────────

import type {
    DBConnView,
    CreateDBConnInput,
    SchemaInfo,
    QueryResultView,
    Mutation,
    MutationResult,
    HTTPResponse,
} from '../wails'

function go() { return window.go.app.App }

export const databaseAPI = {
    listConnections: (): Promise<DBConnView[]> =>
        go().ListDatabaseConnections(),
    createConnection: (input: CreateDBConnInput): Promise<DBConnView> =>
        go().CreateDatabaseConnection(input),
    updateConnection: (id: string, input: CreateDBConnInput): Promise<void> =>
        go().UpdateDatabaseConnection(id, input),
    deleteConnection: (id: string): Promise<void> =>
        go().DeleteDatabaseConnection(id),
    testConnection: (id: string): Promise<void> =>
        go().TestDatabaseConnection(id),
    introspect: (connectionID: string): Promise<SchemaInfo> =>
        go().IntrospectDatabase(connectionID),

    executeQuery: (blockID: string, connectionID: string, query: string, fetchSize: number): Promise<QueryResultView> =>
        go().ExecuteQuery(blockID, connectionID, query, fetchSize),
    fetchMoreRows: (connectionID: string, fetchSize: number): Promise<QueryResultView> =>
        go().FetchMoreRows(connectionID, fetchSize),
    getCachedResult: (blockID: string): Promise<QueryResultView | null> =>
        go().GetCachedResult(blockID),
    clearCachedResult: (blockID: string): Promise<void> =>
        go().ClearCachedResult(blockID),
    saveBlockConfig: (blockID: string, config: string): Promise<void> =>
        go().SaveBlockDatabaseConfig(blockID, config),
    pickFile: (): Promise<string> =>
        go().PickDatabaseFile(),
    applyMutations: (connectionID: string, table: string, mutations: Mutation[]): Promise<MutationResult> =>
        go().ApplyMutations(connectionID, table, mutations),
}

export const httpAPI = {
    executeRequest: (blockID: string, configJSON: string): Promise<HTTPResponse> =>
        go().ExecuteHTTPRequest(blockID, configJSON),
    saveBlockConfig: (blockID: string, config: string): Promise<void> =>
        go().SaveBlockHTTPConfig(blockID, config),
}

export const terminalAPI = {
    write: (data: string): Promise<void> => go().TerminalWrite(data),
    resize: (cols: number, rows: number): Promise<void> => go().TerminalResize(cols, rows),
}

export const connectionAPI = {
    createConnection: (pageID: string, from: string, to: string) =>
        go().CreateConnection(pageID, from, to),
    updateConnection: (id: string, label: string, color: string, style: string) =>
        go().UpdateConnection(id, label, color, style),
    deleteConnection: (id: string) =>
        go().DeleteConnection(id),
}
