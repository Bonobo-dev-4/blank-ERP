'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, RotateCcw, ScanLine } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { fmtDate, fmtQty, humanise, newIdempotencyKey } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, ErrorPanel, Field, LoadingBlock, PageHeader,
  QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface StageOption { id: string; code: string; name: string }

interface QueueRow {
  id: string; sequence: number; status: string;
  receivedQty: string; completedQty: string; rejectedQty: string; forwardedQty: string;
  wipQty: string; availableToForwardQty: string; reworkOutstandingQty: string;
  productionStage: { id: string; code: string; name: string };
  productionBatch: {
    id: string; batchNo: string; plannedQty: string; status: string;
    manufacturingOrder: { id: string; moNo: string; dueDate: string | null; priority: string };
    manufacturingOrderItem: { size: string | null; productVariant: { sku: string } };
  };
}

const PRIORITY_TONE: Record<string, 'neutral' | 'warn' | 'danger'> = {
  LOW: 'neutral', NORMAL: 'neutral', HIGH: 'warn', URGENT: 'danger',
};

/**
 * One stage's work queue.
 *
 * Every stage screen — cutting, embroidery, stitching, washing, finishing — is
 * this component with a different stage code. They differ in what the garments
 * physically go through, not in how quantity is accounted for, and five
 * near-identical screens would drift apart within a release.
 *
 * Quantities here are bounded by what the stage actually holds. The arithmetic
 * is the server's; this only collects the numbers and shows what it refused.
 */
export function StageQueue({
  stageCode,
  title,
  description,
}: {
  stageCode: string;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [active, setActive] = React.useState<{ row: QueueRow; mode: 'OUTCOME' | 'FORWARD' | 'REWORK' } | null>(null);

  const stagesQuery = useQuery({
    queryKey: ['production-stages'],
    queryFn: () => api.get<Paginated<StageOption>>('/production/stages'),
  });
  const stages = stagesQuery.data;
  const stage = (stages?.data ?? []).find((s) => s.code === stageCode);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stage-queue', stage?.id],
    queryFn: () =>
      api.get<Paginated<QueueRow>>('/production/stage-tasks', {
        productionStageId: stage!.id,
        pageSize: 100,
      }),
    enabled: Boolean(stage),
  });

  // A failed master-data load must say so. Returning the spinner on error
  // leaves the screen loading for ever, which is the one thing a shop-floor
  // screen must never do: an operator cannot tell it apart from a slow network
  // and will stand there waiting.
  if (stagesQuery.error) {
    return (
      <div>
        <PageHeader title={title} description={description} />
        <ErrorPanel error={stagesQuery.error} onRetry={() => void stagesQuery.refetch()} />
      </div>
    );
  }
  if (stagesQuery.isLoading || !stages) {
    return (
      <div>
        <PageHeader title={title} description={description} />
        <LoadingBlock label="Loading the production stages" />
      </div>
    );
  }
  if (!stage) {
    return (
      <div>
        <PageHeader title={title} description={description} />
        <ErrorPanel
          error={new Error(
            `No production stage is configured with the code ${stageCode}. ` +
            'Stages are master data; an administrator configures them.',
          )}
        />
      </div>
    );
  }

  const rows = data?.data ?? [];
  const waiting = rows.filter((r) => Number(r.wipQty) > 0);
  const toHandOn = rows.filter((r) => Number(r.availableToForwardQty) > 0);
  const inRework = rows.filter((r) => Number(r.reworkOutstandingQty) > 0);

  // A route step exists for every batch from the moment the batch is created,
  // so "the query returned rows" is not the same as "there is work here".
  // Keying the empty state off the query would leave an operator looking at a
  // blank screen whenever every step is at zero.
  const hasWork = waiting.length + toHandOn.length + inRework.length > 0;
  const upcoming = rows.filter(
    (r) => !waiting.includes(r) && !toHandOn.includes(r) && !inRework.includes(r),
  );

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          can('production.scan') ? (
            <Button onClick={() => router.push('/scan')}>
              <ScanLine />
              Scan station
            </Button>
          ) : null
        }
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      {isLoading ? (
        <LoadingBlock label={`Loading the ${title.toLowerCase()} queue`} />
      ) : !hasWork ? (
        <Card>
          <CardBody>
            <p className="py-6 text-center text-[13px] text-ink-muted">
              Nothing to do at {title.toLowerCase()} right now. Batches arrive here once the step
              before them hands work on.
            </p>
            {upcoming.length > 0 ? (
              <p className="pb-2 text-center text-[12px] text-ink-subtle">
                {upcoming.length} batch{upcoming.length === 1 ? '' : 'es'} will pass through this stage:{' '}
                {upcoming
                  .slice(0, 6)
                  .map((r) => r.productionBatch.batchNo)
                  .join(', ')}
                {upcoming.length > 6 ? ` and ${upcoming.length - 6} more` : ''}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          <QueueSection
            heading="In hand"
            hint="Received at this stage and not yet completed, rejected or sent to rework."
            rows={waiting}
            onAct={(row) => setActive({ row, mode: 'OUTCOME' })}
            actionLabel="Record"
            quantityOf={(r) => r.wipQty}
            canAct={can('production.record_stage')}
          />
          <QueueSection
            heading="Ready to hand on"
            hint="Completed here and waiting to move to the next step."
            rows={toHandOn}
            onAct={(row) => setActive({ row, mode: 'FORWARD' })}
            actionLabel="Hand on"
            quantityOf={(r) => r.availableToForwardQty}
            canAct={can('production.record_stage')}
            tone="ok"
          />
          <QueueSection
            heading="Out in rework"
            hint="Still counted against the batch. Returning them puts them back in hand here."
            rows={inRework}
            onAct={(row) => setActive({ row, mode: 'REWORK' })}
            actionLabel="Return"
            quantityOf={(r) => r.reworkOutstandingQty}
            canAct={can('production.record_stage')}
            tone="warn"
          />
        </div>
      )}

      {active ? (
        <StageActionDialog
          row={active.row}
          mode={active.mode}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            void queryClient.invalidateQueries();
          }}
        />
      ) : null}
    </div>
  );
}

function QueueSection({
  heading,
  hint,
  rows,
  onAct,
  actionLabel,
  quantityOf,
  canAct,
  tone,
}: {
  heading: string;
  hint: string;
  rows: QueueRow[];
  onAct: (row: QueueRow) => void;
  actionLabel: string;
  quantityOf: (row: QueueRow) => string;
  canAct: boolean;
  tone?: 'ok' | 'warn';
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 className="text-[13.5px] font-semibold text-ink">{heading}</h2>
        <span className="num text-[12px] text-ink-muted">{rows.length}</span>
        <span className="text-[12px] text-ink-subtle">{hint}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.id}
            className={
              'rounded-lg border bg-surface px-3 py-2.5 ' +
              (tone === 'ok' ? 'border-ok/40' : tone === 'warn' ? 'border-warn/40' : 'border-line')
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CodeCell>{r.productionBatch.batchNo}</CodeCell>
                <p className="truncate text-[12px] text-ink-muted">
                  {r.productionBatch.manufacturingOrder.moNo} ·{' '}
                  {r.productionBatch.manufacturingOrderItem.productVariant.sku} ·{' '}
                  {r.productionBatch.manufacturingOrderItem.size ?? '—'}
                </p>
              </div>
              <Badge tone={PRIORITY_TONE[r.productionBatch.manufacturingOrder.priority] ?? 'neutral'}>
                {humanise(r.productionBatch.manufacturingOrder.priority)}
              </Badge>
            </div>

            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <p className="num text-[24px] font-semibold leading-none text-ink">
                  {fmtQty(quantityOf(r), 0)}
                </p>
                <p className="text-[12px] text-ink-subtle">
                  of {fmtQty(r.productionBatch.plannedQty, 0)} in the batch
                </p>
              </div>
              {canAct ? (
                <Button variant="primary" onClick={() => onAct(r)}>
                  {actionLabel}
                </Button>
              ) : null}
            </div>

            {r.productionBatch.manufacturingOrder.dueDate ? (
              <p className="mt-1.5 text-[12px] text-ink-subtle">
                due {fmtDate(r.productionBatch.manufacturingOrder.dueDate)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StageActionDialog({
  row,
  mode,
  onClose,
  onDone,
}: {
  row: QueueRow;
  mode: 'OUTCOME' | 'FORWARD' | 'REWORK';
  onClose: () => void;
  onDone: () => void;
}) {
  const max =
    mode === 'OUTCOME' ? row.wipQty : mode === 'FORWARD' ? row.availableToForwardQty : row.reworkOutstandingQty;

  const [good, setGood] = React.useState(max);
  const [rejected, setRejected] = React.useState('');
  const [reason, setReason] = React.useState('');

  const act = useMutation({
    mutationFn: () => {
      const idempotencyKey = newIdempotencyKey();
      if (mode === 'FORWARD') {
        return api.post(`/production/stage-tasks/${row.id}/forward`, { idempotencyKey, forwardQty: good });
      }
      if (mode === 'REWORK') {
        return api.post(`/production/stage-tasks/${row.id}/rework/return`, { idempotencyKey, returnQty: good });
      }
      return api.post(`/production/stage-tasks/${row.id}/outcome`, {
        idempotencyKey,
        completedQty: good || '0',
        rejectedQty: rejected || '0',
        rejectionReason: Number(rejected) > 0 ? reason : null,
      });
    },
    onSuccess: () => {
      toast.success(
        mode === 'FORWARD' ? 'Handed on to the next step'
        : mode === 'REWORK' ? 'Returned from rework'
        : 'Recorded',
      );
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const total = Number(good || 0) + (mode === 'OUTCOME' ? Number(rejected || 0) : 0);
  const over = total > Number(max);
  const needsReason = mode === 'OUTCOME' && Number(rejected) > 0 && reason.trim().length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          mode === 'FORWARD' ? `Hand ${row.productionBatch.batchNo} on`
          : mode === 'REWORK' ? `Return ${row.productionBatch.batchNo} from rework`
          : `Record ${row.productionStage.name} for ${row.productionBatch.batchNo}`
        }
        footer={
          <>
            <Button onClick={onClose} disabled={act.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={total <= 0 || over || needsReason}
              loading={act.isPending}
              onClick={() => act.mutate()}
            >
              {mode === 'FORWARD' ? 'Hand on' : mode === 'REWORK' ? 'Return' : 'Record'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {act.error ? <ErrorPanel error={act.error} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={mode === 'OUTCOME' ? 'Good pieces' : 'Quantity'}
              hint={`At most ${fmtQty(max, 0)}`}
            >
              <QtyInput value={good} onChange={(e) => setGood(e.target.value)} className="h-11 text-[16px]" />
            </Field>

            {mode === 'OUTCOME' ? (
              <Field label="Rejected pieces">
                <QtyInput
                  value={rejected}
                  onChange={(e) => setRejected(e.target.value)}
                  placeholder="0"
                  className="h-11 text-[16px]"
                />
              </Field>
            ) : null}
          </div>

          {mode === 'OUTCOME' && Number(rejected) > 0 ? (
            <Field label="Why were they rejected?" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </Field>
          ) : null}

          {over ? (
            <p className="text-[12.5px] text-danger">
              That is more than the {fmtQty(max, 0)} pieces available here.
            </p>
          ) : null}

          <p className="rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            {mode === 'FORWARD' ? (
              <>
                <ArrowRight className="mr-1 inline size-3.5" />
                The next step can only receive what this one accepted and has not already handed on.
              </>
            ) : mode === 'REWORK' ? (
              <>
                <RotateCcw className="mr-1 inline size-3.5" />
                Returned garments come back into this stage and must be completed again. They were never
                counted as leaving, so a garment reworked twice is still one garment.
              </>
            ) : (
              'Bounded by what this stage is holding, so a second identical submission is refused rather than doubling the numbers.'
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
