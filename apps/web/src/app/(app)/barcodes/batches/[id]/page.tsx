'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty, humanise, newIdempotencyKey } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, Field, LoadingBlock,
  PageHeader, QtyInput, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface StageTask {
  id: string; sequence: number; status: string;
  receivedQty: string; completedQty: string; rejectedQty: string; forwardedQty: string;
  reworkSentQty: string; reworkReturnedQty: string;
  wipQty: string; availableToForwardQty: string; reworkOutstandingQty: string;
  startedAt: string | null; completedAt: string | null;
  productionStage: { id: string; code: string; name: string; requiresQc: boolean; consumesMaterial: boolean };
}

interface Movement {
  id: string; movementType: string; qty: string; occurredAt: string; remarks: string | null;
  fromStageTask: { id: string; sequence: number; productionStage: { code: string; name: string } } | null;
  toStageTask: { id: string; sequence: number; productionStage: { code: string; name: string } } | null;
}

interface BatchDetail {
  id: string; batchNo: string; status: string; trackingMode: string;
  plannedQty: string; startedAt: string | null; completedAt: string | null; splitReason: string | null;
  route: { id: string; code: string; name: string } | null;
  manufacturingOrder: { id: string; moNo: string; status: string };
  manufacturingOrderItem: { size: string | null; color: string | null; productVariant: { sku: string } };
  stageTasks: StageTask[];
  movements: Movement[];
  barcode: { id: string; code: string; kind: string } | null;
  parentBatch: { id: string; batchNo: string } | null;
  childBatches: { id: string; batchNo: string; plannedQty: string; status: string }[];
  progress: {
    plannedQty: string; releasedQty: string; finishedQty: string; rejectedQty: string;
    inProgressQty: string; reworkOutstandingQty: string; completionPct: string;
    currentStageCode: string | null;
  };
}

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [releasing, setReleasing] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['production-batch', id],
    queryFn: () => api.get<BatchDetail>(`/production/batches/${id}`),
  });

  if (isLoading) return <LoadingBlock label="Loading batch" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return <ErrorPanel error={new Error('Batch not found')} />;

  const notYetReleased = Number(data.progress.releasedQty) < Number(data.progress.plannedQty);

  return (
    <div>
      <Button onClick={() => router.push('/barcodes/batches')} className="mb-3">
        <ArrowLeft />
        All batches
      </Button>

      <PageHeader
        title={data.batchNo}
        description={`${data.manufacturingOrder.moNo} · ${data.manufacturingOrderItem.productVariant.sku} · size ${
          data.manufacturingOrderItem.size ?? '—'
        } · ${data.route?.name ?? 'no route'}`}
        actions={
          can('production.record_stage') && notYetReleased ? (
            <Button variant="primary" onClick={() => setReleasing(true)}>
              <PlayCircle />
              Release into route
            </Button>
          ) : null
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Status" value={<StatusBadge status={data.status} />} />
        <Stat label="Planned" value={fmtQty(data.progress.plannedQty, 0)} hint="garments" />
        <Stat label="Released" value={fmtQty(data.progress.releasedQty, 0)} hint="into the route" />
        <Stat
          label="In progress"
          value={fmtQty(data.progress.inProgressQty, 0)}
          hint={data.progress.currentStageCode ?? undefined}
          tone="warn"
        />
        <Stat label="Finished" value={fmtQty(data.progress.finishedQty, 0)} tone="ok" hint="passed the last step" />
        <Stat label="Rejected" value={fmtQty(data.progress.rejectedQty, 0)} tone={Number(data.progress.rejectedQty) > 0 ? 'danger' : 'default'} />
      </div>

      {Number(data.progress.reworkOutstandingQty) > 0 ? (
        <div className="mb-3 rounded border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px]">
          <strong className="text-ink">{fmtQty(data.progress.reworkOutstandingQty, 0)} garments are out in rework.</strong>{' '}
          <span className="text-ink-muted">
            They are still counted against this batch — a garment reworked twice is still one garment.
          </span>
        </div>
      ) : null}

      {/* ---- the route ---- */}
      <Card className="mb-3">
        <CardHeader
          title="Route"
          description="Each step reports its own position. These numbers are never added together: the batch total comes from the route's endpoints."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Stage</th>
                  <th className="px-2 py-2 text-right font-medium">Received</th>
                  <th className="px-2 py-2 text-right font-medium" title="Received, not yet completed, rejected or in rework">
                    In hand
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Completed</th>
                  <th className="px-2 py-2 text-right font-medium">Rejected</th>
                  <th className="px-2 py-2 text-right font-medium">In rework</th>
                  <th className="px-2 py-2 text-right font-medium">Forwarded</th>
                  <th className="px-2 py-2 text-right font-medium" title="Completed here but not yet handed on">
                    To hand on
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.stageTasks.map((t) => {
                  const isHere = t.productionStage.code === data.progress.currentStageCode;
                  return (
                    <tr
                      key={t.id}
                      className={'border-b border-line last:border-0 ' + (isHere ? 'bg-brand-soft/40' : '')}
                    >
                      <td className="px-3 py-2 text-ink-subtle">{t.sequence}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-ink">{t.productionStage.name}</span>
                          {t.productionStage.requiresQc ? <Badge tone="info">QC</Badge> : null}
                          {t.productionStage.consumesMaterial ? <Badge tone="neutral">consumes</Badge> : null}
                        </div>
                        <CodeCell>{t.productionStage.code}</CodeCell>
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQty(t.receivedQty, 0)}</td>
                      <td className="px-2 py-2 text-right num font-semibold">
                        {Number(t.wipQty) > 0 ? fmtQty(t.wipQty, 0) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQty(t.completedQty, 0)}</td>
                      <td className="px-2 py-2 text-right num">
                        {Number(t.rejectedQty) > 0
                          ? <span className="text-danger">{fmtQty(t.rejectedQty, 0)}</span>
                          : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right num">
                        {Number(t.reworkOutstandingQty) > 0
                          ? <span className="text-warn">{fmtQty(t.reworkOutstandingQty, 0)}</span>
                          : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right num text-ink-muted">{fmtQty(t.forwardedQty, 0)}</td>
                      <td className="px-2 py-2 text-right num">
                        {Number(t.availableToForwardQty) > 0
                          ? <span className="font-medium">{fmtQty(t.availableToForwardQty, 0)}</span>
                          : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---- movements ---- */}
        <Card>
          <CardHeader
            title="Movement history"
            description="Append-only. Every quantity change on this batch, with who and when."
          />
          <CardBody className="max-h-[420px] overflow-y-auto">
            {data.movements.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-muted">
                Nothing has moved yet. Release the batch into its route to start.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {data.movements.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 rounded border border-line px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-ink">
                        {humanise(m.movementType)}
                        <span className="ml-1.5 num font-semibold">{fmtQty(m.qty, 0)}</span>
                      </p>
                      <p className="text-[11.5px] text-ink-muted">
                        {m.fromStageTask?.productionStage.name ?? 'start'}
                        {m.toStageTask ? ` → ${m.toStageTask.productionStage.name}` : ''}
                      </p>
                      {m.remarks ? <p className="text-[11px] text-ink-subtle">{m.remarks}</p> : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-subtle">{fmtDateTime(m.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>

        {/* ---- the record ---- */}
        <Card>
          <CardHeader title="Batch record" />
          <CardBody>
            <DescList
              columns={1}
              items={[
                {
                  label: 'Manufacturing order',
                  value: (
                    <Link
                      href={`/manufacturing/${data.manufacturingOrder.id}`}
                      className="text-brand-strong hover:underline"
                    >
                      {data.manufacturingOrder.moNo}
                    </Link>
                  ),
                },
                { label: 'Barcode', value: data.barcode ? <CodeCell>{data.barcode.code}</CodeCell> : '—' },
                { label: 'Tracking', value: humanise(data.trackingMode) },
                { label: 'Route', value: data.route?.name ?? '—' },
                { label: 'Started', value: data.startedAt ? fmtDateTime(data.startedAt) : '—' },
                { label: 'Completed', value: data.completedAt ? fmtDateTime(data.completedAt) : '—' },
                ...(data.parentBatch
                  ? [{
                      label: 'Split from',
                      value: (
                        <Link
                          href={`/barcodes/batches/${data.parentBatch.id}`}
                          className="text-brand-strong hover:underline"
                        >
                          {data.parentBatch.batchNo}
                        </Link>
                      ),
                    }]
                  : []),
                ...(data.splitReason ? [{ label: 'Split reason', value: data.splitReason }] : []),
                ...(data.childBatches.length > 0
                  ? [{
                      label: 'Split into',
                      value: (
                        <span className="flex flex-wrap gap-1">
                          {data.childBatches.map((c) => (
                            <Link
                              key={c.id}
                              href={`/barcodes/batches/${c.id}`}
                              className="text-brand-strong hover:underline"
                            >
                              {c.batchNo}
                            </Link>
                          ))}
                        </span>
                      ),
                    }]
                  : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <ReleaseIntoRouteDialog
        open={releasing}
        onOpenChange={setReleasing}
        batchId={id}
        maxQty={String(Number(data.progress.plannedQty) - Number(data.progress.releasedQty))}
        firstStage={data.stageTasks[0]?.productionStage.name ?? 'the first step'}
        onDone={() => void queryClient.invalidateQueries()}
      />
    </div>
  );
}

function ReleaseIntoRouteDialog({
  open,
  onOpenChange,
  batchId,
  maxQty,
  firstStage,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  maxQty: string;
  firstStage: string;
  onDone: () => void;
}) {
  const [quantity, setQuantity] = React.useState(maxQty);
  React.useEffect(() => {
    if (open) setQuantity(maxQty);
  }, [open, maxQty]);

  const release = useMutation({
    mutationFn: () =>
      api.post(`/production/batches/${batchId}/release`, {
        idempotencyKey: newIdempotencyKey(),
        releaseQty: quantity,
      }),
    onSuccess: () => {
      toast.success(`Released into ${firstStage}`);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Release into the route"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={release.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={Number(quantity) <= 0 || Number(quantity) > Number(maxQty)}
              loading={release.isPending}
              onClick={() => release.mutate()}
            >
              Release
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink">
            The quantity enters <strong>{firstStage}</strong>, the first step of the route. From there it
            moves one step at a time, and each step is bounded by what the one before it accepted.
          </p>
          <Field label="Quantity" hint={`At most ${fmtQty(maxQty, 0)}`}>
            <QtyInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
