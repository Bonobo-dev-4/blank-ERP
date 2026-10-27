'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, humanise } from '@/lib/utils';
import { Badge, ErrorPanel, Input, NativeSelect, PageHeader } from '@/components/ui/primitives';
import { DataTable, StackedCell } from '@/components/ui/data-table';

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'CANCEL',
  'POST', 'RELEASE', 'SCAN', 'PUSH', 'LOGIN', 'LOGIN_FAILED',
] as const;

interface AuditRow {
  id: string; action: string; entityType: string; entityId: string | null;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  context: Record<string, unknown> | null;
  ipAddress: string | null; createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
}

export default function AuditPage() {
  const state = useListState({ pageSize: 50 });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<AuditRow>(
    'audit', '/admin/audit', state,
  );

  const columns = React.useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      { id: 'createdAt', header: 'When', accessorKey: 'createdAt',
        cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.createdAt)}</span> },
      { id: 'actor', header: 'Who', accessorFn: (r) => r.actor?.fullName ?? '',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.actor?.fullName ?? 'System'}
            secondary={row.original.actor?.email ?? row.original.ipAddress ?? undefined}
          />
        ),
      },
      { id: 'action', header: 'Action', accessorKey: 'action',
        cell: ({ row }) => {
          const a = row.original.action;
          const tone =
            a === 'DELETE' || a === 'CANCEL' || a === 'REJECT' || a === 'LOGIN_FAILED' ? 'danger'
            : a === 'APPROVE' || a === 'POST' || a === 'RELEASE' ? 'ok'
            : a === 'PUSH' ? 'warn'
            : 'outline';
          return <Badge tone={tone}>{humanise(a)}</Badge>;
        },
      },
      { id: 'entityType', header: 'Entity', accessorKey: 'entityType',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.entityType}
            secondary={row.original.entityId ? `${row.original.entityId.slice(0, 8)}…` : undefined}
          />
        ),
      },
      { id: 'context', header: 'Detail',
        accessorFn: (r) => JSON.stringify(r.context ?? {}),
        cell: ({ row }) => {
          const ctx = row.original.context ?? {};
          const entries = Object.entries(ctx).filter(([k]) => k !== 'elevated');
          const elevated = Boolean((ctx as { elevated?: boolean }).elevated);
          return (
            <div className="min-w-0">
              {elevated ? <Badge tone="warn" className="mr-1.5">elevated</Badge> : null}
              <span className="text-[12px] text-ink-muted">
                {entries.slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}
              </span>
            </div>
          );
        },
      },
      { id: 'diff', header: 'Changed',
        accessorFn: (r) => (r.diff ? Object.keys(r.diff).length : 0),
        cell: ({ row }) => {
          const diff = row.original.diff;
          if (!diff || Object.keys(diff).length === 0) return <span className="text-ink-subtle">-</span>;
          return (
            <span className="font-mono text-[12px] text-ink-muted">
              {Object.keys(diff).slice(0, 5).join(', ')}
              {Object.keys(diff).length > 5 ? ` +${Object.keys(diff).length - 5}` : ''}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Append-only. Written inside the same transaction as the action it describes, so the log and the data it records cannot disagree. Credentials are never recorded."
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        exportFileName="audit-log"
        emptyTitle="No audit entries"
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.action ?? '')}
              onChange={(e) => state.setFilter('action', e.target.value || undefined)}
              className="w-auto"
              aria-label="Action"
            >
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{humanise(a)}</option>
              ))}
            </NativeSelect>
            <Input
              value={String(state.filters.entityType ?? '')}
              onChange={(e) => state.setFilter('entityType', e.target.value || undefined)}
              placeholder="Entity type"
              className="w-auto max-w-[180px]"
              aria-label="Entity type"
            />
          </>
        }
      />
    </div>
  );
}
