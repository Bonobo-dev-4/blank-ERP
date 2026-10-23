'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, CloudOff, Loader2, RotateCw, ScanLine, TriangleAlert, X,
} from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { fmtQty, fmtRelative, humanise } from '@/lib/utils';
import { scanQueue, useScanQueue, type QueuedScan } from '@/lib/scan-queue';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, NativeSelect,
  QtyInput, Textarea,
} from '@/components/ui/primitives';
import { useAuth } from '@/components/app/auth-context';

interface StageOption { id: string; code: string; name: string }

interface ScanAction { action: string; stageTaskId: string; maxQty: string; label: string }

interface Resolution {
  code: string;
  found: boolean;
  kind: string | null;
  message: string | null;
  currentStageTaskId: string | null;
  currentStageCode: string | null;
  actions: ScanAction[];
  batch?: {
    id: string; batchNo: string; status: string;
    manufacturingOrder: { moNo: string };
    manufacturingOrderItem: { size: string | null; productVariant: { sku: string } };
    progress: {
      plannedQty: string; releasedQty: string; finishedQty: string;
      rejectedQty: string; inProgressQty: string; completionPct: string;
      currentStageCode: string | null;
      stages: { stageTaskId: string; sequence: number; stageCode: string | null;
        receivedQty: string; completedQty: string; rejectedQty: string; wipQty: string }[];
    };
  };
}

/**
 * The scan station.
 *
 * The screen with the most users, the worst devices and the least forgiving
 * network. Two rules from decisions.md §27 shape everything here:
 *
 *  - A scan is PENDING until the server confirms it. The operator is never
 *    told "done" for something that has not landed.
 *  - The quantities on screen come from the server, never from the queue. A
 *    queued scan does not move a number until it is confirmed.
 */
export default function ScanStationPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [stageId, setStageId] = React.useState('');
  const [code, setCode] = React.useState('');
  const [resolution, setResolution] = React.useState<Resolution | null>(null);
  const [action, setAction] = React.useState<ScanAction | null>(null);
  const [quantity, setQuantity] = React.useState('');
  const [rejectedQty, setRejectedQty] = React.useState('');
  const [reason, setReason] = React.useState('');

  const { scans, pendingCount, rejectedCount, online } = useScanQueue();

  const { data: stages } = useQuery({
    queryKey: ['production-stages'],
    queryFn: () => api.get<Paginated<StageOption>>('/production/stages'),
    retry: false,
  });

  // Remember the station between shifts: an operator should not pick their own
  // stage from a list every time they walk up to the terminal.
  React.useEffect(() => {
    const saved = localStorage.getItem('dnd.scanStation.stageId');
    if (saved) setStageId(saved);
  }, []);
  React.useEffect(() => {
    if (stageId) localStorage.setItem('dnd.scanStation.stageId', stageId);
  }, [stageId]);

  const resolve = useMutation({
    mutationFn: (scanned: string) =>
      api.post<Resolution>('/production/scan/resolve', {
        code: scanned,
        productionStageId: stageId || null,
      }),
    onSuccess: (res) => {
      setResolution(res);
      // One obvious action means no menu: the operator scanned, the system
      // knows what happens next.
      setAction(res.actions.length === 1 ? res.actions[0] : null);
      setQuantity(res.actions.length === 1 ? res.actions[0].maxQty : '');
      setRejectedQty('');
      setReason('');
    },
  });

  const submit = () => {
    if (!resolution?.batch || !action) return;

    const eventType =
      action.action === 'FORWARD' ? 'STAGE_RECEIVE'
      : action.action === 'SEND_TO_REWORK' ? 'REWORK_SEND'
      : action.action === 'RETURN_FROM_REWORK' ? 'REWORK_RETURN'
      : 'STAGE_COMPLETE';

    // For a forward, the quantity lands on the NEXT step, which the server
    // resolves from the step being forwarded out of.
    const targetTaskId =
      action.action === 'FORWARD'
        ? nextStageTaskId(resolution, action.stageTaskId)
        : action.stageTaskId;

    scanQueue.enqueue({
      code: resolution.code,
      eventType,
      stageTaskId: targetTaskId,
      completedQty:
        eventType === 'STAGE_COMPLETE' ? (quantity || '0')
        : eventType === 'STAGE_RECEIVE' ? (quantity || '0')
        : eventType === 'REWORK_RETURN' ? (quantity || '0')
        : undefined,
      rejectedQty: eventType === 'STAGE_COMPLETE' ? (rejectedQty || '0') : undefined,
      reworkQty: eventType === 'REWORK_SEND' ? (quantity || '0') : undefined,
      rejectionReason: Number(rejectedQty) > 0 ? reason : null,
      label: `${resolution.batch.batchNo} · ${action.label}`,
    });

    // Clear for the next garment bundle, and re-read the server's figures.
    setResolution(null);
    setAction(null);
    setCode('');
    setQuantity('');
    setRejectedQty('');
    setReason('');
    void queryClient.invalidateQueries();
    inputRef.current?.focus();
  };

  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed) resolve.mutate(trimmed);
  };

  if (!can('production.scan')) {
    return <ErrorPanel error={new Error('You do not have permission to use the scan station')} />;
  }

  const needsReason = Number(rejectedQty) > 0 && reason.trim().length === 0;
  const overMax = action ? Number(quantity) + Number(rejectedQty || 0) > Number(action.maxQty) : false;
  const canSubmit = Boolean(action) && Number(quantity || 0) + Number(rejectedQty || 0) > 0 && !needsReason && !overMax;

  return (
    <div className="mx-auto max-w-4xl">
      {/* ---- station bar ---- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScanLine className="size-5 text-brand-strong" />
          <h1 className="text-[16px] font-semibold text-ink">Scan Station</h1>
          <NativeSelect
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="w-auto"
            aria-label="Your stage"
          >
            <option value="">Any stage</option>
            {(stages?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </NativeSelect>
        </div>

        <QueueIndicator online={online} pendingCount={pendingCount} rejectedCount={rejectedCount} />
      </div>

      {/* ---- the scan box ---- */}
      <Card className="mb-3">
        <CardBody>
          <form onSubmit={onScan} className="flex gap-2">
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type a batch barcode"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label="Barcode"
              className="h-14 flex-1 rounded border border-line-strong bg-surface px-4 font-mono text-[18px] tracking-wide text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <Button type="submit" variant="primary" size="lg" loading={resolve.isPending}>
              Look up
            </Button>
          </form>

          {resolve.error ? <ErrorPanel error={resolve.error} className="mt-3" /> : null}

          {resolution && !resolution.found ? (
            <div className="mt-3 flex items-center gap-2 rounded border border-danger/40 bg-danger-soft px-3 py-2.5 text-[13px]">
              <TriangleAlert className="size-4 shrink-0 text-danger" />
              <span>
                <strong className="font-mono">{resolution.code}</strong> is not known to this system.
              </span>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ---- what was scanned ---- */}
      {resolution?.batch ? (
        <Card className="mb-3">
          <CardHeader
            title={resolution.batch.batchNo}
            description={`${resolution.batch.manufacturingOrder.moNo} · ${
              resolution.batch.manufacturingOrderItem.productVariant.sku
            } · size ${resolution.batch.manufacturingOrderItem.size ?? '—'}`}
            actions={<Badge tone="info">{humanise(resolution.batch.status)}</Badge>}
          />
          <CardBody>
            {/* Server figures. A queued scan has not moved any of these. */}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Planned', resolution.batch.progress.plannedQty],
                ['In progress', resolution.batch.progress.inProgressQty],
                ['Finished', resolution.batch.progress.finishedQty],
                ['Rejected', resolution.batch.progress.rejectedQty],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-line px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</p>
                  <p className="num text-[20px] font-semibold text-ink">{fmtQty(value, 0)}</p>
                </div>
              ))}
            </div>

            <RouteStrip stages={resolution.batch.progress.stages} currentCode={resolution.currentStageCode} />

            {resolution.actions.length === 0 ? (
              <p className="mt-3 rounded border border-line bg-surface-muted px-3 py-2.5 text-[13px] text-ink-muted">
                {resolution.message ?? 'There is nothing to do with this batch at your stage right now.'}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {resolution.actions.map((a) => (
                    <Button
                      key={a.action}
                      variant={action?.action === a.action ? 'primary' : 'default'}
                      size="lg"
                      onClick={() => {
                        setAction(a);
                        setQuantity(a.maxQty);
                        setRejectedQty('');
                      }}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>

                {action ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={action.action === 'STAGE_COMPLETE' || action.action === 'RECORD_OUTCOME'
                        ? 'Good pieces'
                        : 'Quantity'}
                      hint={`At most ${fmtQty(action.maxQty, 0)}`}
                    >
                      <QtyInput
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="h-12 text-[18px]"
                      />
                    </Field>

                    {action.action === 'RECORD_OUTCOME' ? (
                      <Field label="Rejected pieces">
                        <QtyInput
                          value={rejectedQty}
                          onChange={(e) => setRejectedQty(e.target.value)}
                          className="h-12 text-[18px]"
                          placeholder="0"
                        />
                      </Field>
                    ) : null}

                    {Number(rejectedQty) > 0 ? (
                      <Field label="Why were they rejected?" required className="sm:col-span-2">
                        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                      </Field>
                    ) : null}

                    {overMax ? (
                      <p className="text-[12.5px] text-danger sm:col-span-2">
                        That is more than the {fmtQty(action.maxQty, 0)} pieces this stage is holding.
                      </p>
                    ) : null}

                    <div className="sm:col-span-2">
                      <Button
                        variant="primary"
                        size="lg"
                        className="w-full"
                        disabled={!canSubmit}
                        onClick={submit}
                      >
                        Record scan
                      </Button>
                      <p className="mt-1.5 text-center text-[11.5px] text-ink-muted">
                        Queued on this device and sent as soon as the server is reachable. It is only
                        counted once confirmed.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---- the queue ---- */}
      <ScanQueuePanel scans={scans} />
    </div>
  );
}

function nextStageTaskId(resolution: Resolution, fromTaskId: string): string | null {
  const stages = resolution.batch?.progress.stages ?? [];
  const from = stages.find((s) => s.stageTaskId === fromTaskId);
  if (!from) return null;
  return stages.find((s) => s.sequence === from.sequence + 1)?.stageTaskId ?? null;
}

function QueueIndicator({
  online,
  pendingCount,
  rejectedCount,
}: {
  online: boolean;
  pendingCount: number;
  rejectedCount: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {!online ? (
        <span className="flex items-center gap-1.5 rounded border border-warn/40 bg-warn-soft px-2 py-1 text-[12px] font-medium text-warn">
          <CloudOff className="size-3.5" />
          Offline — scans are being held
        </span>
      ) : null}
      {pendingCount > 0 ? (
        <span className="flex items-center gap-1.5 rounded border border-line bg-surface-muted px-2 py-1 text-[12px] font-medium text-ink">
          <Loader2 className="size-3.5 animate-spin" />
          {pendingCount} waiting
        </span>
      ) : null}
      {rejectedCount > 0 ? (
        <span className="flex items-center gap-1.5 rounded border border-danger/40 bg-danger-soft px-2 py-1 text-[12px] font-medium text-danger">
          <TriangleAlert className="size-3.5" />
          {rejectedCount} refused
        </span>
      ) : null}
      {online && pendingCount === 0 && rejectedCount === 0 ? (
        <span className="flex items-center gap-1.5 rounded border border-ok/40 bg-ok-soft px-2 py-1 text-[12px] font-medium text-ok">
          <CheckCircle2 className="size-3.5" />
          All scans sent
        </span>
      ) : null}
    </div>
  );
}

/** Where the batch is on its route, at a glance. */
function RouteStrip({
  stages,
  currentCode,
}: {
  stages: { stageTaskId: string; sequence: number; stageCode: string | null; wipQty: string; completedQty: string }[];
  currentCode: string | null;
}) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
      {stages.map((s) => {
        const isHere = s.stageCode === currentCode;
        const wip = Number(s.wipQty);
        const done = Number(s.completedQty);
        return (
          <div
            key={s.stageTaskId}
            className={
              'min-w-[84px] flex-1 rounded border px-2 py-1.5 text-center ' +
              (isHere
                ? 'border-brand bg-brand-soft'
                : wip > 0
                  ? 'border-warn/40 bg-warn-soft'
                  : done > 0
                    ? 'border-ok/40 bg-ok-soft'
                    : 'border-line bg-surface')
            }
          >
            <p className="truncate text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">
              {s.stageCode ?? `#${s.sequence}`}
            </p>
            <p className="num text-[15px] font-semibold text-ink">{fmtQty(wip > 0 ? s.wipQty : s.completedQty, 0)}</p>
            <p className="text-[10px] text-ink-muted">{wip > 0 ? 'in hand' : 'done'}</p>
          </div>
        );
      })}
    </div>
  );
}

function ScanQueuePanel({ scans }: { scans: QueuedScan[] }) {
  const pending = scans.filter((s) => s.state === 'PENDING' || s.state === 'SENDING');
  const rejected = scans.filter((s) => s.state === 'REJECTED');
  const confirmed = scans.filter((s) => s.state === 'CONFIRMED').slice(0, 10);

  if (scans.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="This device"
        description="A scan is only counted once the server confirms it. Nothing here is lost if the network drops."
        actions={
          confirmed.length > 0 ? (
            <Button onClick={() => scanQueue.clearConfirmed()}>Clear confirmed</Button>
          ) : null
        }
      />
      <CardBody className="space-y-1.5">
        {rejected.map((s) => (
          <div
            key={s.idempotencyKey}
            className="flex items-start gap-2 rounded border border-danger/40 bg-danger-soft px-2.5 py-2 text-[12.5px]"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{s.label}</p>
              {/* The server's own words, so the operator can act on them. */}
              <p className="text-ink-muted">{s.error}</p>
              <p className="text-[11px] text-ink-subtle">{fmtRelative(s.scannedAt)}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button onClick={() => scanQueue.retry(s.idempotencyKey)} aria-label="Retry">
                <RotateCw />
              </Button>
              <Button onClick={() => scanQueue.dismiss(s.idempotencyKey)} aria-label="Dismiss">
                <X />
              </Button>
            </div>
          </div>
        ))}

        {pending.map((s) => (
          <div
            key={s.idempotencyKey}
            className="flex items-center gap-2 rounded border border-line bg-surface-muted px-2.5 py-2 text-[12.5px]"
          >
            <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
            <Badge tone="warn">waiting</Badge>
            <span className="text-[11px] text-ink-subtle">{fmtRelative(s.scannedAt)}</span>
          </div>
        ))}

        {confirmed.map((s) => (
          <div
            key={s.idempotencyKey}
            className="flex items-center gap-2 rounded border border-line px-2.5 py-2 text-[12.5px]"
          >
            <CheckCircle2 className="size-4 shrink-0 text-ok" />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{s.label}</span>
            <Badge tone="ok">confirmed</Badge>
            <span className="text-[11px] text-ink-subtle">{fmtRelative(s.scannedAt)}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
