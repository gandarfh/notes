// ─────────────────────────────────────────────────────────────
// ETL API
// ─────────────────────────────────────────────────────────────

import type {
    ETLSourceSpec,
    ETLJobInput,
    ETLSyncJob,
    ETLSyncResult,
    ETLPreviewResult,
    ETLRunLog,
    ETLSchemaInfo,
    PageBlockRef,
} from '../wails'

function go() { return window.go.app.App }

export const etlAPI = {
    listSources: (): Promise<ETLSourceSpec[]> =>
        go().ListETLSources(),
    createJob: (input: ETLJobInput): Promise<ETLSyncJob> =>
        go().CreateETLJob(input),
    getJob: (id: string): Promise<ETLSyncJob> =>
        go().GetETLJob(id),
    listJobs: (): Promise<ETLSyncJob[]> =>
        go().ListETLJobs(),
    updateJob: (id: string, input: ETLJobInput): Promise<void> =>
        go().UpdateETLJob(id, input),
    deleteJob: (id: string): Promise<void> =>
        go().DeleteETLJob(id),
    runJob: (id: string): Promise<ETLSyncResult> =>
        go().RunETLJob(id),
    previewSource: (sourceType: string, sourceConfigJSON: string): Promise<ETLPreviewResult> =>
        go().PreviewETLSource(sourceType, sourceConfigJSON),
    listRunLogs: (jobID: string): Promise<ETLRunLog[]> =>
        go().ListETLRunLogs(jobID),
    pickFile: (): Promise<string> =>
        go().PickETLFile(),
    listPageDatabaseBlocks: (pageID: string): Promise<PageBlockRef[]> =>
        go().ListPageDatabaseBlocks(pageID),
    discoverSchema: (sourceType: string, sourceConfigJSON: string): Promise<ETLSchemaInfo> =>
        go().DiscoverETLSchema(sourceType, sourceConfigJSON),
    listPageHTTPBlocks: (pageID: string): Promise<PageBlockRef[]> =>
        go().ListPageHTTPBlocks(pageID),
}
