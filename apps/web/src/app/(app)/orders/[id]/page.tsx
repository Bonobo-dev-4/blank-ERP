'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowUpRight, Check, Copy, ExternalLink, Lock, RefreshCw, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/app/auth-context';
import { FacilitySwitchHistory, SwitchFacilityButton } from '@/components/app/switch-facility';
import { fmtDateTime, fmtMoney, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, EmptyState, ErrorPanel,
  LoadingBlock, PageHeader, StatusBadge,
} from '@/components/ui/primitives';

interface Stage {
  code: string; name: string; sequence: number;
  receivedQty: string; completedQty: string; forwardedQty: string; rejectedQty: string;
}
interface KeyValue { key: string; value: string | null }
interface Address {
  name: string | null; company: string | null; address1: string | null; address2: string | null;
  city: string | null; province: string | null; provinceCode: string | null; zip: string | null;
  country: string | null; countryCode: string | null; phone: string | null;
}
interface ShopifyLine {
  lineId: string | null; name: string | null;
  productId: string | null; productLegacyId: string | null; productTitle: string | null;
  productHandle: string | null; productType: string | null; vendor: string | null;
  variantId: string | null; variantLegacyId: string | null; variantTitle: string | null;
  barcode: string | null; inventoryItemId: string | null;
  options: { name: string; value: string | null }[];
  unitPrice: string | null; discountedUnitPrice: string | null; totalDiscount: string | null;
  requiresShipping: boolean | null; taxable: boolean | null;
  attributes: KeyValue[]; adminUrl: string | null;
}
interface Line {
  id: string; externalSku: string | null; title: string | null; size: string | null; color: string | null;
  productVariantId: string | null; sku: string | null; productId: string | null;
  productName: string | null; styleCode: string | null; imageUrl: string | null; isMapped: boolean;
  shopify: ShopifyLine;
  unicommerceItems: {
    itemCode: string; facilityCode: string | null; facilityName: string | null;
    statusCode: string | null; shippingPackageStatus: string | null; syncedAt: string;
  }[];
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
  shopify: {
    orderId: string; legacyId: string | null; adminUrl: string | null;
    confirmationNumber: string | null; sourceName: string | null;
  };
  customerHidden: boolean;
  customer: {
    id: string | null; legacyId: string | null; name: string | null; email: string | null;
    phone: string | null; numberOfOrders: string | null; adminUrl: string | null;
  } | null;
  contact: { email: string | null; phone: string | null } | null;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  statusPageUrl: string | null;
  money: {
    subtotal: string | null; discounts: string | null; shipping: string | null;
    tax: string | null; total: string | null; refunded: string | null;
  };
  paymentGateways: string[];
  discountCodes: string[];
  taxLines: { title: string | null; rate: number | null; amount: string | null }[];
  shippingLines: { title: string | null; code: string | null; carrier: string | null; amount: string | null }[];
  fulfillments: {
    status: string | null; createdAt: string | null;
    tracking: { company: string | null; number: string | null; url: string | null }[];
  }[];
  attributes: KeyValue[];
  cancelReason: string | null;
  closedAt: string | null;
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<Order>(`/integrations/shopify/orders/${id}`),
  });
  const qc = useQueryClient();
  const canRefresh = useAuth().can('demand.import');
  const refresh = useMutation({
    mutationFn: () =>
      api.post<{ refreshed: number; missing: number; order: Order }>(`/integrations/shopify/orders/${id}/refresh`, {}),
    onSuccess: (r) => {
      qc.setQueryData(['order', id], r.order);
      void qc.invalidateQueries({ queryKey: ['shopify-orders'] });
      if (r.missing > 0) toast.warning('Shopify no longer has this order. The copy here is unchanged.');
      else toast.success('Refreshed from Shopify');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Refresh from Shopify failed'),
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
            {canRefresh ? (
              <Button size="sm" variant="ghost" loading={refresh.isPending} onClick={() => refresh.mutate()}>
                <RefreshCw /> Refresh from Shopify
              </Button>
            ) : null}
            {data.shopify.adminUrl ? (
              <a
                href={data.shopify.adminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-medium text-ink hover:bg-surface-muted"
              >
                Open in Shopify <ExternalLink className="size-3.5" />
              </a>
            ) : null}
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
              {
                label: 'Shopify order ID',
                value: data.shopify.legacyId
                  ? <CopyValue value={data.shopify.legacyId} title={data.shopify.orderId} />
                  : '—',
              },
              { label: 'Sales channel', value: data.shopify.sourceName ? humanise(data.shopify.sourceName) : '—' },
              ...(data.shopify.confirmationNumber
                ? [{ label: 'Confirmation no.', value: <span className="font-mono">{data.shopify.confirmationNumber}</span> }]
                : []),
              ...(data.cancelledAt
                ? [{ label: 'Cancelled', value: `${fmtDateTime(data.cancelledAt)}${data.cancelReason ? ` · ${humanise(data.cancelReason)}` : ''}` }]
                : []),
              ...(data.closedAt ? [{ label: 'Closed', value: fmtDateTime(data.closedAt) }] : []),
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

      <CustomerPanels order={data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentCard order={data} />
        <DeliveryCard order={data} />
      </div>

      <FacilitySwitchHistory orderId={data.id} />

      {data.attributes.length > 0 ? (
        <Card>
          <CardHeader title="Order attributes" description="Extra fields captured at checkout." />
          <CardBody>
            <Attributes items={data.attributes} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`${data.lines.length} ${data.lines.length === 1 ? 'line' : 'lines'}`}
          description="What was bought, what is still owed, and how far production has taken it."
        />
        {data.lines.length === 0 ? (
          <EmptyState title="This order has no lines" description="Nothing was imported against it." />
        ) : (
          <ul className="divide-y divide-line">
            {data.lines.map((l) => <LineRow key={l.id} line={l} orderId={data.id} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LineRow({ line: l, orderId }: { line: Line; orderId: string }) {
  const owed = Number(l.manufacturingQty);
  return (
    <li className={`px-3.5 py-3 ${l.demand?.isRejectedForDispatch ? 'row-flag' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* The garment itself. A style number tells a system what this is; a
            picture tells a person. Greyed placeholder when the catalogue has
            no image, so the row keeps its shape. */}
        {l.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={l.imageUrl}
            alt={l.productName ?? l.sku ?? ''}
            loading="lazy"
            className="size-14 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : (
          <div className="grid size-14 shrink-0 place-items-center rounded-lg border border-line bg-surface-muted text-[12px] font-medium text-ink-subtle">
            no image
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px]">{l.sku ?? '—'}</span>
            {!l.isMapped ? <Badge tone="warn">unmapped</Badge> : null}
            {l.demand?.isRejectedForDispatch ? <Badge tone="danger">sent to production</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] font-medium text-ink">{l.productName ?? l.title ?? 'Unnamed'}</p>
          <p className="text-[12px] text-ink-muted">
            {[l.color, l.size].filter(Boolean).join(' · ') || '—'}
            {l.productId ? (
              <Link href={`/admin/products/${l.productId}`} className="ml-2 inline-flex items-center gap-0.5 font-medium text-ink hover:underline">
                View product <ArrowUpRight className="size-3" />
              </Link>
            ) : null}
          </p>
        </div>

        <div className="flex items-start gap-4">
        <dl className="flex gap-5 text-[12px]">
          <Figure label="Ordered" value={l.orderedQty} />
          <Figure label="Shipped" value={l.fulfilledQty} muted />
          {Number(l.cancelledQty) > 0 ? <Figure label="Cancelled" value={l.cancelledQty} struck /> : null}
          <Figure label="Still owed" value={l.manufacturingQty} strong={owed > 0} />
        </dl>
        <SwitchFacilityButton orderId={orderId} lineId={l.id} />
        </div>
      </div>

      {l.unicommerceItems.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
          <span className="font-medium text-ink-subtle">Unicommerce</span>
          {l.unicommerceItems.map((u) => (
            <span key={u.itemCode} title={`Item ${u.itemCode} · as of ${fmtDateTime(u.syncedAt)}`}>
              <span className="font-mono text-ink">{u.facilityCode ?? '—'}</span>
              {u.statusCode ? ` · ${humanise(u.statusCode)}` : ''}
            </span>
          ))}
          <span className="text-ink-subtle">as of {fmtDateTime(l.unicommerceItems[0]!.syncedAt)}</span>
        </div>
      ) : null}

      <ShopifyLineDetails line={l} />

      {l.demand ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
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
        <p className="mt-2.5 text-[12px] text-ink-subtle">
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
      <dt className="text-[12px] font-medium text-ink-subtle">{label}</dt>
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
      <p className="mb-2 text-[12px] font-medium text-ink-subtle">Production</p>
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
                <div className="truncate text-[12px] font-medium text-ink-muted" title={s.name}>
                  {s.name}
                </div>
                <div className="num font-display mt-0.5 text-[15px] font-semibold leading-none text-ink">
                  {fmtQty(String(wip), 0)}
                </div>
                <div className="mt-1.5 h-[3px] w-full bg-line">
                  <div
                    className={`h-full transition-[width] duration-700 ${wip > 0 ? 'bg-ink' : 'bg-line-strong'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 text-[12px] text-ink-subtle">
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

/* ------------------------------------------------------------ order detail */

function CustomerPanels({ order: o }: { order: Order }) {
  if (o.customerHidden) {
    return (
      <Card>
        <CardBody className="flex items-start gap-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
          <div>
            <p className="text-[13.5px] font-medium text-ink">Customer details are hidden</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Contact details and addresses need the &ldquo;See a customer&rsquo;s contact details&rdquo;
              permission. An administrator can grant it under Users &amp; roles.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const sameAddress =
    o.shippingAddress && o.billingAddress &&
    addressLines(o.shippingAddress).join('|') === addressLines(o.billingAddress).join('|');
  const email = o.contact?.email ?? o.customer?.email ?? null;
  const phone = o.contact?.phone ?? o.shippingAddress?.phone ?? o.customer?.phone ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader
          title="Customer"
          actions={o.customer?.adminUrl ? <ExternalAnchor href={o.customer.adminUrl} label="Shopify" /> : null}
        />
        <CardBody className="space-y-2.5 text-[13.5px]">
          <p className="font-medium text-ink">{o.customer?.name ?? o.customerRef ?? 'Guest checkout'}</p>
          {email ? (
            <a href={`mailto:${email}`} className="block truncate text-ink-muted hover:text-ink hover:underline">{email}</a>
          ) : null}
          {phone ? (
            <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className="block text-ink-muted hover:text-ink hover:underline">{phone}</a>
          ) : null}
          {!email && !phone ? <p className="text-ink-subtle">No contact details on the order.</p> : null}
          {o.customer?.numberOfOrders ? (
            <p className="text-[12.5px] text-ink-subtle">
              {o.customer.numberOfOrders} {o.customer.numberOfOrders === '1' ? 'order' : 'orders'} in Shopify
            </p>
          ) : null}
          {o.customer?.legacyId ? (
            <p className="text-[12.5px] text-ink-subtle">
              Customer ID <CopyValue value={o.customer.legacyId} title={o.customer.id ?? undefined} />
            </p>
          ) : null}
          {o.statusPageUrl ? (
            <p className="text-[12.5px]"><ExternalAnchor href={o.statusPageUrl} label="Customer's order status page" /></p>
          ) : null}
        </CardBody>
      </Card>
      <AddressCard title="Ship to" address={o.shippingAddress} empty="No shipping address — collected in store or a digital item." />
      <AddressCard
        title="Bill to"
        address={sameAddress ? null : o.billingAddress}
        empty={sameAddress ? 'Same as the shipping address.' : 'No billing address on the order.'}
      />
    </div>
  );
}

function addressLines(a: Address): string[] {
  const cityLine = [a.city, a.province, a.zip].filter(Boolean).join(', ');
  return [a.name, a.company, a.address1, a.address2, cityLine, a.country].filter((x): x is string => Boolean(x));
}

function AddressCard({ title, address, empty }: { title: string; address: Address | null; empty: string }) {
  const lines = address ? addressLines(address) : [];
  const copy = lines.join('\n') + (address?.phone ? `\n${address.phone}` : '');
  return (
    <Card>
      <CardHeader title={title} actions={lines.length > 0 ? <CopyButton value={copy} label={`Copy ${title.toLowerCase()} address`} /> : null} />
      <CardBody className="text-[13.5px]">
        {lines.length === 0 ? (
          <p className="text-ink-subtle">{empty}</p>
        ) : (
          <address className="not-italic leading-relaxed text-ink">
            {lines.map((line, i) => (
              <span key={i} className={`block ${i === 0 ? 'font-medium' : 'text-ink-muted'}`}>{line}</span>
            ))}
            {address?.phone ? <span className="mt-1 block text-ink-muted">{address.phone}</span> : null}
          </address>
        )}
      </CardBody>
    </Card>
  );
}

function PaymentCard({ order: o }: { order: Order }) {
  const m = o.money;
  const hasBreakdown = [m.subtotal, m.discounts, m.shipping, m.tax].some((v) => v !== null);
  const rows: { label: React.ReactNode; value: string | null; negative?: boolean; strong?: boolean }[] = [
    { label: 'Subtotal', value: m.subtotal },
    {
      label: (
        <span>
          Discounts
          {o.discountCodes.length > 0 ? (
            <span className="ml-1.5 font-mono text-[12px] text-ink-subtle">{o.discountCodes.join(', ')}</span>
          ) : null}
        </span>
      ),
      value: m.discounts && Number(m.discounts) !== 0 ? m.discounts : null,
      negative: true,
    },
    { label: o.shippingLines[0]?.title ? `Shipping · ${o.shippingLines[0].title}` : 'Shipping', value: m.shipping },
    ...(o.taxLines.length > 0
      ? o.taxLines.map((t) => ({
          label: `${t.title ?? 'Tax'}${t.rate !== null ? ` ${+(t.rate * 100).toFixed(2)}%` : ''}`,
          value: t.amount,
        }))
      : [{ label: 'Tax', value: m.tax }]),
    { label: 'Total', value: m.total ?? o.totalAmount, strong: true },
    ...(m.refunded && Number(m.refunded) !== 0 ? [{ label: 'Refunded', value: m.refunded, negative: true }] : []),
  ];

  return (
    <Card>
      <CardHeader
        title="Payment"
        description={o.financialStatus ? humanise(o.financialStatus) : undefined}
        actions={o.paymentGateways.map((g) => <Badge key={g} tone="outline">{humanise(g)}</Badge>)}
      />
      <CardBody>
        {hasBreakdown ? (
          <dl className="space-y-1.5 text-[13.5px]">
            {rows.filter((r) => r.value !== null).map((r, i) => (
              <div
                key={i}
                className={`flex items-baseline justify-between gap-4 ${r.strong ? 'mt-2 border-t border-line pt-2 font-semibold text-ink' : 'text-ink-muted'}`}
              >
                <dt className="min-w-0">{r.label}</dt>
                <dd className="num shrink-0 tabular-nums">{r.negative ? '−' : ''}{fmtMoney(r.value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="text-[13px] text-ink-muted">
            <p className="num text-[17px] font-semibold text-ink">{fmtMoney(m.total ?? o.totalAmount)}</p>
            <p className="mt-1">
              This order was imported before the price breakdown was collected. Refresh from Shopify to load it.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DeliveryCard({ order: o }: { order: Order }) {
  const tracked = o.fulfillments.filter((f) => f.status !== 'CANCELLED');
  return (
    <Card>
      <CardHeader
        title="Delivery"
        description={o.fulfillmentStatus ? humanise(o.fulfillmentStatus) : 'Not fulfilled yet'}
      />
      <CardBody className="space-y-3 text-[13.5px]">
        {o.shippingLines.length > 0 ? (
          <div>
            <p className="text-[12.5px] font-medium text-ink-subtle">Shipping method</p>
            {o.shippingLines.map((s, i) => (
              <p key={i} className="mt-0.5 flex justify-between gap-3 text-ink">
                <span className="min-w-0 truncate">{s.title ?? s.code ?? 'Shipping'}</span>
                <span className="num shrink-0 text-ink-muted">{fmtMoney(s.amount)}</span>
              </p>
            ))}
          </div>
        ) : null}
        {tracked.length === 0 ? (
          <p className="text-ink-subtle">No shipments yet. Tracking appears here once Shopify records a fulfilment.</p>
        ) : (
          <ul className="space-y-2">
            {tracked.map((f, i) => (
              <li key={i} className="rounded-xl border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                    <Truck className="size-3.5 text-ink-subtle" />
                    Shipment {tracked.length > 1 ? i + 1 : ''}
                  </span>
                  <span className="text-[12.5px] text-ink-subtle">
                    {f.status ? humanise(f.status) : ''}{f.createdAt ? ` · ${fmtDateTime(f.createdAt)}` : ''}
                  </span>
                </div>
                {f.tracking.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-ink-subtle">No tracking number.</p>
                ) : (
                  f.tracking.map((t, j) => (
                    <div key={j} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      {t.company ? <span className="text-ink-muted">{t.company}</span> : null}
                      {t.number ? <CopyValue value={t.number} /> : null}
                      {t.url ? <ExternalAnchor href={t.url} label="Track" /> : null}
                    </div>
                  ))
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** What Shopify knows about this line: its product, variant and price. */
function ShopifyLineDetails({ line: l }: { line: Line }) {
  const s = l.shopify;
  const discounted = s.discountedUnitPrice && s.unitPrice && Number(s.discountedUnitPrice) < Number(s.unitPrice);
  const options = s.options.filter((o) => o.value && o.name !== 'Title');
  const facts: { label: string; value: React.ReactNode }[] = [
    ...(s.productLegacyId ? [{ label: 'Product ID', value: <CopyValue value={s.productLegacyId} title={s.productId ?? undefined} /> }] : []),
    ...(s.variantLegacyId ? [{ label: 'Variant ID', value: <CopyValue value={s.variantLegacyId} title={s.variantId ?? undefined} /> }] : []),
    ...(s.barcode ? [{ label: 'Barcode', value: <CopyValue value={s.barcode} /> }] : []),
    ...(s.variantTitle && s.variantTitle !== 'Default Title' ? [{ label: 'Variant', value: s.variantTitle }] : []),
    ...options.map((o) => ({ label: o.name, value: o.value })),
    ...(s.vendor ? [{ label: 'Vendor', value: s.vendor }] : []),
    ...(s.productType ? [{ label: 'Type', value: s.productType }] : []),
    ...(s.unitPrice
      ? [{
          label: 'Unit price',
          value: discounted ? (
            <span>
              <span className="struck mr-1.5 text-ink-subtle">{fmtMoney(s.unitPrice)}</span>
              {fmtMoney(s.discountedUnitPrice)}
            </span>
          ) : fmtMoney(s.unitPrice),
        }]
      : []),
    ...(s.totalDiscount && Number(s.totalDiscount) > 0 ? [{ label: 'Line discount', value: `−${fmtMoney(s.totalDiscount)}` }] : []),
  ];
  if (facts.length === 0 && s.attributes.length === 0) return null;

  return (
    <div className="mt-2.5 rounded-xl border border-line px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-ink-subtle">
          Shopify{s.productTitle && s.productTitle !== (l.productName ?? l.title) ? ` · ${s.productTitle}` : ''}
        </p>
        {s.adminUrl ? <ExternalAnchor href={s.adminUrl} label="Open product" /> : null}
      </div>
      {facts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[12.5px] sm:grid-cols-3 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-ink-subtle">{f.label}</dt>
              <dd className="truncate text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.attributes.length > 0 ? (
        <div className="mt-2 border-t border-line pt-2">
          <Attributes items={s.attributes} />
        </div>
      ) : null}
    </div>
  );
}

function Attributes({ items }: { items: KeyValue[] }) {
  return (
    <dl className="grid gap-x-5 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
      {items.map((a, i) => (
        <div key={`${a.key}-${i}`} className="min-w-0">
          <dt className="text-ink-subtle">{a.key}</dt>
          <dd className="whitespace-pre-wrap break-words text-ink">{a.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExternalAnchor({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink hover:underline"
    >
      {label} <ExternalLink className="size-3" />
    </a>
  );
}

function useCopied(): [boolean, (value: string) => void] {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback((value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, []);
  return [copied, copy];
}

/** An identifier shown in full, copied with one click. */
function CopyValue({ value, title }: { value: string; title?: string }) {
  const [copied, copy] = useCopied();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title={title ? `${title} — click to copy` : 'Click to copy'}
      className="inline-flex max-w-full items-center gap-1 rounded font-mono text-[12.5px] text-ink hover:underline focus-visible:outline-2"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3 shrink-0 text-ok" /> : <Copy className="size-3 shrink-0 text-ink-subtle" />}
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, copy] = useCopied();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}
