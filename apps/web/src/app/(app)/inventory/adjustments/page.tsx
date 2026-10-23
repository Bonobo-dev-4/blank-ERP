'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtQty, newIdempotencyKey, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, ErrorPanel, Field, NativeSelect, PageHeader, QtyInput, Textarea,
} from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface AdjustmentRow {
  id: string; movementNo: string; movementType: string; baseQty: string; baseUom: string;
  reason: string | null; remarks: string | null; occurredAt: string;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string };
  materialLot: { lotCode: string };
  sourceLocation: { code: string; kind: string };
  destinationLocation: { code: string; kind: string };
}

export default function AdjustmentsPage() {
  const { can } = useAuth();
  const state = useListState({ pageSize: 50, filters: { movementType: 'ADJUSTMENT_IN' } });
  const [open, setOpen] = React.useState(false);

  // Both directions of adjustment, fetched separately and merged, because the
  // ledger stores an increase and a decrease as different movement types.
  const inward = useListQuery<AdjustmentRow>('adj-in', '/inventory/movements', {
    ...state,
    filters: { movementType: 'ADJUSTMENT_IN' },
  });
  const outward = useListQuery<AdjustmentRow>('adj-out', '/inventory/movements', {
    ...state,
    filters: { movementType: 'ADJUSTMENT_OUT' },
  });

  const rows = React.useMemo(() => {
    const merged = [...(inward.data?.data ?? []), ...(outward.data?.data ?? [])];
    return merged.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [inward.data, outward.data]);

  const columns = React.useMemo<ColumnDef<AdjustmentRow, unknown>[]>(
    () => [
      { id: 'occurredAt', header: 'When', accessorKey: 'occurredAt',
        cell: ({ row }) => <StackedCell primary={fmtDateTime(row.original.occurredAt)} secondary={row.original.movementNo} /> },
      { id: 'direction', header: 'Direction', accessorKey: 'movementType',
        cell: ({ row }) => (
          <Badge tone={row.original.movementType === 'ADJUSTMENT_IN' ? 'ok' : 'danger'}>
            {row.original.movementType === 'ADJUSTMENT_IN' ? 'Increase' : 'Decrease'}
          </Badge>
        ),
      },
      { id: 'material', header: 'Material', accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.rawMaterial.materialCode} secondary={row.original.materialLot.lotCode} />
        ),
      },
      { id: 'baseQty', header: 'Quantity', accessorKey: 'baseQty', meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="font-medium">
            {fmtQty(row.original.baseQty)} {uomShort(row.original.baseUom)}
          </span>
        ),
      },
      { id: 'route', header: 'From → To',
        accessorFn: (r) => `${r.sourceLocation.code} ${r.destinationLocation.code}`,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <CodeCell>{row.original.sourceLocation.code}</CodeCell>
            <ArrowRight className="size-3 text-ink-subtle" />
            <CodeCell>{row.original.destinationLocation.code}</CodeCell>
          </span>
        ),
      },
      { id: 'reason', header: 'Reason', accessorKey: 'reason',
        cell: ({ row }) => <span className="text-[12px]">{row.original.reason ?? '-'}</span> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        description="Corrections posted against the adjustment counter-account. Every one is a normal ledger movement with a mandatory reason, so a correction is as visible and as reversible as any other stock change."
        actions={
          can('inventory.adjust') ? (
            <Button variant="elevated" onClick={() => setOpen(true)}>
              <SlidersHorizontal />
              New adjustment
            </Button>
          ) : null
        }
      />

      <Card className="mb-3 border-warn/30 bg-warn-soft">
        <CardBody className="flex items-start gap-2 py-2.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <p className="text-[12.5px] text-ink">
            Adjustments create or destroy stock without a supplier document. They require an elevated
            permission, are fully audited, and should be the exception - a physical count variance or a
            data-entry correction, not routine housekeeping.
          </p>
        </CardBody>
      </Card>

      {inward.error ? <ErrorPanel error={inward.error} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={rows}
        isLoading={inward.isLoading || outward.isLoading}
        isFetching={inward.isFetching || outward.isFetching}
        pagination={paginationProps(inward.data, state)}
        exportFileName="stock-adjustments"
        emptyTitle="No adjustments posted"
        emptyDescription="Good. Stock has only moved through documented operations."
      />

      {open ? <AdjustmentDialog open={open} onOpenChange={setOpen} /> : null}
    </div>
  );
}

function AdjustmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [materialId, setMaterialId] = React.useState('');
  const [lotId, setLotId] = React.useState('');
  const [locationId, setLocationId] = React.useState('');
  const [direction, setDirection] = React.useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);

  // One key per dialog opening: a double-click or a retry replays the same key
  // and the server returns the stored result rather than adjusting twice.
  const idempotencyKey = React.useMemo(() => newIdempotencyKey(), []);

  const { data: materials } = useQuery({
    queryKey: ['materials', 'options'],
    queryFn: () => api.get<{ data: { id: string; materialCode: string; name: string; baseUom: string }[] }>(
      '/materials', { pageSize: 200, status: 'ACTIVE' },
    ),
  });
  const { data: material } = useQuery({
    queryKey: ['material', materialId],
    queryFn: () => api.get<{
      baseUom: string;
      lots: { id: string; lotCode: string; shade: string | null }[];
      balancesByLocation: { locationId: string; locationCode: string; locationName: string; materialLotId: string; onHandQty: string }[];
    }>(`/materials/${materialId}`),
    enabled: Boolean(materialId),
  });
  const { data: locations } = useQuery({
    queryKey: ['locations', 'physical'],
    queryFn: () => api.get<{ id: string; code: string; name: string; kind: string }[]>('/locations'),
  });

  const selectedMaterial = materials?.data.find((m) => m.id === materialId);

  const submit = useMutation({
    mutationFn: () =>
      api.post('/inventory/adjust', {
        idempotencyKey,
        rawMaterialId: materialId,
        materialLotId: lotId,
        locationId,
        adjustmentQty: direction === 'decrease' ? `-${quantity}` : quantity,
        uom: selectedMaterial?.baseUom,
        reason,
        remarks: remarks || null,
      }),
    onSuccess: () => {
      toast.success('Adjustment posted to the ledger');
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: setError,
  });

  const ready = materialId && lotId && locationId && Number(quantity) > 0 && reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New stock adjustment"
        description="Elevated action. The reason is recorded in the audit log alongside your name."
        footer={
          <>
            <DialogClose asChild><Button variant="default">Cancel</Button></DialogClose>
            <Button variant="elevated" onClick={() => submit.mutate()} loading={submit.isPending} disabled={!ready}>
              Post adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}

          <Field label="Material" required>
            <NativeSelect
              value={materialId}
              onChange={(e) => { setMaterialId(e.target.value); setLotId(''); setLocationId(''); }}
            >
              <option value="">Select a material</option>
              {(materials?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.materialCode} · {m.name}</option>
              ))}
            </NativeSelect>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Lot" required hint={material ? undefined : 'pick a material first'}>
              <NativeSelect value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!material}>
                <option value="">Select a lot</option>
                {(material?.lots ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lotCode}{l.shade ? ` · ${l.shade}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Location" required>
              <NativeSelect value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select a location</option>
                {(locations ?? []).filter((l) => l.kind === 'PHYSICAL').map((l) => (
                  <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {material && lotId && locationId ? (
            <p className="rounded border border-line bg-surface-muted px-2.5 py-1.5 text-[12px] text-ink-muted">
              Current balance at this location and lot:{' '}
              <strong className="num font-medium text-ink">
                {fmtQty(
                  material.balancesByLocation.find(
                    (b) => b.locationId === locationId && b.materialLotId === lotId,
                  )?.onHandQty ?? '0',
                )}{' '}
                {uomShort(material.baseUom)}
              </strong>
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction" required>
              <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')}>
                <option value="increase">Increase stock</option>
                <option value="decrease">Decrease stock</option>
              </NativeSelect>
            </Field>
            <Field label="Quantity" required hint={selectedMaterial ? uomShort(selectedMaterial.baseUom) : undefined}>
              <QtyInput value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.0000" />
            </Field>
          </div>

          <Field label="Reason" required hint="recorded in the audit log">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Physical count variance in Fabric Room, rack 03"
            />
          </Field>
          <Field label="Remarks">
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
