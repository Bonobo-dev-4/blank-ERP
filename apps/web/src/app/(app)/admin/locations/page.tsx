'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Plus } from 'lucide-react';
import { LOCATION_KINDS, STORAGE_LEVELS, createLocationRequest } from '@dnd/contracts';
import { api } from '@/lib/api';
import { fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, LoadingBlock,
  NativeSelect, PageHeader, StatusBadge,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface LocationRow {
  id: string; code: string; name: string; kind: string; storageLevel: string | null;
  parentId: string | null; isSystem: boolean; blocksIssue: boolean; status: string;
  totalOnHandQty: string; totalReservedQty: string;
  jobWorker: { id: string; code: string; name: string } | null;
  _count: { balances: number };
}

export default function LocationsPage() {
  const { can } = useAuth();
  const [creating, setCreating] = React.useState(false);
  const [showSystem, setShowSystem] = React.useState(true);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['locations', 'admin', showSystem],
    queryFn: () => api.get<LocationRow[]>('/locations', { includeSystem: showSystem }),
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;

  const rows = data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = (r: LocationRow): number => {
    let d = 0;
    let cur = r;
    while (cur.parentId && byId.has(cur.parentId) && d < 8) { cur = byId.get(cur.parentId)!; d += 1; }
    return d;
  };

  const physical = rows.filter((r) => !r.isSystem);
  const system = rows.filter((r) => r.isSystem);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Locations"
        description="Warehouse, room, rack, bin and department floors, plus the virtual counter-accounts that make the ledger balance to zero."
        actions={
          can('admin.manage_locations') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New location
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader title="Physical and production locations" description={`${physical.length} locations`} />
        <div className="scroll-x">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-1.5 text-left font-semibold">Code</th>
                <th className="px-3 py-1.5 text-left font-semibold">Name</th>
                <th className="px-3 py-1.5 text-left font-semibold">Kind</th>
                <th className="px-3 py-1.5 text-left font-semibold">Tier</th>
                <th className="px-3 py-1.5 text-right font-semibold">Balance rows</th>
                <th className="px-3 py-1.5 text-right font-semibold">On hand</th>
                <th className="px-3 py-1.5 text-left font-semibold">Issuable</th>
                <th className="px-3 py-1.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {physical.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + depth(l) * 14}px` }}>
                    <CodeCell>{l.code}</CodeCell>
                  </td>
                  <td className="px-3 py-1.5">{l.name}</td>
                  <td className="px-3 py-1.5"><StatusBadge status={l.kind} /></td>
                  <td className="px-3 py-1.5 text-ink-muted">{l.storageLevel ? humanise(l.storageLevel) : '-'}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-muted">{l._count.balances}</td>
                  <td className="num px-3 py-1.5 text-right">{fmtQty(l.totalOnHandQty)}</td>
                  <td className="px-3 py-1.5">
                    {l.kind === 'PHYSICAL' && !l.blocksIssue ? (
                      <Badge tone="ok">yes</Badge>
                    ) : (
                      <Badge tone="neutral">no</Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5"><StatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="System counter-accounts"
          description="Virtual locations that make every movement double-entry. They cannot be recoded or deactivated."
          actions={
            <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
              Show
            </label>
          }
        />
        {system.length === 0 ? (
          <CardBody className="text-[12.5px] text-ink-muted">Hidden.</CardBody>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-1.5 text-left font-semibold">Code</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Name</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Kind</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Signed balance</th>
                </tr>
              </thead>
              <tbody>
                {system.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Lock className="size-3 text-ink-subtle" />
                        <CodeCell>{l.code}</CodeCell>
                      </span>
                    </td>
                    <td className="px-3 py-1.5">{l.name}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={l.kind} /></td>
                    <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(l.totalOnHandQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating ? <LocationDialog open={creating} onOpenChange={setCreating} parents={physical} onSaved={() => void refetch()} /> : null}
    </div>
  );
}

function LocationDialog({
  open, onOpenChange, parents, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  parents: LocationRow[]; onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    code: '', name: '', kind: 'PHYSICAL', storageLevel: 'RACK', parentId: '', blocksIssue: false,
  });
  const [error, setError] = React.useState<unknown>(null);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const parsed = createLocationRequest.parse({
        code: form.code,
        name: form.name,
        kind: form.kind,
        storageLevel: form.storageLevel || null,
        parentId: form.parentId || null,
        blocksIssue: form.blocksIssue,
      });
      return api.post('/locations', parsed);
    },
    onSuccess: () => {
      toast.success(`Location ${form.code} created`);
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      onSaved();
      onOpenChange(false);
    },
    onError: setError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New stock location"
        description="PHYSICAL locations hold uncommitted stock. PRODUCTION_FLOOR holds stock already issued to an order, so it is owned but not available to a new one."
        footer={
          <>
            <DialogClose asChild><Button variant="default">Cancel</Button></DialogClose>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>Create location</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" required>
              <Input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                className="font-mono uppercase"
                placeholder="RM-WH-FAB-R04"
              />
            </Field>
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" required>
              <NativeSelect value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                {LOCATION_KINDS.filter((k) => k !== 'SINK' && k !== 'COUNTERPARTY').map((k) => (
                  <option key={k} value={k}>{humanise(k)}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Storage tier">
              <NativeSelect value={form.storageLevel} onChange={(e) => set('storageLevel', e.target.value)}>
                {STORAGE_LEVELS.map((s) => (
                  <option key={s} value={s}>{humanise(s)}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Parent location" hint="for warehouse / room / rack / bin nesting">
            <NativeSelect value={form.parentId} onChange={(e) => set('parentId', e.target.value)}>
              <option value="">None</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-start gap-2 rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={form.blocksIssue}
              onChange={(e) => set('blocksIssue', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink">Block issues from this location</span>
              <span className="block text-[11.5px] text-ink-muted">
                Stock here will never count as available to production.
              </span>
            </span>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
