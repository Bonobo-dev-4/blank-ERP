'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ban, Lock, Package2, PauseCircle, PlayCircle, Rocket, Snowflake, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, humanise, newIdempotencyKey, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, Field, LoadingBlock,
  PageHeader, QtyInput, Stat, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface SnapshotLine {
  id: string; lineNo: number; materialCode: string; materialName: string; uom: string;
  consumptionQtyPerUnit: string; wastageQtyPerUnit: string; grossQtyPerUnit: string;
  unitCost: string; plannedQty: string; plannedCost: string;
  productionStageCode: string | null; source: string;
}

interface Reservation {
  id: string; reservedQty: string; issuedQty: string; releasedQty: string; status: string;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string };
  materialLot: { id: string; lotCode: string; shade: string | null };
  location: { id: string; code: string; name: string };
}

interface MoDetail {
  id: string; moNo: string; status: string; priority: string; productionType: string;
  orderedQty: string; releasedQty: string; dueDate: string | null; plannedStartDate: string | null;
  releasedAt: string | null; remarks: string | null; cancelReason: string | null;
  shortageOverrideReason: string | null;
  plannedMaterialCost: string; plannedTotalCost: string;
  isEditable: boolean; isOverdue: boolean; hasBomSnapshot: boolean;
  product: { id: string; styleCode: string; name: string; category: string } | null;
  bomVersion: { id: string; version: number; status: string; bom: { id: string; bomCode: string } } | null;
  route: { id: string; code: string; name: string } | null;
  rollup: {
    orderedQty: string; releasedQty: string; completedQty: string; rejectedQty: string;
    inwardedQty: string; cancelledQty: string; pendingReleaseQty: string; completionPct: string;
  };
  items: { id: string; lineNo: number; size: string | null; color: string | null;
    orderedQty: string; releasedQty: string; inwardedQty: string;
    productVariant: { id: string; sku: string; size: string | null } }[];
  bomSnapshotLines: SnapshotLine[];
  reservations: Reservation[];
}

interface BatchSummary {
  id: string; batchNo: string; status: string;
  progress: {
    plannedQty: string; releasedQty: string; finishedQty: string;
    rejectedQty: string; inProgressQty: string; currentStageCode: string | null;
  };
}

interface ReadinessLine {
  rawMaterialId: string; materialCode: string; materialName: string; uom: string; isCritical: boolean;
  netRequiredQty: string; wastageQty: string; grossRequiredQty: string;
  availableQty: string; reservedElsewhereQty: string; openPurchaseQty: string;
  expectedArrivalDate: string | null; shortageQty: string; suggestedPurchaseQty: string;
  unitCost: string; estimatedCost: string; readiness: string;
}

interface Readiness {
  bomVersionId: string | null; orderedQty: string; maxProducibleQty: string;
  isClear: boolean; requiresShortageOverride: boolean;
  totalShortageValue: string; totalEstimatedCost: string;
  lines: ReadinessLine[];
}

const READINESS_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  READY: 'ok', PARTIALLY_AVAILABLE: 'warn', SHORT: 'danger', SHORT_AND_LATE: 'danger',
};

export default function ManufacturingOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [releasing, setReleasing] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mo', id],
    queryFn: () => api.get<MoDetail>(`/manufacturing/orders/${id}`),
  });

  // Only meaningful before release; afterwards the snapshot is the record.
  const readiness = useQuery({
    queryKey: ['mo-readiness', id],
    queryFn: () => api.get<Readiness>(`/manufacturing/orders/${id}/readiness`),
    enabled: Boolean(data) && data!.isEditable,
    retry: false,
  });

  // A released order with no batches is a dead end nobody notices, so it is
  // surfaced on the order itself rather than in a report (decisions.md §26).
  const batches = useQuery({
    queryKey: ['mo-batches', id],
    queryFn: () =>
      api.get<{ data: BatchSummary[] }>('/production/batches', { manufacturingOrderId: id, pageSize: 100 }),
    enabled: Boolean(data?.releasedAt),
  });

  const invalidate = () => queryClient.invalidateQueries();

  const createBatches = useMutation({
    mutationFn: () =>
      api.post<{ batches: { batchNo: string }[] }>('/production/batches', {
        manufacturingOrderId: id,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (res) => {
      toast.success(`${res.batches.length} batch(es) created`);
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const reserve = useMutation({
    mutationFn: (singleShade: boolean) =>
      api.post<{ fullyReserved: boolean; materials: { materialCode: string; shortfallQty: string }[] }>(
        `/manufacturing/orders/${id}/reserve`,
        { idempotencyKey: newIdempotencyKey(), singleShade },
      ),
    onSuccess: (res) => {
      const short = res.materials.filter((m) => Number(m.shortfallQty) > 0);
      toast.success(
        res.fullyReserved
          ? 'Every material reserved'
          : `Reserved what is available; ${short.length} material(s) still short`,
      );
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const hold = useMutation({
    mutationFn: (next: boolean) => api.post(`/manufacturing/orders/${id}/hold`, { hold: next }),
    onSuccess: (_r, next) => {
      toast.success(next ? 'Order put on hold' : 'Order resumed');
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cancel = useMutation({
    mutationFn: () => api.post<{ reservationsReleased: number }>(`/manufacturing/orders/${id}/cancel`, {
      reason: cancelReason,
    }),
    onSuccess: (res) => {
      toast.success(`Order cancelled; ${res.reservationsReleased} reservation(s) released`);
      setCancelling(false);
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <LoadingBlock label="Loading order" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return <ErrorPanel error={new Error('Order not found')} />;

  const canRelease = can('manufacturing.release') && data.isEditable;

  return (
    <div>
      <Button onClick={() => router.push('/manufacturing')} className="mb-3">
        <ArrowLeft />
        All orders
      </Button>

      <PageHeader
        title={data.moNo}
        description={`${data.product?.styleCode ?? ''} — ${data.product?.name ?? ''} · ${humanise(
          data.productionType,
        )}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can('mrp.reserve') && data.isEditable ? (
              <Button onClick={() => reserve.mutate(false)} loading={reserve.isPending}>
                <Lock />
                Reserve material
              </Button>
            ) : null}

            {canRelease ? (
              <Button variant="primary" onClick={() => setReleasing(true)}>
                <Rocket />
                Release to floor
              </Button>
            ) : null}

            {can('manufacturing.write') && ['RELEASED', 'IN_PROGRESS'].includes(data.status) ? (
              <Button onClick={() => hold.mutate(true)} loading={hold.isPending}>
                <PauseCircle />
                Hold
              </Button>
            ) : null}

            {can('manufacturing.write') && data.status === 'ON_HOLD' ? (
              <Button onClick={() => hold.mutate(false)} loading={hold.isPending}>
                <PlayCircle />
                Resume
              </Button>
            ) : null}

            {can('manufacturing.cancel') && !['CANCELLED', 'CLOSED', 'COMPLETED'].includes(data.status) ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                <Ban />
                Cancel
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Status" value={<StatusBadge status={data.status} />} />
        <Stat label="Ordered" value={fmtQty(data.rollup.orderedQty, 0)} hint="garments" />
        <Stat
          label="Released"
          value={fmtQty(data.rollup.releasedQty, 0)}
          hint={Number(data.rollup.pendingReleaseQty) > 0
            ? `${fmtQty(data.rollup.pendingReleaseQty, 0)} still to release`
            : undefined}
        />
        <Stat
          label="Due"
          value={fmtDate(data.dueDate)}
          tone={data.isOverdue ? 'danger' : 'default'}
          hint={data.isOverdue ? 'overdue' : undefined}
        />
        <Stat
          label="Planned material cost"
          value={fmtMoney(data.plannedMaterialCost)}
          hint={data.hasBomSnapshot ? 'frozen at release' : 'set at release'}
        />
      </div>

      {/* The outstanding step between release and the floor. */}
      {data.releasedAt && (batches.data?.data.length ?? 0) === 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border border-warn/40 bg-warn-soft px-3 py-2.5">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="text-[12.5px]">
              <p className="font-medium text-ink">Released, but no production batches yet.</p>
              <p className="text-ink-muted">
                Nothing can be scanned or recorded on the floor until this order has batches. A batch is a
                bundle that travels together, so its size is yours to choose.
              </p>
            </div>
          </div>
          {can('manufacturing.split') ? (
            <Button variant="primary" loading={createBatches.isPending} onClick={() => createBatches.mutate()}>
              <Package2 />
              Create batches
            </Button>
          ) : null}
        </div>
      ) : null}

      {(batches.data?.data.length ?? 0) > 0 ? (
        <Card className="mb-3">
          <CardHeader
            title="Production batches"
            description="Where this order actually is on the floor."
            actions={
              can('manufacturing.split') ? (
                <Button loading={createBatches.isPending} onClick={() => createBatches.mutate()}>
                  <Package2 />
                  Batch the rest
                </Button>
              ) : null
            }
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Batch</th>
                    <th className="px-3 py-2 text-right font-medium">Planned</th>
                    <th className="px-3 py-2 text-right font-medium">In progress</th>
                    <th className="px-3 py-2 text-right font-medium">Finished</th>
                    <th className="px-3 py-2 text-right font-medium">Rejected</th>
                    <th className="px-3 py-2 text-left font-medium">Where</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(batches.data?.data ?? []).map((b) => (
                    <tr
                      key={b.id}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-muted"
                      onClick={() => router.push(`/barcodes/batches/${b.id}`)}
                    >
                      <td className="px-3 py-1.5"><CodeCell>{b.batchNo}</CodeCell></td>
                      <td className="px-3 py-1.5 text-right num font-medium">{fmtQty(b.progress.plannedQty, 0)}</td>
                      <td className="px-3 py-1.5 text-right num">{fmtQty(b.progress.inProgressQty, 0)}</td>
                      <td className="px-3 py-1.5 text-right num text-ok">{fmtQty(b.progress.finishedQty, 0)}</td>
                      <td className="px-3 py-1.5 text-right num">
                        {Number(b.progress.rejectedQty) > 0
                          ? <span className="text-danger">{fmtQty(b.progress.rejectedQty, 0)}</span>
                          : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {b.progress.currentStageCode
                          ? <Badge tone="info">{b.progress.currentStageCode}</Badge>
                          : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-3 py-1.5"><StatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {data.shortageOverrideReason ? (
        <div className="mb-3 rounded border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px]">
          <p className="font-medium text-ink">Released despite a material shortage.</p>
          <p className="text-ink-muted">{data.shortageOverrideReason}</p>
        </div>
      ) : null}

      {data.cancelReason ? (
        <div className="mb-3 rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px]">
          <span className="font-medium text-ink">Cancelled. </span>
          <span className="text-ink-muted">{data.cancelReason}</span>
        </div>
      ) : null}

      {/* ---- size breakdown ---- */}
      <Card className="mb-3">
        <CardHeader title="Size breakdown" />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">SKU</th>
                  <th className="px-3 py-2 text-left font-medium">Size</th>
                  <th className="px-3 py-2 text-right font-medium">Ordered</th>
                  <th className="px-3 py-2 text-right font-medium">Released</th>
                  <th className="px-3 py-2 text-right font-medium">Inwarded</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5"><CodeCell>{i.productVariant.sku}</CodeCell></td>
                    <td className="px-3 py-1.5">{i.size ?? i.productVariant.size ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right num font-medium">{fmtQty(i.orderedQty, 0)}</td>
                    <td className="px-3 py-1.5 text-right num">
                      {Number(i.releasedQty) > 0 ? fmtQty(i.releasedQty, 0) : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right num">
                      {Number(i.inwardedQty) > 0 ? fmtQty(i.inwardedQty, 0) : <span className="text-ink-subtle">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ---- readiness, before release ---- */}
      {data.isEditable ? (
        <Card className="mb-3">
          <CardHeader
            title="Material readiness"
            description="Live, and never stored. Open purchase orders are shown as incoming supply but are not counted as cover."
            actions={
              readiness.data ? (
                <Badge tone={readiness.data.isClear ? 'ok' : 'danger'}>
                  {readiness.data.isClear ? 'Clear to release' : 'Short of critical material'}
                </Badge>
              ) : null
            }
          />
          <CardBody className="p-0">
            {readiness.isLoading ? (
              <div className="p-4"><LoadingBlock label="Checking stock" /></div>
            ) : readiness.error ? (
              <div className="p-4"><ErrorPanel error={readiness.error} /></div>
            ) : readiness.data ? (
              <>
                <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-3">
                  <Stat
                    label="Stock covers"
                    value={`${fmtQty(readiness.data.maxProducibleQty, 0)} garments`}
                    tone={
                      Number(readiness.data.maxProducibleQty) >= Number(readiness.data.orderedQty) ? 'ok' : 'warn'
                    }
                    hint={`of ${fmtQty(readiness.data.orderedQty, 0)} ordered`}
                  />
                  <Stat label="Shortage value" value={fmtMoney(readiness.data.totalShortageValue)} />
                  <Stat label="Planned material cost" value={fmtMoney(readiness.data.totalEstimatedCost)} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-[12.5px]">
                    <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Material</th>
                        <th className="px-2 py-2 text-right font-medium">Required</th>
                        <th className="px-2 py-2 text-right font-medium">Available</th>
                        <th className="px-2 py-2 text-right font-medium">Reserved elsewhere</th>
                        <th className="px-2 py-2 text-right font-medium">Short</th>
                        <th className="px-2 py-2 text-right font-medium">Incoming</th>
                        <th className="px-3 py-2 text-left font-medium">Readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readiness.data.lines.map((l) => (
                        <tr key={l.rawMaterialId} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <CodeCell>{l.materialCode}</CodeCell>
                              {!l.isCritical ? <Badge tone="neutral">non-critical</Badge> : null}
                            </div>
                            <div className="text-[11.5px] text-ink-muted">{l.materialName}</div>
                          </td>
                          <td className="px-2 py-2 text-right num font-medium">
                            {fmtQty(l.grossRequiredQty, 4)} {uomShort(l.uom)}
                          </td>
                          <td className="px-2 py-2 text-right num">{fmtQty(l.availableQty, 4)}</td>
                          <td className="px-2 py-2 text-right num text-ink-muted">
                            {Number(l.reservedElsewhereQty) > 0 ? fmtQty(l.reservedElsewhereQty, 4) : '—'}
                          </td>
                          <td className="px-2 py-2 text-right num">
                            {Number(l.shortageQty) > 0 ? (
                              <span className={l.isCritical ? 'font-semibold text-danger' : 'text-warn'}>
                                {fmtQty(l.shortageQty, 4)}
                              </span>
                            ) : (
                              <span className="text-ink-subtle">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right num">
                            {Number(l.openPurchaseQty) > 0 ? (
                              <span>
                                {fmtQty(l.openPurchaseQty, 4)}
                                <span className="ml-1 text-[11px] text-ink-subtle">
                                  {fmtDate(l.expectedArrivalDate)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-ink-subtle">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={READINESS_TONE[l.readiness] ?? 'neutral'}>{humanise(l.readiness)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* ---- the frozen snapshot ---- */}
      {data.bomSnapshotLines.length > 0 ? (
        <Card className="mb-3">
          <CardHeader
            title="Frozen BOM snapshot"
            description="Copied from the BOM at release and never modified. This, not the master BOM, is what this order is costed and issued against — a later BOM edit cannot reach it."
            actions={
              <div className="flex items-center gap-2">
                <Snowflake className="size-3.5 text-info" />
                {data.bomVersion ? (
                  <Link
                    href={`/bom/${data.bomVersion.bom.id}`}
                    className="text-[12px] text-brand-strong hover:underline"
                  >
                    {data.bomVersion.bom.bomCode} v{data.bomVersion.version}
                  </Link>
                ) : null}
              </div>
            }
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">Material</th>
                    <th className="px-2 py-2 text-right font-medium">Consumption / unit</th>
                    <th className="px-2 py-2 text-right font-medium">Wastage / unit</th>
                    <th className="px-2 py-2 text-right font-medium">Gross / unit</th>
                    <th className="px-2 py-2 text-right font-medium">Planned total</th>
                    <th className="px-2 py-2 text-right font-medium">Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Planned cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bomSnapshotLines.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5 text-ink-subtle">{l.lineNo}</td>
                      <td className="px-3 py-1.5">
                        <CodeCell>{l.materialCode}</CodeCell>
                        <div className="text-[11.5px] text-ink-muted">{l.materialName}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right num text-ink-muted">{fmtQty(l.consumptionQtyPerUnit, 4)}</td>
                      <td className="px-2 py-1.5 text-right num text-ink-muted">{fmtQty(l.wastageQtyPerUnit, 4)}</td>
                      <td className="px-2 py-1.5 text-right num font-medium">{fmtQty(l.grossQtyPerUnit, 4)}</td>
                      <td className="px-2 py-1.5 text-right num">
                        {fmtQty(l.plannedQty, 4)} {uomShort(l.uom)}
                      </td>
                      <td className="px-2 py-1.5 text-right num">{fmtMoney(l.unitCost)}</td>
                      <td className="px-3 py-1.5 text-right num">{fmtMoney(l.plannedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ---- reservations ---- */}
      {data.reservations.length > 0 ? (
        <Card className="mb-3">
          <CardHeader
            title="Reserved material"
            description="A claim, not a movement: the material has not left the warehouse, but no other order can promise it."
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Material</th>
                    <th className="px-3 py-2 text-left font-medium">Lot</th>
                    <th className="px-3 py-2 text-left font-medium">Location</th>
                    <th className="px-3 py-2 text-right font-medium">Reserved</th>
                    <th className="px-3 py-2 text-right font-medium">Issued</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reservations.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5">
                        <CodeCell>{r.rawMaterial.materialCode}</CodeCell>
                        <div className="text-[11.5px] text-ink-muted">{r.rawMaterial.name}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="font-mono text-[11.5px]">{r.materialLot.lotCode}</span>
                        {r.materialLot.shade ? (
                          <span className="ml-1 text-[11px] text-ink-muted">{r.materialLot.shade}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">{r.location.code}</td>
                      <td className="px-3 py-1.5 text-right num font-medium">
                        {fmtQty(r.reservedQty, 4)} {uomShort(r.rawMaterial.baseUom)}
                      </td>
                      <td className="px-3 py-1.5 text-right num">
                        {Number(r.issuedQty) > 0 ? fmtQty(r.issuedQty, 4) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-3 py-1.5"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Order record" />
        <CardBody>
          <DescList
            items={[
              { label: 'Priority', value: humanise(data.priority) },
              { label: 'Production type', value: humanise(data.productionType) },
              { label: 'Route', value: data.route?.name ?? '—' },
              { label: 'Planned start', value: fmtDate(data.plannedStartDate) },
              { label: 'Released at', value: data.releasedAt ? fmtDateTime(data.releasedAt) : '—' },
              {
                label: 'BOM version',
                value: data.bomVersion ? `${data.bomVersion.bom.bomCode} v${data.bomVersion.version}` : '—',
              },
              { label: 'Remarks', value: data.remarks ?? '—' },
            ]}
          />
        </CardBody>
      </Card>

      <ReleaseDialog
        open={releasing}
        onOpenChange={setReleasing}
        moId={id}
        orderedQty={data.rollup.orderedQty}
        readiness={readiness.data ?? null}
        onDone={() => void invalidate()}
      />

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${data.moNo}?`}
        consequence="Every reservation this order holds is released back to available stock. Material nobody will use must not stay promised. This cannot be undone — an order that needs to run again is a new order."
        confirmLabel="Cancel order"
        tone="danger"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      >
        <Field label="Reason" required>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={2}
            placeholder="Why this order will not be made"
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Release.
 *
 * The dialog exists to make the freeze deliberate. When a critical material is
 * short it additionally demands a written reason, and the server independently
 * refuses unless the caller holds `manufacturing.release_with_shortage` — this
 * form is a prompt, never the control.
 */
function ReleaseDialog({
  open,
  onOpenChange,
  moId,
  orderedQty,
  readiness,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moId: string;
  orderedQty: string;
  readiness: Readiness | null;
  onDone: () => void;
}) {
  const { can } = useAuth();
  const [qty, setQty] = React.useState(orderedQty);
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setQty(orderedQty);
      setReason('');
    }
  }, [open, orderedQty]);

  const release = useMutation({
    mutationFn: () =>
      api.post<{ moNo: string; snapshotLineCount: number; releasedWithShortage: boolean }>(
        `/manufacturing/orders/${moId}/release`,
        {
          idempotencyKey: newIdempotencyKey(),
          releaseQty: Number(qty) !== Number(orderedQty) ? qty : null,
          shortageOverrideReason: reason || null,
        },
      ),
    onSuccess: (res) => {
      toast.success(
        `${res.moNo} released — ${res.snapshotLineCount} BOM line${
          res.snapshotLineCount === 1 ? '' : 's'
        } frozen`,
      );
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const short = readiness ? !readiness.isClear : false;
  const hasOverride = can('manufacturing.release_with_shortage');
  const producible = readiness ? Number(readiness.maxProducibleQty) : null;

  const blocked = short && (!hasOverride || reason.trim().length < 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Release to the floor"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={release.isPending}>Cancel</Button>
            <Button
              variant={short ? 'danger' : 'primary'}
              disabled={blocked || Number(qty) <= 0}
              loading={release.isPending}
              onClick={() => release.mutate()}
            >
              {short ? 'Release despite shortage' : 'Release'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink">
            Releasing copies the BOM version into an immutable snapshot on this order. Costing, issue limits
            and wastage analysis all read that snapshot afterwards, so later BOM edits cannot change what
            this order was built to.
          </div>

          <Field
            label="Quantity to release"
            hint={
              producible !== null && producible < Number(orderedQty)
                ? `Current stock fully covers ${producible} of ${Number(orderedQty)} garments`
                : 'The remainder stays on the order'
            }
          >
            <QtyInput value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>

          {producible !== null && producible > 0 && producible < Number(qty) ? (
            <Button onClick={() => setQty(String(producible))}>
              Release {producible} instead — what stock covers
            </Button>
          ) : null}

          {short ? (
            <>
              <div className="rounded border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px]">
                <p className="font-medium text-ink">
                  Short of {readiness?.lines.filter((l) => l.isCritical && Number(l.shortageQty) > 0).length}{' '}
                  critical material(s).
                </p>
                <ul className="mt-1 space-y-0.5 text-ink-muted">
                  {readiness?.lines
                    .filter((l) => l.isCritical && Number(l.shortageQty) > 0)
                    .map((l) => (
                      <li key={l.rawMaterialId}>
                        {l.materialCode}: need {fmtQty(l.grossRequiredQty, 4)}, have{' '}
                        {fmtQty(l.availableQty, 4)} {uomShort(l.uom)}
                      </li>
                    ))}
                </ul>
              </div>

              {!hasOverride ? (
                <p className="text-[12.5px] text-danger">
                  Releasing short of a critical material needs the{' '}
                  <code className="font-mono">manufacturing.release_with_shortage</code> permission, which
                  you do not hold. Reduce the quantity to what stock covers, or ask someone who does.
                </p>
              ) : (
                <Field
                  label="Reason for releasing short"
                  required
                  hint="At least 10 characters. Recorded on the order and in the audit log."
                >
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="e.g. Balance fabric arrives Tuesday; cutting starts on the 180 m in stock."
                  />
                </Field>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
