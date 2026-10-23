'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Printer, QrCode } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, ErrorPanel, Field, NativeSelect, PageHeader, QtyInput,
} from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

const KINDS = ['MATERIAL_LOT', 'FABRIC_ROLL', 'PRODUCTION_BATCH', 'PRODUCTION_UNIT', 'GOODS_RECEIPT', 'FG_CARTON'] as const;

interface BarcodeRow {
  id: string; code: string; kind: string; printCount: number; lastPrintedAt: string | null;
  isActive: boolean; createdAt: string;
  materialLot: { lotCode: string; shade: string | null; rawMaterial: { materialCode: string; name: string; baseUom: string } } | null;
  fabricRoll: { rollNo: string; currentLength: string; shade: string | null; status: string } | null;
  receipt: { grnNo: string; receiptDate: string } | null;
}

/**
 * Barcode label printing.
 *
 * Labels are generated server-side as a PDF laid out for 70 x 37 mm thermal
 * stock. The symbol carries only the identifier; every other word on the label
 * is read from the database at print time, so a label can never assert a
 * quantity or a stage that has since changed.
 */
export default function BarcodePrintPage() {
  const state = useListState({ sortBy: 'createdAt', sortDir: 'desc', pageSize: 50 });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<BarcodeRow>(
    'barcodes', '/barcodes', state,
  );

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [symbology, setSymbology] = React.useState<'code128' | 'qrcode'>('code128');
  const [copies, setCopies] = React.useState('1');

  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const print = useMutation({
    mutationFn: async () => {
      const blob = await api.postForBlob('/barcodes/labels', {
        codes: [...selected],
        symbology,
        copies: Number(copies || 1),
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      return url;
    },
    onSuccess: () => {
      toast.success(`${selected.size} label${selected.size === 1 ? '' : 's'} generated`);
      void refetch();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const columns = React.useMemo<ColumnDef<BarcodeRow, unknown>[]>(
    () => [
      { id: 'select', header: '',
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.code)}
            onChange={() => toggle(row.original.code)}
            aria-label={`Select ${row.original.code}`}
          />
        ),
      },
      { id: 'code', header: 'Barcode', accessorKey: 'code',
        cell: ({ row }) => <CodeCell>{row.original.code}</CodeCell> },
      { id: 'kind', header: 'Kind', accessorKey: 'kind',
        cell: ({ row }) => <Badge tone="outline">{humanise(row.original.kind)}</Badge> },
      { id: 'subject', header: 'Identifies',
        accessorFn: (r) => r.fabricRoll?.rollNo ?? r.materialLot?.lotCode ?? r.receipt?.grnNo ?? '',
        cell: ({ row }) => {
          const r = row.original;
          if (r.fabricRoll) {
            return (
              <StackedCell
                primary={`Roll ${r.fabricRoll.rollNo}`}
                secondary={`${fmtQty(r.fabricRoll.currentLength)} remaining${r.fabricRoll.shade ? ` · shade ${r.fabricRoll.shade}` : ''}`}
              />
            );
          }
          if (r.materialLot) {
            return (
              <StackedCell
                primary={`${r.materialLot.rawMaterial.materialCode} · ${r.materialLot.lotCode}`}
                secondary={r.materialLot.rawMaterial.name}
              />
            );
          }
          if (r.receipt) {
            return <StackedCell primary={`GRN ${r.receipt.grnNo}`} secondary={fmtDateTime(r.receipt.receiptDate)} />;
          }
          return <span className="text-ink-subtle">-</span>;
        },
      },
      { id: 'printCount', header: 'Printed', accessorKey: 'printCount',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="text-ink-muted">
            {row.original.printCount}
            {row.original.lastPrintedAt ? ` · ${fmtDateTime(row.original.lastPrintedAt)}` : ''}
          </span>
        ),
      },
      { id: 'isActive', header: 'Active', accessorKey: 'isActive',
        cell: ({ row }) => (
          <Badge tone={row.original.isActive ? 'ok' : 'danger'}>
            {row.original.isActive ? 'active' : 'revoked'}
          </Badge>
        ),
      },
    ],
    [selected],
  );

  const allCodes = (data?.data ?? []).map((b) => b.code);

  return (
    <div>
      <PageHeader
        title="Barcode Printing"
        description="Code 128 for scanners, QR where more data density is useful. Labels print three across on 70 x 37 mm stock."
      />

      <Card className="mb-3">
        <CardBody className="flex flex-wrap items-end gap-3 py-2.5">
          <Field label="Symbology" className="w-36">
            <NativeSelect value={symbology} onChange={(e) => setSymbology(e.target.value as 'code128' | 'qrcode')}>
              <option value="code128">Code 128</option>
              <option value="qrcode">QR code</option>
            </NativeSelect>
          </Field>
          <Field label="Copies each" className="w-24">
            <QtyInput value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              onClick={() => setSelected(new Set(allCodes))}
              disabled={allCodes.length === 0}
            >
              Select page
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear
            </Button>
          </div>
          <Button
            variant="primary"
            className="ml-auto"
            onClick={() => print.mutate()}
            loading={print.isPending}
            disabled={selected.size === 0}
          >
            {symbology === 'qrcode' ? <QrCode /> : <Printer />}
            Print {selected.size} label{selected.size === 1 ? '' : 's'}
          </Button>
        </CardBody>
      </Card>

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Barcode' }}
        exportFileName="barcodes"
        emptyTitle="No barcodes issued"
        emptyDescription="Barcodes are created automatically for material lots, fabric rolls and goods receipts."
        toolbar={
          <NativeSelect
            value={String(state.filters.kind ?? '')}
            onChange={(e) => state.setFilter('kind', e.target.value || undefined)}
            className="w-auto"
            aria-label="Barcode kind"
          >
            <option value="">All kinds</option>
            {KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}
          </NativeSelect>
        }
      />
    </div>
  );
}
