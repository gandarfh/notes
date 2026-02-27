// ═══════════════════════════════════════════════════════════
// bridge/api/index.ts — Unified API barrel
// ═══════════════════════════════════════════════════════════
//
// Exports two forms:
//   1. Namespaced: `import { etlAPI, localdbAPI } from './api'`
//   2. Flat: `import { api } from './api'` (backward-compatible with existing code)

export { notebookAPI } from './notebook'
export { blockAPI } from './block'
export { etlAPI } from './etl'
export { localdbAPI } from './localdb'
export { databaseAPI, httpAPI, terminalAPI, connectionAPI } from './database'

// ── Flat `api` object for backward compatibility ──────────
// All existing code that imports `api` from bridge/wails continues to work.

import { notebookAPI } from './notebook'
import { blockAPI } from './block'
import { etlAPI } from './etl'
import { localdbAPI } from './localdb'
import { databaseAPI, httpAPI, terminalAPI, connectionAPI } from './database'

function go() { return window.go.app.App }

export const api = {
    // ── Notebooks + Pages ──────────────────────────────────
    ...notebookAPI,

    // ── Blocks ─────────────────────────────────────────────
    ...blockAPI,

    // ── Connections ────────────────────────────────────────
    ...connectionAPI,

    // ── Terminal ───────────────────────────────────────────
    terminalWrite: terminalAPI.write,
    terminalResize: terminalAPI.resize,

    // ── Database plugin ────────────────────────────────────
    listDatabaseConnections: databaseAPI.listConnections,
    createDatabaseConnection: databaseAPI.createConnection,
    updateDatabaseConnection: databaseAPI.updateConnection,
    deleteDatabaseConnection: databaseAPI.deleteConnection,
    testDatabaseConnection: databaseAPI.testConnection,
    introspectDatabase: databaseAPI.introspect,
    executeQuery: databaseAPI.executeQuery,
    fetchMoreRows: databaseAPI.fetchMoreRows,
    getCachedResult: databaseAPI.getCachedResult,
    clearCachedResult: databaseAPI.clearCachedResult,
    saveBlockDatabaseConfig: databaseAPI.saveBlockConfig,
    pickDatabaseFile: databaseAPI.pickFile,
    applyMutations: databaseAPI.applyMutations,

    // ── Local Database plugin ──────────────────────────────
    createLocalDatabase: localdbAPI.createDatabase,
    getLocalDatabase: localdbAPI.getDatabase,
    updateLocalDatabaseConfig: localdbAPI.updateConfig,
    renameLocalDatabase: localdbAPI.renameDatabase,
    deleteLocalDatabase: localdbAPI.deleteDatabase,
    listLocalDatabases: localdbAPI.listDatabases,
    createLocalDBRow: localdbAPI.createRow,
    listLocalDBRows: localdbAPI.listRows,
    updateLocalDBRow: localdbAPI.updateRow,
    deleteLocalDBRow: localdbAPI.deleteRow,
    duplicateLocalDBRow: localdbAPI.duplicateRow,
    reorderLocalDBRows: localdbAPI.reorderRows,
    batchUpdateLocalDBRows: localdbAPI.batchUpdateRows,
    getLocalDatabaseStats: localdbAPI.getStats,

    // ── ETL plugin ─────────────────────────────────────────
    listETLSources: etlAPI.listSources,
    createETLJob: etlAPI.createJob,
    getETLJob: etlAPI.getJob,
    listETLJobs: etlAPI.listJobs,
    updateETLJob: etlAPI.updateJob,
    deleteETLJob: etlAPI.deleteJob,
    runETLJob: etlAPI.runJob,
    previewETLSource: etlAPI.previewSource,
    listETLRunLogs: etlAPI.listRunLogs,
    pickETLFile: etlAPI.pickFile,
    listPageDatabaseBlocks: etlAPI.listPageDatabaseBlocks,
    discoverETLSchema: etlAPI.discoverSchema,

    // ── HTTP plugin ────────────────────────────────────────
    executeHTTPRequest: httpAPI.executeRequest,
    saveBlockHTTPConfig: httpAPI.saveBlockConfig,
    listPageHTTPBlocks: etlAPI.listPageHTTPBlocks,
} as const
