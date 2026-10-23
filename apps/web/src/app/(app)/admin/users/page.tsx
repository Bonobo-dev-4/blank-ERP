'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/utils';
import { Badge, Button, ErrorPanel, Field, Input, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';

interface UserRow {
  id: string; email: string; fullName: string; employeeCode: string | null;
  status: string; lastLoginAt: string | null; createdAt: string;
  userRoles: { role: { id: string; code: string; name: string } }[];
}

interface RoleOption { id: string; code: string; name: string; userCount: number; permissions: string[] }

export default function UsersPage() {
  const state = useListState({ sortBy: 'fullName', sortDir: 'asc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<UserRow>('users', '/admin/users', state);
  const [creating, setCreating] = React.useState(false);

  const columns = React.useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      { id: 'fullName', header: 'User', accessorKey: 'fullName',
        cell: ({ row }) => <StackedCell primary={row.original.fullName} secondary={row.original.email} /> },
      { id: 'employeeCode', header: 'Employee code', accessorKey: 'employeeCode',
        cell: ({ row }) => (row.original.employeeCode ? <CodeCell>{row.original.employeeCode}</CodeCell> : '-') },
      { id: 'roles', header: 'Roles', accessorFn: (r) => r.userRoles.length,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.userRoles.map((ur) => (
              <Badge key={ur.role.id} tone="outline">{ur.role.name}</Badge>
            ))}
          </div>
        ),
      },
      { id: 'lastLoginAt', header: 'Last sign in', accessorKey: 'lastLoginAt',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.lastLoginAt ? fmtDateTime(row.original.lastLoginAt) : 'Never'}</span> },
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Users"
        description="Roles decide what a user can do, and the server enforces it on every request. A shop-floor PIN is only useful in combination with a narrow role."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New user
          </Button>
        }
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Name, email, employee code' }}
        exportFileName="users"
        emptyTitle="No users"
      />
      {creating ? <UserDialog open={creating} onOpenChange={setCreating} onSaved={() => void refetch()} /> : null}
    </div>
  );
}

function UserDialog({
  open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    fullName: '', email: '', employeeCode: '', password: '', pin: '',
  });
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleOption[]>('/admin/roles'),
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      api.post('/admin/users', {
        email: form.email,
        fullName: form.fullName,
        employeeCode: form.employeeCode || null,
        password: form.password,
        pin: form.pin || null,
        roleIds,
      }),
    onSuccess: () => {
      toast.success(`User ${form.email} created`);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e);
    },
  });

  const ready = form.fullName && form.email && form.password.length >= 8 && roleIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title="New user"
        description="Assign at least one role. Without a role the account can sign in but do nothing."
        footer={
          <>
            <DialogClose asChild><Button variant="default">Cancel</Button></DialogClose>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}>
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name" required error={fieldErrors.fullName}>
              <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
            </Field>
            <Field label="Email" required error={fieldErrors.email}>
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Employee code" hint="needed for shop-floor PIN sign in" error={fieldErrors.employeeCode}>
              <Input
                value={form.employeeCode}
                onChange={(e) => set('employeeCode', e.target.value.toUpperCase())}
                className="font-mono uppercase"
                placeholder="OP-014"
              />
            </Field>
            <Field label="Password" required hint="at least 8 characters" error={fieldErrors.password}>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Shop-floor PIN" hint="4 to 8 digits, optional" error={fieldErrors.pin}>
              <Input
                inputMode="numeric"
                value={form.pin}
                onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 8))}
                className="num"
              />
            </Field>
          </div>

          <Field label="Roles" required>
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded border border-line p-2 sm:grid-cols-2">
              {(roles ?? []).map((r) => (
                <label key={r.id} className="flex items-start gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={roleIds.includes(r.id)}
                    onChange={(e) =>
                      setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))
                    }
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="block text-[11px] text-ink-muted">
                      {r.permissions.length} permissions
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
