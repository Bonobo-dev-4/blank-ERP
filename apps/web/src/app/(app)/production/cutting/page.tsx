'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Scissors, TriangleAlert } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { fmtMoney, fmtQty, humanise, newIdempotencyKey, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, LoadingBlock,
  NativeSelect, QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { StageQueue } from '@/components/app/stage-queue';
import { useAuth } from '@/components/app/auth-context';

interface CuttingOrder {
  id: string; cuttingOrderNo: string; status: string;
  plannedPieces: string; actualPiecesCut: string; rejectedPieces: string;
  fabricIssuedBaseQty: string; fabricUsedBaseQty: string; fabricWastageBaseQty: string;
  fabricReturnedBaseQty: string; fabricOnTableQty: string;
  actualFabricPerPiece: string | null; wastagePct: string; isConsumptionPosted: boolean;
  manufacturingOrder: { id: string; moNo: string };
  productionBatch: { id: string; batchNo: string; plannedQty: string } | null;
  fabricLot: { id: string; lotCode: string; shade: string | null } | null;
}

interface BatchOption {
  id: string; batchNo: string; plannedQty: string;
  manufacturingOrder: { moNo: string };
  manufacturingOrderItem: { size: string | null; productVariant: { sku: string } };
}

interface MaterialOption { id: string; materialCode: string; name: string; baseUom: string }
interface LocationOption { id: string; code: string; name: string; kind: string }

interface BalanceRow {
  rawMaterialId: string; materialLotId: string; onHandQty: string; reservedQty: string;
  materialLot: { id: string; lotCode: string; shade: string | null };
  location: { id: string; code: string; name: string };
}

/**
 * The cutting table.
 *
 * Two things live here and they are deliberately separate: the **stage queue**
 * (what the route says is in hand) and **cutting orders** (what fabric was
 * issued and what the lay actually produced). Issuing fabric moves it to the
 * cutting department; only completing a cut retires it.
 */
export default function CuttingPage() {
  const { can } = useAuth();
  const [planning, setPlanning] = React.useState(false);
  const [issuing, setIssuing] = React.useState<CuttingOrder | null>(null);
  const [completing, setCompleting] = React.useState<CuttingOrder | null>(null);

  const orders = useQuery({
    queryKey: ['cutting-orders'],
    queryFn: () => api.get<Paginated<CuttingOrder>>('/cutting/orders', { pageSize: 50 }),
  });

  const open = (orders.data?.data ?? []).filter((o) => !o.isConsumptionPosted);
  const done = (orders.data?.data ?? []).filter((o) => o.isConsumptionPosted);

  return (
    <div className="space-y-5">
      <StageQueue
        stageCode="CUTTING"
        title="Cutting"
        description="Batches at the cutting table. Quantities recorded here are bounded by what the stage is actually holding, so a repeated submission is refused rather than doubling the count."
      />

      <Card>
        <CardHeader
          title="Cutting orders"
          description="Issuing fabric moves it to the cutting department — the owned quantity is unchanged. Only completing the cut retires it, and that happens exactly once."
          actions={
            can('production.record_stage') ? (
              <Button variant="primary" onClick={() => setPlanning(true)}>
                <Plus />
                Plan a cut
              </Button>
            ) : null
          }
        />
        <CardBody className="p-0">
          {orders.error ? (
            <div className="p-4"><ErrorPanel error={orders.error} onRetry={() => void orders.refetch()} /></div>
          ) : orders.isLoading ? (
            <div className="p-4"><LoadingBlock label="Loading cutting orders" /></div>
          ) : (orders.data?.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-muted">
              No cutting orders yet. Plan one against a batch that has reached cutting.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[12.5px]">
                <thead className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Order</th>
                    <th className="px-3 py-2 text-left font-medium">Batch</th>
                    <th className="px-2 py-2 text-right font-medium">Planned</th>
                    <th className="px-2 py-2 text-right font-medium">Cut</th>
                    <th className="px-2 py-2 text-right font-medium">Issued</th>
                    <th className="px-2 py-2 text-right font-medium" title="Fabric the table is still holding">
                      On table
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Used</th>
                    <th className="px-2 py-2 text-right font-medium">Wasted</th>
                    <th className="px-2 py-2 text-right font-medium" title="Fabric per garment actually achieved">
                      Per piece
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {[...open, ...done].map((o) => (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2"><CodeCell>{o.cuttingOrderNo}</CodeCell></td>
                      <td className="px-3 py-2">
                        <div className="text-ink">{o.productionBatch?.batchNo ?? '—'}</div>
                        <div className="text-[12px] text-ink-muted">{o.manufacturingOrder.moNo}</div>
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQty(o.plannedPieces, 0)}</td>
                      <td className="px-2 py-2 text-right num font-medium">
                        {Number(o.actualPiecesCut) > 0 ? fmtQty(o.actualPiecesCut, 0) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQty(o.fabricIssuedBaseQty, 2)}</td>
                      <td className="px-2 py-2 text-right num">
                        {Number(o.fabricOnTableQty) > 0
                          ? <span className="font-medium text-warn">{fmtQty(o.fabricOnTableQty, 2)}</span>
                          : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQty(o.fabricUsedBaseQty, 2)}</td>
                      <td className="px-2 py-2 text-right num">
                        {Number(o.fabricWastageBaseQty) > 0 ? (
                          <span>
                            {fmtQty(o.fabricWastageBaseQty, 2)}
                            <span className="ml-1 text-[12px] text-ink-subtle">{o.wastagePct}%</span>
                          </span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right num">
                        {o.actualFabricPerPiece ?? <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                      <td className="px-3 py-2 text-right">
                        {!o.isConsumptionPosted ? (
                          <div className="flex justify-end gap-1.5">
                            {can('inventory.issue') ? (
                              <Button onClick={() => setIssuing(o)}>Issue fabric</Button>
                            ) : null}
                            {can('inventory.consume') && Number(o.fabricIssuedBaseQty) > 0 ? (
                              <Button variant="primary" onClick={() => setCompleting(o)}>Complete</Button>
                            ) : null}
                          </div>
                        ) : (
                          <Badge tone="ok">fabric posted</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {planning ? <PlanCutDialog onClose={() => setPlanning(false)} /> : null}
      {issuing ? <IssueFabricDialog order={issuing} onClose={() => setIssuing(null)} /> : null}
      {completing ? <CompleteCutDialog order={completing} onClose={() => setCompleting(null)} /> : null}
    </div>
  );
}

function PlanCutDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [batchId, setBatchId] = React.useState('');
  const [fabricId, setFabricId] = React.useState('');
  const [pieces, setPieces] = React.useState('');

  const batches = useQuery({
    queryKey: ['batches', 'cut-picker'],
    queryFn: () => api.get<Paginated<BatchOption>>('/production/batches', { pageSize: 100 }),
  });
  const materials = useQuery({
    queryKey: ['materials', 'fabric-picker'],
    queryFn: () => api.get<Paginated<MaterialOption>>('/materials', { pageSize: 200, category: 'FABRIC' }),
  });

  const batch = (batches.data?.data ?? []).find((b) => b.id === batchId);
  React.useEffect(() => {
    if (batch) setPieces(batch.plannedQty);
  }, [batch]);

  const plan = useMutation({
    mutationFn: () =>
      api.post('/cutting/orders', {
        idempotencyKey: newIdempotencyKey(),
        productionBatchId: batchId,
        fabricMaterialId: fabricId,
        plannedPieces: pieces,
        // One size line per batch: a batch is already a single SKU.
        sizeBreakdown: [{ size: batch?.manufacturingOrderItem.size ?? 'ALL', plannedPieces: pieces }],
      }),
    onSuccess: () => {
      toast.success('Cutting order planned');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Plan a cut"
        footer={
          <>
            <Button onClick={onClose} disabled={plan.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!batchId || !fabricId || Number(pieces) <= 0}
              loading={plan.isPending}
              onClick={() => plan.mutate()}
            >
              Plan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {plan.error ? <ErrorPanel error={plan.error} /> : null}
          <Field label="Batch" required>
            <NativeSelect value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Select a batch</option>
              {(batches.data?.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} — {b.manufacturingOrder.moNo} · {b.manufacturingOrderItem.productVariant.sku}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Fabric" required>
            <NativeSelect value={fabricId} onChange={(e) => setFabricId(e.target.value)}>
              <option value="">Select a fabric</option>
              {(materials.data?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.materialCode} — {m.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Pieces to cut" required hint={batch ? `Batch holds ${fmtQty(batch.plannedQty, 0)}` : undefined}>
            <QtyInput value={pieces} onChange={(e) => setPieces(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueFabricDialog({ order, onClose }: { order: CuttingOrder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [source, setSource] = React.useState('');
  const [lotKey, setLotKey] = React.useState('');
  const [quantity, setQuantity] = React.useState('');

  const balances = useQuery({
    queryKey: ['balances', 'cut-issue'],
    queryFn: () => api.get<Paginated<BalanceRow>>('/inventory/balances', { pageSize: 200 }),
  });

  // Only stock sitting somewhere production may draw from.
  const issuable = (balances.data?.data ?? []).filter(
    (b) => Number(b.onHandQty) - Number(b.reservedQty) > 0 && b.location.code.startsWith('RM-'),
  );
  const chosen = issuable.find((b) => `${b.materialLotId}:${b.location.id}` === lotKey);

  React.useEffect(() => {
    if (chosen) {
      setSource(chosen.location.id);
      setQuantity(String(Number(chosen.onHandQty) - Number(chosen.reservedQty)));
    }
  }, [chosen]);

  const issue = useMutation({
    mutationFn: () =>
      api.post(`/cutting/orders/${order.id}/issue-fabric`, {
        idempotencyKey: newIdempotencyKey(),
        sourceLocationId: source,
        lines: [
          {
            rawMaterialId: chosen!.rawMaterialId,
            materialLotId: chosen!.materialLotId,
            quantity,
            uom: 'METER',
          },
        ],
      }),
    onSuccess: () => {
      toast.success('Fabric issued to the cutting table');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Issue fabric to ${order.cuttingOrderNo}`}
        footer={
          <>
            <Button onClick={onClose} disabled={issue.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!chosen || Number(quantity) <= 0}
              loading={issue.isPending}
              onClick={() => issue.mutate()}
            >
              Issue
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {issue.error ? <ErrorPanel error={issue.error} /> : null}

          {issuable.length === 0 ? (
            <p className="rounded border border-line bg-surface-muted px-2.5 py-2 text-[12.5px] text-ink-muted">
              No unreserved fabric is available in a raw-material location.
            </p>
          ) : (
            <>
              <Field label="Lot" required>
                <NativeSelect value={lotKey} onChange={(e) => setLotKey(e.target.value)}>
                  <option value="">Select a lot</option>
                  {issuable.map((b) => (
                    <option key={`${b.materialLotId}:${b.location.id}`} value={`${b.materialLotId}:${b.location.id}`}>
                      {b.materialLot.lotCode}
                      {b.materialLot.shade ? ` · ${b.materialLot.shade}` : ''} — {b.location.code} ·{' '}
                      {fmtQty(String(Number(b.onHandQty) - Number(b.reservedQty)), 2)} m available
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Length to issue" required>
                <QtyInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
            </>
          )}

          <p className="flex items-start gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            <Scissors className="mt-0.5 size-3.5 shrink-0" />
            This is a transfer. The fabric moves to the cutting department and the owned quantity is
            unchanged — only completing the cut retires it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompleteCutDialog({ order, onClose }: { order: CuttingOrder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [cut, setCut] = React.useState(order.plannedPieces);
  const [rejected, setRejected] = React.useState('');
  const [rejectionReason, setRejectionReason] = React.useState('');
  const [used, setUsed] = React.useState(order.fabricOnTableQty);
  const [wasted, setWasted] = React.useState('');
  const [returned, setReturned] = React.useState('');

  const balances = useQuery({
    queryKey: ['balances', 'cut-complete'],
    queryFn: () => api.get<Paginated<BalanceRow>>('/inventory/balances', { pageSize: 200 }),
  });
  const onTable = (balances.data?.data ?? []).find(
    (b) => b.location.code === 'DEPT-CUT' && Number(b.onHandQty) > 0,
  );

  const complete = useMutation({
    mutationFn: () =>
      api.post(`/cutting/orders/${order.id}/complete`, {
        idempotencyKey: newIdempotencyKey(),
        actualPiecesCut: cut || '0',
        rejectedPieces: rejected || '0',
        rejectionReason: Number(rejected) > 0 ? rejectionReason : null,
        consumption: [
          {
            rawMaterialId: onTable!.rawMaterialId,
            materialLotId: onTable!.materialLotId,
            consumedQty: used || '0',
            wastageQty: wasted || '0',
            uom: 'METER',
          },
        ],
        returns:
          Number(returned) > 0
            ? [
                {
                  rawMaterialId: onTable!.rawMaterialId,
                  materialLotId: onTable!.materialLotId,
                  quantity: returned,
                  uom: 'METER',
                },
              ]
            : [],
      }),
    onSuccess: () => {
      toast.success('Cut completed and fabric posted');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const accounted = Number(used || 0) + Number(wasted || 0) + Number(returned || 0);
  const issued = Number(order.fabricOnTableQty);
  const over = accounted > issued;
  const needsReason = Number(rejected) > 0 && rejectionReason.trim().length === 0;
  const perPiece = Number(cut) > 0 ? (Number(used || 0) + Number(wasted || 0)) / Number(cut) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Complete ${order.cuttingOrderNo}`}
        footer={
          <>
            <Button onClick={onClose} disabled={complete.isPending}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!onTable || over || needsReason || Number(cut || 0) + Number(rejected || 0) <= 0}
              loading={complete.isPending}
              onClick={() => complete.mutate()}
            >
              Complete and post fabric
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {complete.error ? <ErrorPanel error={complete.error} /> : null}

          <div className="flex items-start gap-2 rounded border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <p className="font-medium text-ink">This retires the fabric, and it happens once.</p>
              <p className="text-ink-muted">
                Completing a cutting order twice would deduct the fabric twice, so the second attempt is
                refused. Check the figures before you post.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Good pieces cut" required>
              <QtyInput value={cut} onChange={(e) => setCut(e.target.value)} className="h-11 text-[16px]" />
            </Field>
            <Field label="Rejected pieces">
              <QtyInput value={rejected} onChange={(e) => setRejected(e.target.value)} placeholder="0" className="h-11 text-[16px]" />
            </Field>
          </div>

          {Number(rejected) > 0 ? (
            <Field label="Why were they rejected?" required>
              <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={2} />
            </Field>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Fabric used" required>
              <QtyInput value={used} onChange={(e) => setUsed(e.target.value)} />
            </Field>
            <Field label="Wasted">
              <QtyInput value={wasted} onChange={(e) => setWasted(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Returned to store">
              <QtyInput value={returned} onChange={(e) => setReturned(e.target.value)} placeholder="0" />
            </Field>
          </div>

          <p className="text-[12px] text-ink-muted">
            {fmtQty(String(accounted), 2)} m of {fmtQty(order.fabricOnTableQty, 2)} m on the table accounted for
            {perPiece > 0 ? ` · ${perPiece.toFixed(4)} m per garment` : ''}
          </p>

          {over ? (
            <p className="text-[12.5px] text-danger">
              That is more fabric than the table was given. A cutting table cannot consume fabric it never
              received.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
