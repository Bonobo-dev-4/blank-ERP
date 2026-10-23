'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Factory, HelpCircle, PackageCheck, RotateCcw, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Input,
  LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';

type Route = 'DISPATCH' | 'SWITCH_FACILITY' | 'MANUFACTURE' | 'NEEDS_CHECK';

interface Line {
  demandId: string; demandNo: string; orderRef: string | null; channel: string;
  sku: string; productName: string | null; size: string | null; color: string | null;
  isMapped: boolean; status: string; priority: string; requiredByDate: string | null;
  openQty: string; route: Route;
  dispatchQty: string; switchQty: string; manufactureQty: string;
  switchFromFacility: string | null; reason: string; isProvisional: boolean;
  isRejectedForDispatch: boolean; rejectedReason: string | null; homeAvailableQty: string;
}
interface Board {
  home: string; stockChecked: boolean;
  facilitiesChecked: string[]; facilitiesUnreadable: string[]; isSearchComplete?: boolean;
  tally: { dispatch: number; switchFacility: number; manufacture: number; needsCheck: number };
  lines: Line[];
}

const TABS: { route: Route; label: string; icon: typeof PackageCheck; blurb: string }[] = [
  {
    route: 'DISPATCH', label: 'Omni', icon: PackageCheck,
    blurb: 'Stock is already at the home facility. Ship it — no production needed.',
  },
  {
    route: 'SWITCH_FACILITY', label: 'Switch facility', icon: ArrowLeftRight,
    blurb: 'Not here, but a shop or warehouse elsewhere has it. Moving a finished garment beats making one.',
  },
  {
    route: 'MANUFACTURE', label: 'Production', icon: Factory,
    blurb: 'Nowhere has it, or an operator rejected the stock that does. These have to be made.',
  },
  {
    route: 'NEEDS_CHECK', label: 'Needs check', icon: HelpCircle,
    blurb: 'Some facilities could not be read, so "not found" is not "does not exist". Confirm before cutting fabric.',
  },
];

export default function FulfilmentBoardPage() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Route>('DISPATCH');
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['fulfilment-board'],
    queryFn: () => api.get<Board>('/fulfilment/board?limit=200'),
    staleTime: 60_000,
  });

  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api.post(`/fulfilment/demand/${v.id}/reject`, { reason: v.reason }),
    onSuccess: () => {
      setRejecting(null); setReason('');
      void qc.invalidateQueries({ queryKey: ['fulfilment-board'] });
    },
  });

  const unreject = useMutation({
    mutationFn: (id: string) => api.post(`/fulfilment/demand/${id}/unreject`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fulfilment-board'] }),
  });

  const lines = (data?.lines ?? []).filter((l) => l.route === tab);
  const count = (r: Route) => ({
    DISPATCH: data?.tally.dispatch, SWITCH_FACILITY: data?.tally.switchFacility,
    MANUFACTURE: data?.tally.manufacture, NEEDS_CHECK: data?.tally.needsCheck,
  }[r] ?? 0);
  const active = TABS.find((t) => t.route === tab)!;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fulfilment board"
        description="Every open line, routed to the cheapest way of satisfying it. Dispatching a garment that already exists costs a courier; making the same garment costs fabric, labour and three weeks."
        actions={
          <Button size="sm" variant="default" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? 'Checking stock…' : 'Re-check stock'}
          </Button>
        }
      />

      {isLoading ? <LoadingBlock label="Reading stock across facilities" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {TABS.map((t) => (
              <button key={t.route} onClick={() => setTab(t.route)} className="text-left">
                <Stat
                  label={t.label}
                  value={String(count(t.route))}
                  tone={
                    t.route === 'DISPATCH' ? 'ok'
                      : t.route === 'NEEDS_CHECK' && count(t.route) > 0 ? 'warn'
                      : undefined
                  }
                  hint={t.route === tab ? 'Showing' : 'Click to show'}
                />
              </button>
            ))}
          </div>

          {!data.isSearchComplete ? (
            <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12px]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                <span className="font-medium">Stock was read from {data.facilitiesChecked.length} of 17 facilities.</span>{' '}
                {data.facilitiesUnreadable.length > 0
                  ? `Could not read ${data.facilitiesUnreadable.join(', ')}. `
                  : ''}
                Lines that would otherwise go to production are held in{' '}
                <button className="font-medium underline" onClick={() => setTab('NEEDS_CHECK')}>Needs check</button>{' '}
                instead, because a garment may be sitting in a facility nobody could ask.
              </span>
            </p>
          ) : null}

          <Card>
            <CardHeader
              title={active.label}
              description={active.blurb}
              actions={
                <div className="flex flex-wrap gap-1.5">
                  {TABS.map((t) => (
                    <button
                      key={t.route}
                      onClick={() => setTab(t.route)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11.5px] font-medium transition-colors ${
                        t.route === tab ? 'bg-brand text-white' : 'text-ink-muted hover:bg-surface-muted'
                      }`}
                    >
                      <t.icon className="size-3.5" />
                      {t.label} <span className="num opacity-70">{count(t.route)}</span>
                    </button>
                  ))}
                </div>
              }
            />

            {lines.length === 0 ? (
              <EmptyState
                title={`Nothing in ${active.label.toLowerCase()}`}
                description={
                  tab === 'DISPATCH'
                    ? 'No open line has stock at the home facility right now.'
                    : tab === 'MANUFACTURE'
                    ? 'Nothing needs making — every open line can be satisfied from stock.'
                    : tab === 'NEEDS_CHECK'
                    ? 'Every facility answered, so no line is in doubt.'
                    : 'No line can be satisfied by moving stock between facilities.'
                }
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Order</th>
                      <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Open</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Here</th>
                      {tab === 'SWITCH_FACILITY' ? <th className="px-3 py-1.5 text-left font-semibold">From</th> : null}
                      <th className="px-3 py-1.5 text-left font-semibold">Why</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Needed</th>
                      <th className="px-3 py-1.5 text-right font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <React.Fragment key={l.demandId}>
                        <tr className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[11.5px]">{l.orderRef ?? l.demandNo}</span>
                            <div className="text-[11px] text-ink-subtle">{humanise(l.channel)}</div>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[11.5px]">{l.sku}</span>
                            {!l.isMapped ? <Badge tone="warn" className="ml-2">unmapped</Badge> : null}
                            {l.productName ? (
                              <div className="text-[11px] text-ink-muted">
                                {l.productName}
                                {l.size ? <span className="ml-1.5 text-ink-subtle">{l.size}</span> : null}
                              </div>
                            ) : null}
                          </td>
                          <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(l.openQty, 0)}</td>
                          <td className={`num px-3 py-1.5 text-right ${Number(l.homeAvailableQty) > 0 ? 'text-ok' : 'text-ink-subtle'}`}>
                            {fmtQty(l.homeAvailableQty, 0)}
                          </td>
                          {tab === 'SWITCH_FACILITY' ? (
                            <td className="px-3 py-1.5 font-mono text-[11.5px]">{l.switchFromFacility ?? '—'}</td>
                          ) : null}
                          <td className="px-3 py-1.5 text-[11.5px] text-ink-muted">
                            {l.isRejectedForDispatch ? (
                              <span className="text-warn">Rejected: {l.rejectedReason}</span>
                            ) : l.reason}
                          </td>
                          <td className="px-3 py-1.5 text-ink-muted">
                            {l.requiredByDate ? fmtDate(l.requiredByDate) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {l.isRejectedForDispatch ? (
                              <Button size="sm" variant="ghost" onClick={() => unreject.mutate(l.demandId)} disabled={unreject.isPending}>
                                <RotateCcw /> Undo
                              </Button>
                            ) : l.route === 'DISPATCH' || l.route === 'SWITCH_FACILITY' ? (
                              <Button size="sm" variant="default" onClick={() => { setRejecting(l.demandId); setReason(''); }}>
                                Send to production
                              </Button>
                            ) : null}
                          </td>
                        </tr>

                        {rejecting === l.demandId ? (
                          <tr className="border-b border-line bg-surface-muted">
                            <td colSpan={8} className="px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[12px] text-ink">
                                  Why can&rsquo;t {l.sku} be dispatched?
                                </span>
                                <Input
                                  autoFocus
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  placeholder="Damaged, shade mismatch, customisation…"
                                  className="h-7 min-w-[260px] flex-1"
                                />
                                <Button
                                  size="sm"
                                  onClick={() => reject.mutate({ id: l.demandId, reason })}
                                  disabled={!reason.trim() || reject.isPending}
                                >
                                  {reject.isPending ? 'Saving…' : 'Confirm'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                              </div>
                              <p className="mt-1.5 text-[11px] text-ink-muted">
                                This overrides available stock and sends the line to production, so the
                                reason is kept on the record.
                              </p>
                              {reject.error ? <div className="mt-2"><ErrorPanel error={reject.error} /></div> : null}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.stockChecked ? (
              <CardBody className="text-[11px] text-ink-subtle">
                Stock read from {data.facilitiesChecked.length} facilities in one call each — the
                inventory API takes a list of SKUs, so the whole board costs about seventeen requests
                however many lines it holds.
              </CardBody>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
