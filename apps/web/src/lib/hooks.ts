'use client';

import * as React from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, type Paginated } from './api';

export interface ListState {
  page: number;
  pageSize: number;
  search: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  setSearch: (s: string) => void;
  setSort: (by: string, dir: 'asc' | 'desc') => void;
  /** Extra filters merged into the request query. */
  filters: Record<string, string | number | boolean | undefined>;
  setFilter: (key: string, value: string | number | boolean | undefined) => void;
  resetFilters: () => void;
}

/** List screen state: paging, search and filters, with search debounced. */
export function useListState(initial: Partial<ListState> = {}): ListState & { debouncedSearch: string } {
  const [page, setPage] = React.useState(initial.page ?? 1);
  const [pageSize, setPageSize] = React.useState(initial.pageSize ?? 25);
  const [search, setSearchRaw] = React.useState(initial.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = React.useState(search);
  const [sortBy, setSortBy] = React.useState(initial.sortBy);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>(initial.sortDir ?? 'asc');
  const [filters, setFilters] = React.useState<ListState['filters']>(initial.filters ?? {});

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Any change to what is being filtered puts the reader back on page one;
  // staying on page 7 of a different result set is disorienting.
  const setSearch = React.useCallback((s: string) => { setSearchRaw(s); setPage(1); }, []);
  const setFilter = React.useCallback((key: string, value: string | number | boolean | undefined) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);
  const resetFilters = React.useCallback(() => { setFilters({}); setSearchRaw(''); setPage(1); }, []);
  const setSort = React.useCallback((by: string, dir: 'asc' | 'desc') => { setSortBy(by); setSortDir(dir); }, []);

  return {
    page, pageSize, search, debouncedSearch, sortBy, sortDir, filters,
    setPage, setPageSize, setSearch, setSort, setFilter, resetFilters,
  };
}

/** Paginated GET bound to a ListState. */
export function useListQuery<T>(
  key: string,
  path: string,
  state: ListState & { debouncedSearch: string },
  extra: Record<string, string | number | boolean | undefined> = {},
): UseQueryResult<Paginated<T>> {
  const query = {
    page: state.page,
    pageSize: state.pageSize,
    search: state.debouncedSearch || undefined,
    sortBy: state.sortBy,
    sortDir: state.sortDir,
    ...state.filters,
    ...extra,
  };
  return useQuery({
    queryKey: [key, query],
    queryFn: () => api.get<Paginated<T>>(path, query),
    // Keeps the previous page visible while the next one loads, so the table
    // does not collapse to a spinner on every page change.
    placeholderData: keepPreviousData,
  });
}

export function paginationProps(
  data: { page: number; pageSize: number; total: number; totalPages: number } | undefined,
  state: ListState,
) {
  if (!data) return undefined;
  return {
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    totalPages: data.totalPages,
    onPageChange: state.setPage,
    onPageSizeChange: state.setPageSize,
  };
}
