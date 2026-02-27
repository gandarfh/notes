// ─────────────────────────────────────────────────────────────
// Local Database API
// ─────────────────────────────────────────────────────────────

import type { LocalDatabase, LocalDBRow, LocalDBStats } from '../wails'

function go() { return window.go.app.App }

export const localdbAPI = {
    createDatabase: (blockID: string, name: string): Promise<LocalDatabase> =>
        go().CreateLocalDatabase(blockID, name),
    getDatabase: (blockID: string): Promise<LocalDatabase> =>
        go().GetLocalDatabase(blockID),
    updateConfig: (dbID: string, configJSON: string): Promise<void> =>
        go().UpdateLocalDatabaseConfig(dbID, configJSON),
    renameDatabase: (dbID: string, name: string): Promise<void> =>
        go().RenameLocalDatabase(dbID, name),
    deleteDatabase: (dbID: string): Promise<void> =>
        go().DeleteLocalDatabase(dbID),
    listDatabases: (): Promise<LocalDatabase[]> =>
        go().ListLocalDatabases(),

    createRow: (dbID: string, dataJSON: string): Promise<LocalDBRow> =>
        go().CreateLocalDBRow(dbID, dataJSON),
    listRows: (dbID: string): Promise<LocalDBRow[]> =>
        go().ListLocalDBRows(dbID),
    updateRow: (rowID: string, dataJSON: string): Promise<void> =>
        go().UpdateLocalDBRow(rowID, dataJSON),
    deleteRow: (rowID: string): Promise<void> =>
        go().DeleteLocalDBRow(rowID),
    duplicateRow: (rowID: string): Promise<LocalDBRow> =>
        go().DuplicateLocalDBRow(rowID),
    reorderRows: (dbID: string, rowIDs: string[]): Promise<void> =>
        go().ReorderLocalDBRows(dbID, rowIDs),
    batchUpdateRows: (dbID: string, mutationsJSON: string): Promise<void> =>
        go().BatchUpdateLocalDBRows(dbID, mutationsJSON),
    getStats: (dbID: string): Promise<LocalDBStats> =>
        go().GetLocalDatabaseStats(dbID),
}
