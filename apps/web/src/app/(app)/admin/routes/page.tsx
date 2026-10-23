'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, Plus, Route as RouteIcon, Trash2 } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, LoadingBlock,
  NativeSelect, PageHeader, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface Stage {
  id: string; code: string; name: string; sequenceHint: number;
  consumesMaterial: boolean; allowsJobWork: boolean; requiresQc: boolean;
  defaultLocation: { id: string; code: string; name: string } | null;
}

interface RouteStep {
  id: string; sequence: number; isOptional: boolean;
  standardMinutes: string | null; slaHours: string | null;
  productionStage: { id: string; code: string; name: string };
}

interface ProductionRoute {
  id: string; code: string; name: string; description: string | null;
  isDefault: boolean; status: string; steps: RouteStep[];
}

/**
 * Production routes.
 *
 * A route is an ordered list of stages, and the order is its entire meaning —
 * the stage ledger moves quantity by sequence. Batches already part-way
 * through keep the steps they were created with, so editing a route here
 * cannot reorder work that is on the floor.
 */
export default function RoutesAdminPage() {
  const { can } = useAuth();
  const [editing, setEditing] = React.useState<ProductionRoute | 'new' | null>(null);

  const stages = useQuery({
    queryKey: ['production-stages'],
    queryFn: () => api.get<Paginated<Stage>>('/production/stages'),
  });
  const routes = useQuery({
    queryKey: ['production-routes'],
    queryFn: () => api.get<Paginated<ProductionRoute>>('/production/routes'),
  });

  if (stages.error) return <ErrorPanel error={stages.error} onRetry={() => void stages.refetch()} />;
  if (routes.error) return <ErrorPanel error={routes.error} onRetry={() => void routes.refetch()} />;
  if (stages.isLoading || routes.isLoading) return <LoadingBlock label="Loading routes" />;

  return (
    <div>
      <PageHeader
        title="Production Routes"
        description="A route is an ordered list of stages, and the sequence is its meaning — quantity moves one step at a time and cannot skip ahead without authorisation. Batches already part-way through keep the steps they started with."
        actions={
          can('admin.manage_routes') ? (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus />
              New route
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {(routes.data?.data ?? []).map((route) => (
            <Card key={route.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {route.name}
                    {route.isDefault ? <Badge tone="brand">default</Badge> : null}
                  </span>
                }
                description={route.description ?? undefined}
                actions={
                  <div className="flex items-center gap-2">
                    <CodeCell>{route.code}</CodeCell>
                    {can('admin.manage_routes') ? (
                      <Button onClick={() => setEditing(route)}>Edit</Button>
                    ) : null}
                  </div>
                }
              />
              <CardBody>
                <ol className="space-y-1">
                  {route.steps.map((step, i) => (
                    <li key={step.id} className="flex items-center gap-2 text-[12.5px]">
                      <span className="num w-6 shrink-0 text-right text-ink-subtle">{step.sequence}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">
                        {step.productionStage.name}
                      </span>
                      <CodeCell>{step.productionStage.code}</CodeCell>
                      {step.isOptional ? <Badge tone="neutral">optional</Badge> : null}
                      {step.standardMinutes ? (
                        <span className="text-[11px] text-ink-subtle">{step.standardMinutes} min/pc</span>
                      ) : null}
                      {i < route.steps.length - 1 ? (
                        <ArrowDown className="size-3 shrink-0 text-ink-subtle" />
                      ) : null}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ))}
          {(routes.data?.data ?? []).length === 0 ? (
            <Card>
              <CardBody>
                <p className="py-8 text-center text-[13px] text-ink-muted">
                  No routes configured. A batch cannot exist without one.
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader
            title="Stages"
            description="The steps a route can be built from."
          />
          <CardBody className="space-y-1">
            {(stages.data?.data ?? []).map((s) => (
              <div key={s.id} className="rounded border border-line px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-ink">{s.name}</span>
                  <CodeCell>{s.code}</CodeCell>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {s.consumesMaterial ? <Badge tone="neutral">consumes material</Badge> : null}
                  {s.allowsJobWork ? <Badge tone="info">job work</Badge> : null}
                  {s.requiresQc ? <Badge tone="warn">QC</Badge> : null}
                </div>
                {s.defaultLocation ? (
                  <p className="mt-0.5 text-[11px] text-ink-subtle">{s.defaultLocation.name}</p>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {editing ? (
        <RouteEditor
          route={editing === 'new' ? null : editing}
          stages={stages.data?.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RouteEditor({
  route,
  stages,
  onClose,
}: {
  route: ProductionRoute | null;
  stages: readonly Stage[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = React.useState(route?.code ?? '');
  const [name, setName] = React.useState(route?.name ?? '');
  const [description, setDescription] = React.useState(route?.description ?? '');
  const [isDefault, setIsDefault] = React.useState(route?.isDefault ?? false);
  const [steps, setSteps] = React.useState<{ key: string; productionStageId: string; isOptional: boolean }[]>(
    () =>
      route?.steps.map((s) => ({
        key: s.id,
        productionStageId: s.productionStage.id,
        isOptional: s.isOptional,
      })) ?? [],
  );

  const save = useMutation({
    mutationFn: () =>
      api.post('/production/routes', {
        code: code.toUpperCase(),
        name,
        description: description || null,
        isDefault,
        steps: steps.map((s, i) => ({
          productionStageId: s.productionStageId,
          sequence: i + 1,
          isOptional: s.isOptional,
        })),
      }),
    onSuccess: () => {
      toast.success(route ? 'Route updated' : 'Route created');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const used = new Set(steps.map((s) => s.productionStageId));
  const available = stages.filter((s) => !used.has(s.id));
  const complete = code.trim() && name.trim() && steps.length > 0 && steps.every((s) => s.productionStageId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={route ? `Edit ${route.code}` : 'New production route'}
        footer={
          <>
            <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button variant="primary" disabled={!complete} loading={save.isPending} onClick={() => save.mutate()}>
              Save route
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {save.error ? <ErrorPanel error={save.error} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" required hint={route ? 'The stable identity; changing it creates a new route' : undefined}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="STANDARD"
                className="font-mono uppercase"
                disabled={Boolean(route)}
              />
            </Field>
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard Garment" />
            </Field>
          </div>

          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>

          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Use for styles that have no route of their own
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink">Steps, in order</span>
              <NativeSelect
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  setSteps((s) => [
                    ...s,
                    { key: Math.random().toString(36).slice(2), productionStageId: e.target.value, isOptional: false },
                  ]);
                }}
                className="w-auto"
                aria-label="Add a stage"
              >
                <option value="">Add a stage…</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </div>

            {steps.length === 0 ? (
              <p className="rounded border border-line bg-surface-muted px-2.5 py-3 text-center text-[12.5px] text-ink-muted">
                A route needs at least one step.
              </p>
            ) : (
              steps.map((s, i) => {
                const stage = stages.find((x) => x.id === s.productionStageId);
                return (
                  <div key={s.key} className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5">
                    <span className="num w-6 text-right text-[12px] text-ink-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                      {stage?.name ?? 'Unknown stage'}
                    </span>
                    <label className="flex items-center gap-1 whitespace-nowrap text-[11.5px] text-ink-muted">
                      <input
                        type="checkbox"
                        checked={s.isOptional}
                        onChange={(e) =>
                          setSteps((x) => x.map((y, j) => (j === i ? { ...y, isOptional: e.target.checked } : y)))
                        }
                      />
                      optional
                    </label>
                    <Button
                      onClick={() => setSteps((x) => (i > 0 ? [...x.slice(0, i - 1), x[i], x[i - 1], ...x.slice(i + 1)] : x))}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </Button>
                    <button
                      type="button"
                      onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
                      className="text-ink-subtle transition-colors hover:text-danger"
                      aria-label="Remove step"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <p className="flex items-start gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            <RouteIcon className="mt-0.5 size-3.5 shrink-0" />
            Steps are replaced wholesale when you save. A step that is currently carrying a batch cannot
            be removed — finish or cancel those batches first.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
