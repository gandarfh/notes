import { useEffect, useMemo, useState } from 'react'
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    type ColumnDef as TanStackColumnDef,
    type SortingState,
    type ColumnFiltersState,
    type VisibilityState,
} from '@tanstack/react-table'
import type { ColumnDef, LocalDBRow, ViewConfig } from './types'
import { localdbFilterFn } from './FilterBuilder'

// Parsed row data used by TanStack Table
export interface ParsedRow {
    _raw: LocalDBRow
    [key: string]: unknown
}

interface UseLocalDBTableOptions {
    columns: ColumnDef[]
    rows: LocalDBRow[]
    viewConfig: ViewConfig
}

export function useLocalDBTable({ columns, rows, viewConfig }: UseLocalDBTableOptions) {
    // Parse row dataJson once and memoize
    const data = useMemo<ParsedRow[]>(() =>
        rows.map(row => {
            try {
                const parsed = JSON.parse(row.dataJson || '{}')
                return { ...parsed, _raw: row }
            } catch {
                return { _raw: row }
            }
        }),
        [rows],
    )

    // Convert LocalDB ColumnDef[] to TanStack ColumnDef[]
    const tanstackColumns = useMemo<TanStackColumnDef<ParsedRow>[]>(() =>
        columns.map(col => ({
            id: col.id,
            accessorFn: (row: ParsedRow) => row[col.id],
            header: col.name,
            size: col.width,
            minSize: 60,
            meta: { localdbColumn: col },
            filterFn: localdbFilterFn,
        })),
        [columns],
    )

    // Table state — only filter/sort/visibility (shared across views)
    const [sorting, setSorting] = useState<SortingState>(
        viewConfig.sorting ?? [],
    )
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
        viewConfig.filters?.map(f => ({ id: f.columnId, value: { operator: f.operator, value: f.value } })) ?? [],
    )
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        viewConfig.columnVisibility ?? {},
    )

    // Sync state when viewConfig changes (e.g. switching saved views)
    useEffect(() => {
        setSorting(viewConfig.sorting ?? [])
        setColumnFilters(
            viewConfig.filters?.map(f => ({ id: f.columnId, value: { operator: f.operator, value: f.value } })) ?? [],
        )
        setColumnVisibility(viewConfig.columnVisibility ?? {})
    }, [viewConfig])

    const table = useReactTable({
        data,
        columns: tanstackColumns,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getRowId: (row) => row._raw.id,
    })

    return {
        table,
        data,
        sorting,
        setSorting,
        columnFilters,
        setColumnFilters,
        columnVisibility,
        setColumnVisibility,
    }
}

// Helper to get the LocalDB ColumnDef from a TanStack column
export function getLocalDBColumn(tanstackColumn: { columnDef: { meta?: unknown } }): ColumnDef | undefined {
    const meta = tanstackColumn.columnDef.meta as Record<string, unknown> | undefined
    return meta?.localdbColumn as ColumnDef | undefined
}
