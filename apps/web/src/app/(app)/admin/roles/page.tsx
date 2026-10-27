'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, LoadingBlock, PageHeader,
} from '@/components/ui/primitives';

interface Role {
  id: string; code: string; name: string; description: string | null; isSystem: boolean;
  userCount: number; permissions: string[]; elevatedPermissions: string[];
}

interface Catalogue {
  modules: { module: string; permissions: { code: string; action: string; description: string; elevated: boolean }[] }[];
  roleDefaults: { code: string; label: string; permissionCount: number; permissions: string[] }[];
}

/**
 * The permission matrix.
 *
 * Elevated permissions - the ones that create or destroy value - are marked, so
 * whoever edits a role can see at a glance that they are about to let a
 * stitching supervisor adjust stock.
 */
export default function RolesPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Set<string> | null>(null);

  const { data: roles, isLoading, error, refetch } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/admin/roles'),
  });
  const { data: catalogue } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api.get<Catalogue>('/admin/permissions'),
  });

  const selected = roles?.find((r) => r.id === selectedId) ?? roles?.[0];

  React.useEffect(() => {
    if (selected && draft === null) setDraft(new Set(selected.permissions));
  }, [selected, draft]);

  const choose = (role: Role) => {
    setSelectedId(role.id);
    setDraft(new Set(role.permissions));
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/roles/${selected!.id}/permissions`, { permissions: [...(draft ?? [])] }),
    onSuccess: () => {
      toast.success(`Permissions updated for ${selected?.name}`);
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!roles || !selected) return null;

  const isSuperAdmin = selected.code === 'SUPER_ADMIN';
  const dirty =
    draft !== null &&
    (draft.size !== selected.permissions.length ||
      selected.permissions.some((p) => !draft.has(p)));

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Every endpoint declares the permissions it requires and the server checks them on each request. Hiding a button in the interface is a convenience, not a control."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Roles" description={`${roles.length} defined`} />
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className={
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors ' +
                    (r.id === selected.id ? 'bg-brand-soft font-medium text-brand-strong' : 'hover:bg-surface-muted')
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate">{r.name}</span>
                    <span className="block text-[12px] text-ink-muted">
                      {r.permissions.length} permissions · {r.userCount} user{r.userCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  {r.elevatedPermissions.length > 0 ? (
                    <span
                      className="shrink-0"
                      title={`${r.elevatedPermissions.length} elevated permissions`}
                    >
                      <ShieldAlert className="size-3.5 text-warn" />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={selected.name}
            description={selected.description ?? undefined}
            actions={
              isSuperAdmin ? (
                <Badge tone="warn">Always holds every permission</Badge>
              ) : (
                <Button variant="primary" size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
                  <Save />
                  Save
                </Button>
              )
            }
          />
          <CardBody className="space-y-4">
            {(catalogue?.modules ?? []).map((mod) => (
              <div key={mod.module}>
                <p className="mb-1.5 t-micro text-ink-subtle">
                  {humanise(mod.module)}
                </p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
                  {mod.permissions.map((p) => {
                    const held = isSuperAdmin || (draft?.has(p.code) ?? false);
                    return (
                      <label
                        key={p.code}
                        className={
                          'flex items-start gap-2 rounded border px-2 py-1.5 text-[12px] ' +
                          (p.elevated ? 'border-warn/30 bg-warn-soft/50' : 'border-line') +
                          (isSuperAdmin ? ' opacity-70' : ' cursor-pointer hover:border-line-strong')
                        }
                      >
                        <input
                          type="checkbox"
                          checked={held}
                          disabled={isSuperAdmin}
                          onChange={(e) =>
                            setDraft((d) => {
                              const next = new Set(d ?? []);
                              if (e.target.checked) next.add(p.code);
                              else next.delete(p.code);
                              return next;
                            })
                          }
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-[12px] text-ink">{p.code}</span>
                          <span className="block text-[12px] text-ink-muted">{p.description}</span>
                          {p.elevated ? <Badge tone="warn" className="mt-0.5">elevated</Badge> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
