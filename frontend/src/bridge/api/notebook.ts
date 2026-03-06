// ─────────────────────────────────────────────────────────────
// Notebook + Page API
// ─────────────────────────────────────────────────────────────

import type { Notebook, Page, PageState, Block, Connection } from '../wails'

function go() { return window.go.app.App }

export const notebookAPI = {
    listNotebooks: (): Promise<Notebook[]> => go().ListNotebooks(),
    createNotebook: (name: string): Promise<Notebook> => go().CreateNotebook(name),
    renameNotebook: (id: string, name: string): Promise<void> => go().RenameNotebook(id, name),
    deleteNotebook: (id: string): Promise<void> => go().DeleteNotebook(id),

    listPages: (notebookID: string): Promise<Page[]> => go().ListPages(notebookID),
    createPage: (notebookID: string, name: string): Promise<Page> => go().CreatePage(notebookID, name),
    createBoardPage: (notebookID: string, name: string): Promise<Page> => go().CreateBoardPage(notebookID, name),
    getPageState: (pageID: string): Promise<PageState> => go().GetPageState(pageID),
    renamePage: (id: string, name: string): Promise<void> => go().RenamePage(id, name),
    updateViewport: (pageID: string, x: number, y: number, zoom: number): Promise<void> => go().UpdateViewport(pageID, x, y, zoom),
    updateDrawingData: (pageID: string, data: string): Promise<void> => go().UpdateDrawingData(pageID, data),
    deletePage: (id: string): Promise<void> => go().DeletePage(id),
    updateBoardContent: (pageID: string, content: string): Promise<void> => go().UpdateBoardContent(pageID, content),
    updateBoardLayout: (pageID: string, layout: string): Promise<void> => go().UpdateBoardLayout(pageID, layout),
    updateBoardMode: (pageID: string, mode: string): Promise<void> => go().UpdateBoardMode(pageID, mode),
}
