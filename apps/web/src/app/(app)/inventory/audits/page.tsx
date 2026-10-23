'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Field, Label,
  LoadingBlock, NativeSelect, PageHeader, QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';

interface CountRow {
  id: string; countNo: string; status: string;
  location: { id: string; code: string; name: string; kind: string };
  lineCount: number; netVarianceQty: string;
  countedAt: string | null; postedAt: string | null; createdAt: string; remarks: string | null;
}
interface CountLine {
  id: string; rawMaterialId: string; materialCode: string; materialName: string;
  baseUom: string; lotId: string; lotNo: string | null;
  systemQty: string; countedQty: string; varianceQty: string; reason: string | null; isPosted: boolean;
}
interface CountDetail {
  id: string; countNo: string; status: string;
  location: { id: string; code: string; name: string; kind: string };
  lines: CountLine[]; countedAt: string | null; postedAt: string | null; remarks: string | null;
}
interface Location { id: string; code: string; name: string; kind: string }

const key = () => crypto.randomUUID();

export default function StockAuditsPage() {
  const [openId, setOpenId] = React.useState<string | null>(null);
  return openId
    ? <CountSheet id={openId} onBack={() => setOpenId(null)} />
    : <CountList onOpen={setOpenId} />;
}

/* -------------------------------------------------------------------------- */

function CountList({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [locationId, setLocationId] = React.useState('');
  const [remarks, setRemarks] = React.useState('');

  const counts = useQuery({
    queryKey: ['stock-counts'],
    queryFn: () => api.get<CountRow[]>('/inventory/counts'),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    // No .catch here: swallowing this would show an empty dropdown and look
    // like "no countable locations" rather than a failed request.
    queryFn: () => api.get<Location[]>('/locations'),
  });

  const open = useMutation({
    mutationFn: () =>
      api.post<{ result: { id: string } } | { id: string }>('/inventory/counts', {
        idempotencyKey: key(), locationId, remarks: remarks || undefined,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['stock-counts'] });
      const id = 'result' in r ? r.result.id : r.id;
      setRemarks('');
      onOpen(id);
    },
  });

  const countable = (locations.data ?? []).filter((l) => l.kind !== 'SINK' && l.kind !== 'COUNTERPARTY');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock audits"
        description="Count what is physically on the shelf and post the difference. The system figure is frozen when the count opens, so stock legitimately issued while you walk the aisle does not show up as a discrepancy."
      />

      <Card>
        <CardHeader title="Open a count" description="Pick a location. Everything with a recorded balance there becomes a line." />
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Location" className="min-w-[220px]">
              <NativeSelect id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose a location…</option>
                {countable.map((l) => (
                  <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Note" className="min-w-[260px] flex-1">
              <Textarea id="rem" rows={1} value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder="Why this count is being run" />
            </Field>
            <Button onClick={() => open.mutate()} disabled={!locationId || open.isPending}>
              <ClipboardCheck /> {open.isPending ? 'Opening…' : 'Open count'}
            </Button>
          </div>
          {locations.error ? <div className="mt-3"><ErrorPanel error={locations.error} /></div> : null}
          {locations.data && countable.length === 0 ? (
            <p className="mt-2 text-[12px] text-ink-muted">
              No countable locations are available. System locations such as the consumption sink
              cannot be counted — nobody can walk to one.
            </p>
          ) : null}
          {open.error ? <div className="mt-3"><ErrorPanel error={open.error} /></div> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Counts" />
        {counts.isLoading ? <LoadingBlock label="Loading counts" /> : null}
        {counts.error ? <ErrorPanel error={counts.error} onRetry={() => void counts.refetch()} /> : null}
        {counts.data && counts.data.length === 0 ? (
          <EmptyState title="No counts yet" description="Open one above to start auditing a location." />
        ) : null}
        {counts.data && counts.data.length > 0 ? (
          <div className="scroll-x">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-1.5 text-left font-semibold">Count</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Location</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Lines</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Net variance</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Opened</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {counts.data.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[11.5px]">{c.countNo}</td>
                    <td className="px-3 py-1.5">{c.location.code} <span className="text-ink-muted">{c.location.name}</span></td>
                    <td className="px-3 py-1.5"><StatusBadge status={c.status} /></td>
                    <td className="num px-3 py-1.5 text-right">{c.lineCount}</td>
                    <td className={`num px-3 py-1.5 text-right ${Number(c.netVarianceQty) !== 0 ? 'font-medium text-warn' : 'text-ink-subtle'}`}>
                      {Number(c.netVarianceQty) > 0 ? '+' : ''}{fmtQty(c.netVarianceQty)}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{fmtDateTime(c.createdAt)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="default" onClick={() => onOpen(c.id)}>
                        {c.status === 'POSTED' ? 'View' : 'Count'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CountSheet({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('Cycle count variance');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stock-count', id],
    queryFn: () => api.get<CountDetail>(`/inventory/counts/${id}`),
  });

  const record = useMutation({
    mutationFn: () =>
      api.post(`/inventory/counts/${id}/record`, {
        idempotencyKey: key(),
        lines: Object.entries(edits).map(([lineId, countedQty]) => ({ lineId, countedQty })),
      }),
    onSuccess: () => { setEdits({}); void refetch(); void qc.invalidateQueries({ queryKey: ['stock-counts'] }); },
  });

  const post = useMutation({
    mutationFn: () => api.post(`/inventory/counts/${id}/post`, { idempotencyKey: key(), reason }),
    onSuccess: () => {
      void refetch();
      void qc.invalidateQueries({ queryKey: ['stock-counts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (isLoading) return <LoadingBlock label="Loading the count sheet" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const editable = data.status === 'DRAFT' || data.status === 'COUNTED';
  const varying = data.lines.filter((l) => Number(l.varianceQty) !== 0);
  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> All counts</Button>
      </div>

      <PageHeader
        title={`Count ${data.countNo}`}
        description={`${data.location.code} — ${data.location.name}. The system figure was frozen when this count opened.`}
        actions={<StatusBadge status={data.status} />}
      />

      {data.status === 'POSTED' ? (
        <p className="rounded-lg border border-ok/30 bg-ok-soft px-3.5 py-2.5 text-[12.5px]">
          Posted {data.postedAt ? fmtDateTime(data.postedAt) : ''}. Each varying line became a ledger
          adjustment. To correct it, run another count — posted counts are not edited.
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Count sheet"
          description={editable
            ? 'Enter what you physically counted. Lines you do not touch are treated as agreeing with the system, not as zero.'
            : 'This count is closed.'}
          actions={editable ? (
            <Button size="sm" onClick={() => record.mutate()} disabled={!dirty || record.isPending}>
              {record.isPending ? 'Saving…' : `Save ${Object.keys(edits).length || ''} ${dirty ? 'counted' : 'counts'}`}
            </Button>
          ) : null}
        />
        <div className="scroll-x">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                <th className="px-3 py-1.5 text-left font-semibold">Lot</th>
                <th className="px-3 py-1.5 text-right font-semibold">System</th>
                <th className="px-3 py-1.5 text-right font-semibold">Counted</th>
                <th className="px-3 py-1.5 text-right font-semibold">Variance</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => {
                const value = edits[l.id] ?? l.countedQty;
                const variance = Number(value) - Number(l.systemQty);
                return (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-[11.5px]">{l.materialCode}</span>
                      <span className="ml-2 text-ink-muted">{l.materialName}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-ink-muted">{l.lotNo ?? '—'}</td>
                    <td className="num px-3 py-1.5 text-right text-ink-muted">
                      {fmtQty(l.systemQty)} {uomShort(l.baseUom)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {editable ? (
                        <QtyInput
                          aria-label={`Counted quantity for ${l.materialCode}`}
                          className="ml-auto h-7 w-28 text-right"
                          value={value}
                          onChange={(e) => setEdits({ ...edits, [l.id]: e.target.value })}
                        />
                      ) : (
                        <span className="num">{fmtQty(l.countedQty)}</span>
                      )}
                    </td>
                    <td className={`num px-3 py-1.5 text-right font-medium ${variance === 0 ? 'text-ink-subtle' : variance > 0 ? 'text-ok' : 'text-danger'}`}>
                      {variance > 0 ? '+' : ''}{variance === 0 ? '0' : variance.toFixed(2)}
                      {l.isPosted ? <Badge tone="outline" className="ml-2">posted</Badge> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {record.error ? <CardBody><ErrorPanel error={record.error} /></CardBody> : null}
      </Card>

      {data.status === 'COUNTED' ? (
        <Card>
          <CardHeader
            title="Post the variances"
            description={`${varying.length} ${varying.length === 1 ? 'line differs' : 'lines differ'} from the system. Posting raises one ledger adjustment per differing line — lines that agree post nothing.`}
          />
          <CardBody>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Reason" className="min-w-[280px] flex-1" required>
                <Textarea id="reason" rows={1} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button
                onClick={() => post.mutate()}
                disabled={post.isPending || varying.length === 0 || reason.trim().length === 0}
              >
                {post.isPending ? 'Posting…' : `Post ${varying.length} adjustment${varying.length === 1 ? '' : 's'}`}
              </Button>
            </div>
            {varying.length === 0 ? (
              <p className="mt-2 text-[12px] text-ok">
                Everything agrees with the system. There is nothing to post.
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-ink-muted">
                This changes stock. Each adjustment is written to the ledger with this reason attached.
              </p>
            )}
            {post.error ? <div className="mt-3"><ErrorPanel error={post.error} /></div> : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
