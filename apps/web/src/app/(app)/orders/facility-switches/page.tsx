'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { useAuth } from '@/components/app/auth-context';
import { SwitchStatusBadge, type SwitchOperation } from '@/components/app/switch-facility';
import {
  Button, Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader,
} from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/tabs';

type Row = SwitchOperation & { orderName: string | null };

/**
 * Facility switches, and the two things only a person can finish: a switch
 * whose outcome Unicommerce never confirmed, and production to review after
 * one it did.
 */
export default function FacilitySwitchesPage() {
  const params = useSearchParams();
  const [tab, setTab] = React.useState<'open' | 'all'>(params.get('open') === 'true' ? 'open' : 'all');
  const q = useQuery({
    queryKey: ['facility-switches', tab],
    queryFn: () => api.get<Row[]>('/facility-switch/operations', tab === 'open' ? { open: 'true' } : undefined),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Facility switches"
        description="Requests to move an order item to another Unicommerce facility. A switch counts only once Unicommerce shows the item at its new facility."
        actions={<Button variant="ghost" onClick={() => void q.refetch()}><RefreshCw /> Refresh</Button>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open' as const, label: 'Needs a person' },
          { value: 'all' as const, label: 'All' },
        ]}
      />
      <Card>
        <CardHeader
          title={tab === 'open' ? 'Waiting on a person' : 'Recent switches'}
          description={tab === 'open'
            ? 'Unconfirmed outcomes first: do not switch these items again until each is resolved.'
            : 'The last 200 requests, newest first.'}
        />
        {q.isLoading ? <LoadingBlock label="Loading switches" />
          : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
          : !q.data?.length ? (
            <EmptyState
              title={tab === 'open' ? 'Nothing waiting' : 'No facility switches yet'}
              description={tab === 'open' ? 'Every switch has a confirmed outcome.' : 'Switch an item from an order, the fulfilment board or manufacturing demand.'}
            />
          ) : (
            <ul className="divide-y divide-line">
              {q.data.map((o) => <SwitchRow key={o.id} op={o} />)}
            </ul>
          )}
      </Card>
    </div>
  );
}

function SwitchRow({ op }: { op: Row }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [resolving, setResolving] = React.useState<null | 'PRODUCTION_REVIEWED' | 'CONFIRM_NOT_APPLIED'>(null);
  const [note, setNote] = React.useState('');
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['facility-switches'] });
    void qc.invalidateQueries({ queryKey: ['attention'] });
  };
  const verify = useMutation({
    mutationFn: () => api.post<SwitchOperation>(`/facility-switch/operations/${op.id}/verify`, {}),
    onSuccess: (r) => { toast.message(`Status: ${r.status.toLowerCase().replace(/_/g, ' ')}`); done(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Check failed'),
  });
  const resolve = useMutation({
    mutationFn: () => api.post<SwitchOperation>(`/facility-switch/operations/${op.id}/resolve`, { action: resolving, note }),
    onSuccess: (r) => {
      setResolving(null);
      toast.success(r.status === 'VERIFIED_SUCCESS' ? 'Production review recorded' : r.status === 'VERIFIED_FAILURE' ? 'Closed as not applied' : 'Unicommerce still does not confirm it');
      done();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resolve'),
  });
  const canAct = can('demand.switch_facility');

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
        <Link href={`/orders/${op.orderId}`} className="font-mono font-medium text-ink hover:underline">{op.orderName ?? op.saleOrderCode}</Link>
        <span className="font-mono text-ink">{op.sourceFacilityCode} → {op.targetFacilityCode}</span>
        <SwitchStatusBadge status={op.status} />
        <span className="text-ink-muted">{op.sku ?? op.saleOrderItemCode}</span>
        <span className="ml-auto text-ink-subtle">{op.operator.name ?? '—'} · {fmtDateTime(op.createdAt)} · <span className="font-mono">{op.reference}</span></span>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        {op.failure?.message ?? op.reason}
      </p>
      {op.reconciliation?.reasons?.length ? (
        <ul className="mt-1.5 list-disc pl-5 text-[12.5px] text-ink">
          {op.reconciliation.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : null}
      {op.reconciliation?.reviewedAt ? (
        <p className="mt-1 text-[12px] text-ink-subtle">Reviewed by {op.reconciliation.reviewedBy ?? '—'}: {op.reconciliation.note}</p>
      ) : null}

      {canAct && (op.status === 'VERIFICATION_PENDING' || op.status === 'RECONCILIATION_REQUIRED') ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {op.status === 'VERIFICATION_PENDING' ? (
            <>
              <Button size="sm" variant="default" loading={verify.isPending} onClick={() => verify.mutate()}>
                <RefreshCw /> Check status
              </Button>
              <Button size="sm" variant="elevated" onClick={() => { setResolving('CONFIRM_NOT_APPLIED'); setNote(''); }}>
                Confirm not applied
              </Button>
            </>
          ) : (
            <Button size="sm" variant="default" onClick={() => { setResolving('PRODUCTION_REVIEWED'); setNote(''); }}>
              Mark production reviewed
            </Button>
          )}
        </div>
      ) : null}

      {resolving ? (
        <div className="mt-2.5 rounded-xl border border-line bg-surface-muted p-3">
          <label className="block text-[12.5px] text-ink-muted" htmlFor={`note-${op.id}`}>
            {resolving === 'PRODUCTION_REVIEWED'
              ? 'What was decided for production? (kept, re-planned, cancelled by hand…)'
              : 'How did you confirm it was not applied? Unicommerce is read again first; this only closes the switch if the item is still at its source.'}
          </label>
          <textarea
            id={`note-${op.id}`}
            className="mt-1.5 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setResolving(null)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={note.trim().length < 5} loading={resolve.isPending} onClick={() => resolve.mutate()}>
              {resolving === 'PRODUCTION_REVIEWED' ? 'Record review' : 'Close as not applied'}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
