'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Card, CardBody, CardHeader, DescList, EmptyState, ErrorPanel,
  LoadingBlock, PageHeader, StatusBadge,
} from '@/components/ui/primitives';

interface Stage {
  code: string; name: string; sequence: number;
  receivedQty: string; completedQty: string; forwardedQty: string; rejectedQty: string;
}
interface Line {
  id: string; externalSku: string | null; title: string | null; size: string | null; color: string | null;
  productVariantId: string | null; sku: string | null; productId: string | null;
  productName: string | null; styleCode: string | null; imageUrl: string | null; isMapped: boolean;
  orderedQty: string; cancelledQty: string; fulfilledQty: string; manufacturingQty: string;
  availabilityStatus: string;
  demand: {
    demandNo: string; status: string; manufacturingQty: string; allocatedQty: string;
    isRejectedForDispatch: boolean; rejectedReason: string | null;
  } | null;
  manufacturingOrder: { id: string; moNo: string; status: string } | null;
  stages: Stage[];
}
interface Order {
  id: string; orderNumber: string; orderName: string | null; channel: string;
  isCustomised: boolean; posLocationName: string | null; status: string;
  financialStatus: string | null; fulfillmentStatus: string | null;
  currency: string | null; totalAmount: string | null; customerRef: string | null;
  note: string | null; tags: string[]; orderedAt: string; cancelledAt: string | null;
  importedAt: string; lines: Line[];
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<Order>(`/integrations/shopify/orders/${id}`),
  });

  if (isLoading) return <LoadingBlock label="Loading order" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const owed = data.lines.reduce((n, l) => n + Number(l.manufacturingQty), 0);

  return (
    <div className="space-y-4">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" /> All orders
      </Link>

      <PageHeader
        title={data.orderName ?? `#${data.orderNumber}`}
        description={`${humanise(data.channel)}${data.posLocationName ? ` · ${data.posLocationName}` : ''} · placed ${fmtDateTime(data.orderedAt)}`}
        actions={
          <div className="flex items-center gap-2">
            {data.isCustomised ? <Badge tone="warn">bespoke</Badge> : null}
            <StatusBadge status={data.status} />
          </div>
        }
      />

      <Card>
        <CardBody>
          <DescList
            items={[
              { label: 'Customer', value: data.customerRef ?? '—' },
              { label: 'Order value', value: data.totalAmount ? fmtMoney(data.totalAmount) : '—' },
              { label: 'Payment', value: data.financialStatus ? humanise(data.financialStatus) : '—' },
              { label: 'Fulfilment', value: data.fulfillmentStatus ? humanise(data.fulfillmentStatus) : '—' },
              { label: 'Still owed', value: `${fmtQty(String(owed), 0)} garments` },
              { label: 'Imported', value: fmtDateTime(data.importedAt) },
            ]}
          />
          {data.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
              {data.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>)}
            </div>
          ) : null}
          {data.note ? (
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-muted">{data.note}</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${data.lines.length} ${data.lines.length === 1 ? 'line' : 'lines'}`}
          description="What was bought, what is still owed, and how far production has taken it."
        />
        {data.lines.length === 0 ? (
          <EmptyState title="This order has no lines" description="Nothing was imported against it." />
        ) : (
          <ul className="divide-y divide-line">
            {data.lines.map((l) => <LineRow key={l.id} line={l} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LineRow({ line: l }: { line: Line }) {
  const owed = Number(l.manufacturingQty);
  return (
    <li className={`px-3.5 py-3 ${l.demand?.isRejectedForDispatch ? 'row-flag' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px]">{l.sku ?? '—'}</span>
            {!l.isMapped ? <Badge tone="warn">unmapped</Badge> : null}
            {l.demand?.isRejectedForDispatch ? <Badge tone="danger">sent to production</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] font-medium text-ink">{l.productName ?? l.title ?? 'Unnamed'}</p>
          <p className="text-[11.5px] text-ink-muted">
            {[l.color, l.size].filter(Boolean).join(' · ') || '—'}
            {l.productId ? (
              <Link href={`/admin/products/${l.productId}`} className="ml-2 inline-flex items-center gap-0.5 font-medium text-ink hover:underline">
                View product <ArrowUpRight className="size-3" />
              </Link>
            ) : null}
          </p>
        </div>

        <dl className="flex gap-5 text-[12px]">
          <Figure label="Ordered" value={l.orderedQty} />
          <Figure label="Shipped" value={l.fulfilledQty} muted />
          {Number(l.cancelledQty) > 0 ? <Figure label="Cancelled" value={l.cancelledQty} struck /> : null}
          <Figure label="Still owed" value={l.manufacturingQty} strong={owed > 0} />
        </dl>
      </div>

      {l.demand ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-muted">
          <span className="font-mono">{l.demand.demandNo}</span>
          <StatusBadge status={l.demand.status} />
          {l.manufacturingOrder ? (
            <Link href={`/manufacturing/${l.manufacturingOrder.id}`} className="font-mono font-medium text-ink hover:underline">
              {l.manufacturingOrder.moNo}
            </Link>
          ) : null}
          {l.demand.rejectedReason ? <span>Reason: {l.demand.rejectedReason}</span> : null}
        </div>
      ) : (
        <p className="mt-2.5 text-[11.5px] text-ink-subtle">
          {owed > 0
            ? 'Not promoted to demand yet — nothing is being made for this line.'
            : 'Nothing owed, so no demand was raised.'}
        </p>
      )}

      {l.stages.length > 0 ? <StageTrack stages={l.stages} /> : null}
    </li>
  );
}

function Figure({
  label, value, muted, strong, struck,
}: { label: string; value: string; muted?: boolean; strong?: boolean; struck?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd
        className={`num font-display text-[17px] leading-none ${
          struck ? 'struck text-ink-muted'
            : strong ? 'font-semibold text-ink'
            : muted ? 'text-ink-muted' : 'text-ink'
        }`}
      >
        {fmtQty(value, 0)}
      </dd>
    </div>
  );
}

/**
 * How far this line has got through production.
 *
 * The same reading as the dashboard: one bar per stage, never summed, because
 * a garment passes through every stage and adding them counts it repeatedly.
 * The filled portion is what that stage has finished; the stage currently
 * holding work is marked solid, the rest hairline.
 */
function StageTrack({ stages }: { stages: Stage[] }) {
  const peak = Math.max(1, ...stages.map((s) => Number(s.receivedQty)));
  return (
    <div className="mt-3 rounded border border-line bg-surface-muted px-3 py-2.5">
      <p className="mb-2 text-[10.5px] uppercase tracking-wide text-ink-subtle">Production</p>
      <div className="scroll-x">
        <div
          className="grid min-w-[420px] gap-x-3"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(72px, 1fr))` }}
        >
          {stages.map((s) => {
            const received = Number(s.receivedQty);
            const wip = Math.max(0, received - Number(s.forwardedQty) - Number(s.rejectedQty));
            const pct = Math.min(100, Math.round((received / peak) * 100));
            return (
              <div key={s.code}>
                <div className="truncate text-[11px] font-medium text-ink-muted" title={s.name}>
                  {s.name}
                </div>
                <div className="num font-display mt-0.5 text-[15px] font-semibold leading-none text-ink">
                  {fmtQty(String(wip), 0)}
                </div>
                <div className="mt-1.5 h-[3px] w-full rounded-full bg-line">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ${wip > 0 ? 'bg-ink' : 'bg-line-strong'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 text-[10.5px] text-ink-subtle">
                  {fmtQty(s.receivedQty, 0)} in
                  {Number(s.rejectedQty) > 0 ? (
                    <span className="struck ml-1.5">{fmtQty(s.rejectedQty, 0)} rejected</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
