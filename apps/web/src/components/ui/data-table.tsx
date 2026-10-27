'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, EmptyState, Input, LoadingBlock, Spinner } from './primitives';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: readonly T[];
  isLoading?: boolean;
  isFetching?: boolean;
  /** Server-side pagination state. Omit for a client-only table. */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  };
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  toolbar?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  /** CSV export of the rows currently loaded. */
  exportFileName?: string;
  stickyHeader?: boolean;
}

/**
 * The one table component.
 *
 * Deliberately compact and dense: these screens are read all day, and the
 * useful comparison is between rows, so the design spends its pixels on fitting
 * more rows rather than on padding. Quantity columns use tabular figures (see
 * the `.num` class) so decimal points line up and a wrong magnitude is visible
 * at a glance.
 */
export function DataTable<T>({
  columns,
  data,
  isLoading,
  isFetching,
  pagination,
  search,
  toolbar,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  onRowClick,
  exportFileName,
  stickyHeader = true,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const table = useReactTable({
    data: data as T[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: Boolean(pagination),
  });

  const rows = table.getRowModel().rows;

  const exportCsv = () => {
    const header = table
      .getAllLeafColumns()
      .filter((c) => c.id !== 'select' && c.id !== 'actions')
      .map((c) => csvCell(String(c.columnDef.header ?? c.id)));

    const body = rows.map((row) =>
      row
        .getAllCells()
        .filter((c) => c.column.id !== 'select' && c.column.id !== 'actions')
        .map((c) => csvCell(stringifyCell(c.getValue())))
        .join(','),
    );

    const blob = new Blob([[header.join(','), ...body].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportFileName ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-dense overflow-hidden rounded-2xl">
      {search || toolbar || exportFileName ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {search ? (
            <div className="relative min-w-[200px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder ?? 'Search'}
                className="pl-9 pr-8"
              />
              {search.value ? (
                <button
                  type="button"
                  onClick={() => search.onChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          <div className="flex items-center gap-2">
            {isFetching && !isLoading ? <Spinner className="size-3.5" /> : null}
            {toolbar}
            {exportFileName ? (
              <Button variant="ghost" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
                <Download />
                CSV
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="scroll-x">
          <table className="w-full border-collapse text-[13px]">
            <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-line bg-surface-muted">
                  {hg.headers.map((header) => {
                    const sortable = header.column.getCanSort();
                    const dir = header.column.getIsSorted();
                    const meta = header.column.columnDef.meta as { align?: 'right' | 'center' } | undefined;
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          'whitespace-nowrap px-3.5 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-subtle',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                          sortable && 'cursor-pointer select-none hover:text-ink',
                        )}
                        style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                        onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                      >
                        <span className={cn('inline-flex items-center gap-1', meta?.align === 'right' && 'flex-row-reverse')}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === 'asc' ? <ArrowUp className="size-3" /> : null}
                          {dir === 'desc' ? <ArrowDown className="size-3" /> : null}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-b border-line transition-colors duration-150 last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-brand-soft',
                    !onRowClick && 'hover:bg-surface-muted',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      | { align?: 'right' | 'center'; numeric?: boolean }
                      | undefined;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3.5 py-2.5 align-middle text-ink',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                          meta?.numeric && 'num',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-muted">
          <span className="num">
            {(pagination.page - 1) * pagination.pageSize + 1}
            {'-'}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total.toLocaleString('en-IN')}
          </span>

          <div className="flex items-center gap-1.5">
            {pagination.onPageSizeChange ? (
              <select
                value={pagination.pageSize}
                onChange={(e) => pagination.onPageSizeChange?.(Number(e.target.value))}
                className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] text-ink [&>option]:bg-canvas"
                aria-label="Rows per page"
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              variant="default"
              size="icon"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span className="num px-1">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="default"
              size="icon"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Monospaced code cell for SKUs, lot codes, barcodes and document numbers. */
export function CodeCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] text-ink', className)}>{children}</span>;
}

/** Two-line cell: a primary identifier with context underneath. */
export function StackedCell({
  primary,
  secondary,
  mono,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={cn('truncate font-medium text-ink', mono && 'font-mono text-[12px]')}>{primary}</div>
      {secondary ? <div className="truncate text-[12px] text-ink-muted">{secondary}</div> : null}
    </div>
  );
}
