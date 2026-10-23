'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, humanise, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, LoadingBlock,
  PageHeader, QtyInput, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface RunLine {
  rawMaterialId: string; materialCode: string; materialName: string; category: string; uom: string;
  netRequiredQty: string; wastageQty: string; grossRequiredQty: string;
  availableQty: string; reservedElsewhereQty: string; openPurchaseQty: string;
  expectedArrivalDate: string | null; shortageQty: string; uncoveredShortageQty: string;
  shortageValue: string; unitCost: string; estimatedCost: string;
  readiness: string; orderCount: number;
}

interface RunDetail {
  id: string; runNo: string; status: string; createdAt: string; completedAt: string | null;
  scope: Record<string, unknown>; parameters: Record<string, unknown>;
  shortageLineCount: number; totalShortageValue: string; isProductionReady: boolean;
  lines: RunLine[];
  requirementIdsByMaterial: Record<string, string[]>;
  requisitions: { id: string; requisitionNo: string; status: string }[];
}

const READINESS_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  READY: 'ok',
  PARTIALLY_AVAILABLE: 'warn',
  SHORT: 'danger',
  SHORT_AND_LATE: 'danger',
};

export default function MrpRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [raising, setRaising] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mrp-run', id],
    queryFn: () => api.get<RunDetail>(`/mrp/runs/${id}`),
  });

  if (isLoading) return <LoadingBlock label="Loading run" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return <ErrorPanel error={new Error('Run not found')} />;

  const shortLines = data.lines.filter((l) => Number(l.uncoveredShortageQty) > 0);

  return (
    <div>
      <Button onClick={() => router.push('/mrp')} className="mb-3">
        <ArrowLeft />
        All runs
      </Button>

      <PageHeader
        title={data.runNo}
        description={`Planned at ${fmtDateTime(data.createdAt)}. These figures are frozen as at that moment.`}
        actions={
          can('purchasing.write_requisition') && shortLines.length > 0 ? (
            <Button variant="primary" onClick={() => setRaising(true)}>
              <ClipboardList />
              Raise requisition
            </Button>
          ) : null
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Materials" value={String(data.lines.length)} />
        <Stat
          label="Short"
          value={String(data.shortageLineCount)}
          tone={data.shortageLineCount > 0 ? 'danger' : 'ok'}
          hint={data.shortageLineCount > 0 ? 'against physical stock' : 'every line covered'}
        />
        <Stat label="Shortage value" value={fmtMoney(data.totalShortageValue)} />
        <Stat
          label="Can production start"
          value={data.isProductionReady ? 'Yes' : 'No'}
          tone={data.isProductionReady ? 'ok' : 'warn'}
        />
      </div>

      <Card className="mb-3">
        <CardHeader
          title="Requirement lines"
          description="Available counts unreserved stock in issuable locations only. Incoming purchase quantity is shown beside it, never inside it."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-[12.5px]">
              <thead className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Material</th>
                  <th className="px-2 py-2 text-right font-medium">Net</th>
                  <th className="px-2 py-2 text-right font-medium">Wastage</th>
                  <th className="px-2 py-2 text-right font-medium">Required</th>
                  <th className="px-2 py-2 text-right font-medium">Available</th>
                  <th className="px-2 py-2 text-right font-medium" title="Promised to other manufacturing orders">
                    Reserved elsewhere
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Shortage</th>
                  <th className="px-2 py-2 text-right font-medium">Incoming</th>
                  <th className="px-2 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Readiness</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => {
                  const short = Number(l.shortageQty) > 0;
                  return (
                    <tr key={l.rawMaterialId} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <CodeCell>{l.materialCode}</CodeCell>
                        <div className="text-[11.5px] text-ink-muted">{l.materialName}</div>
                      </td>
                      <td className="px-2 py-2 text-right num text-ink-muted">{fmtQty(l.netRequiredQty, 4)}</td>
                      <td className="px-2 py-2 text-right num text-ink-muted">{fmtQty(l.wastageQty, 4)}</td>
                      <td className="px-2 py-2 text-right num font-medium">
                        {fmtQty(l.grossRequiredQty, 4)} {uomShort(l.uom)}
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQty(l.availableQty, 4)}</td>
                      <td className="px-2 py-2 text-right num text-ink-muted">
                        {Number(l.reservedElsewhereQty) > 0 ? fmtQty(l.reservedElsewhereQty, 4) : '—'}
                      </td>
                      <td className="px-2 py-2 text-right num">
                        {short ? (
                          <span className="font-semibold text-danger">{fmtQty(l.shortageQty, 4)}</span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right num">
                        {Number(l.openPurchaseQty) > 0 ? (
                          <span title={`Expected ${fmtDate(l.expectedArrivalDate)}`}>
                            {fmtQty(l.openPurchaseQty, 4)}
                            <span className="ml-1 text-[11px] text-ink-subtle">
                              {fmtDate(l.expectedArrivalDate)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right num">
                        {short ? fmtMoney(l.shortageValue) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={READINESS_TONE[l.readiness] ?? 'neutral'}>{humanise(l.readiness)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="How this run was computed" />
          <CardBody>
            <DescList
              columns={1}
              items={[
                { label: 'Status', value: <StatusBadge status={data.status} /> },
                { label: 'Completed', value: data.completedAt ? fmtDateTime(data.completedAt) : '—' },
                {
                  label: 'Availability rule',
                  value: String(data.parameters.availabilityRule ?? '—')
                    .toLowerCase()
                    .replace(/_/g, ' '),
                },
                {
                  label: 'Open purchase orders',
                  value: data.parameters.openPurchaseOrdersCountedAsStock
                    ? 'counted as stock'
                    : 'reported as incoming supply, not stock',
                },
                {
                  label: 'Required by',
                  value: data.parameters.requiredByDate ? fmtDate(String(data.parameters.requiredByDate)) : '—',
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Requisitions raised from this run" />
          <CardBody>
            {data.requisitions.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-muted">
                None yet.
                {shortLines.length > 0
                  ? ` ${shortLines.length} material(s) remain uncovered by any open purchase order.`
                  : ''}
              </p>
            ) : (
              <ul className="space-y-1">
                {data.requisitions.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded border border-line px-2 py-1.5 text-[12.5px]"
                  >
                    <CodeCell>{r.requisitionNo}</CodeCell>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <RaiseRequisitionDialog
        open={raising}
        onOpenChange={setRaising}
        run={data}
        lines={shortLines}
        onDone={() => void refetch()}
      />
    </div>
  );
}

function RaiseRequisitionDialog({
  open,
  onOpenChange,
  run,
  lines,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: RunDetail;
  lines: RunLine[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // Seeded from the suggestion, then editable: a planner routinely adjusts a
  // quantity, and the one they raise must be the one they chose.
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [chosen, setChosen] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(lines.map((l) => [l.rawMaterialId, l.uncoveredShortageQty])));
    setChosen(Object.fromEntries(lines.map((l) => [l.rawMaterialId, true])));
  }, [open, lines]);

  const raise = useMutation({
    mutationFn: () =>
      api.post<{ requisitionNo: string }>('/mrp/requisitions', {
        mrpRunId: run.id,
        lines: lines
          .filter((l) => chosen[l.rawMaterialId] && Number(qty[l.rawMaterialId]) > 0)
          .map((l) => ({
            // One requirement row per material carries the link back to the run.
            materialRequirementId: run.requirementIdsByMaterial[l.rawMaterialId][0],
            rawMaterialId: l.rawMaterialId,
            requestedQty: qty[l.rawMaterialId],
          })),
      }),
    onSuccess: (res) => {
      toast.success(`Requisition ${res.requisitionNo} raised`);
      void queryClient.invalidateQueries();
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const selectedCount = lines.filter((l) => chosen[l.rawMaterialId] && Number(qty[l.rawMaterialId]) > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Raise a purchase requisition"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={raise.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={selectedCount === 0}
              loading={raise.isPending}
              onClick={() => raise.mutate()}
            >
              Raise for {selectedCount} material{selectedCount === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-[12px] text-ink-muted">
            Only materials still uncovered by an open purchase order are listed.
          </p>
          {lines.map((l) => (
            <div key={l.rawMaterialId} className="flex items-center gap-2 rounded border border-line px-2 py-1.5">
              <input
                type="checkbox"
                checked={Boolean(chosen[l.rawMaterialId])}
                onChange={(e) => setChosen((c) => ({ ...c, [l.rawMaterialId]: e.target.checked }))}
                aria-label={`Include ${l.materialCode}`}
              />
              <div className="min-w-0 flex-1">
                <CodeCell>{l.materialCode}</CodeCell>
                <div className="truncate text-[11.5px] text-ink-muted">
                  short {fmtQty(l.uncoveredShortageQty, 4)} {uomShort(l.uom)}
                </div>
              </div>
              <QtyInput
                value={qty[l.rawMaterialId] ?? ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.rawMaterialId]: e.target.value }))}
                className="w-28"
                aria-label={`Quantity for ${l.materialCode}`}
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
