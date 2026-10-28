'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Download, Lock, PlugZap } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtInt } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, LoadingBlock,
  PageHeader,
} from '@/components/ui/primitives';

interface Check { name: string; ok: boolean; detail: string }

interface ShopifyStatus {
  enabled: boolean; shopDomain: string; apiVersion: string;
  hasToken: boolean; isConfigured: boolean; missing: string[];
}
interface UcStatus {
  enabled: boolean; baseUrl: string; defaultFacility: string; hasCredentials: boolean;
  usesProxy: boolean; isPlaintextTransport: boolean; allowExternalWrites: boolean;
  isConfigured: boolean; missing: string[];
}
interface Facility {
  code: string; displayName: string | null; kind: string;
  probe: string; isVisible: boolean; enabled: boolean | null;
}

const key = () => crypto.randomUUID();

export default function IntegrationsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrations"
        description="Shopify brings demand in; Unicommerce holds the stock and fulfils. Both connectors are read-only — writing to an external system needs its own reviewed path."
      />
      <ShopifyPanel />
      <UnicommercePanel />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface ImportBatch {
  imported: number; pages: number; lineCount: number; skippedStale: number;
  unmappedSkuCount: number; hasMore: boolean; after: string | null;
}

/**
 * An import run of as many batches as it takes. Each batch is its own short
 * request (up to 2,000 orders), so a large backfill never hangs on one call,
 * shows progress, and can stop between batches and carry on later.
 */
function useOrderImport() {
  const [state, setState] = React.useState({
    running: false, done: false, batches: 0, imported: 0, lines: 0, skippedStale: 0, unmapped: 0,
    after: null as string | null, key: '', error: null as unknown,
  });
  const stopRef = React.useRef(false);

  const start = async ({ placedFrom, since }: { placedFrom: string; since: string }) => {
    const key = `${placedFrom}|${since}`;
    // Pressing Import again after a stop carries on from where it stopped.
    const resume = !state.done && state.after && state.key === key ? state.after : null;
    stopRef.current = false;
    setState((s) => (resume ? { ...s, running: true, error: null } : {
      running: true, done: false, batches: 0, imported: 0, lines: 0, skippedStale: 0, unmapped: 0, after: null, key, error: null,
    }));
    let after = resume;
    try {
      for (;;) {
        const r = await api.post<ImportBatch>('/integrations/shopify/orders/import', {
          pageSize: 100, maxPages: 20,
          ...(placedFrom ? { placedFrom } : {}),
          ...(since ? { since: `${since}T00:00:00+05:30` } : {}),
          ...(after ? { after } : {}),
        });
        after = r.after;
        setState((s) => ({
          ...s, batches: s.batches + 1, imported: s.imported + r.imported, lines: s.lines + r.lineCount,
          skippedStale: s.skippedStale + r.skippedStale, unmapped: Math.max(s.unmapped, r.unmappedSkuCount), after,
        }));
        if (!r.hasMore) { setState((s) => ({ ...s, running: false, done: true })); return; }
        if (stopRef.current) { setState((s) => ({ ...s, running: false })); return; }
      }
    } catch (error) {
      setState((s) => ({ ...s, running: false, error }));
    }
  };

  return { state, start, stop: () => { stopRef.current = true; } };
}

function ShopifyPanel() {
  const qc = useQueryClient();
  const [placedFrom, setPlacedFrom] = React.useState('');
  const [since, setSince] = React.useState('');
  const run = useOrderImport();

  const status = useQuery({
    queryKey: ['integrations', 'shopify', 'status'],
    queryFn: () => api.get<ShopifyStatus>('/integrations/shopify/status'),
  });

  const verify = useMutation({
    mutationFn: () => api.post<{ checks: Check[] }>('/integrations/shopify/verify', { idempotencyKey: key() }),
  });

  React.useEffect(() => {
    if (run.state.done) {
      void qc.invalidateQueries({ queryKey: ['shopify-orders'] });
      void qc.invalidateQueries({ queryKey: ['order-facets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    }
  }, [run.state.done, qc]);

  return (
    <Card>
      <CardHeader
        title="Shopify"
        description={status.data?.shopDomain || 'Not configured'}
        actions={<ConnectionBadge configured={status.data?.isConfigured} enabled={status.data?.enabled} />}
      />
      <CardBody className="space-y-3">
        {status.isLoading ? <LoadingBlock label="Reading configuration" /> : null}
        {status.error ? <ErrorPanel error={status.error} onRetry={() => void status.refetch()} /> : null}

        {status.data && !status.data.isConfigured ? (
          <Missing missing={status.data.missing} />
        ) : null}

        {status.data?.isConfigured ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
                <PlugZap /> {verify.isPending ? 'Checking…' : 'Test connection'}
              </Button>
              <Field label="Orders placed from" className="w-[170px]" hint="Every order placed on or after">
                <Input type="date" value={placedFrom} onChange={(e) => setPlacedFrom(e.target.value)} disabled={run.state.running} />
              </Field>
              <Field label="Or updated since" className="w-[170px]" hint="Only orders changed since">
                <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} disabled={run.state.running} />
              </Field>
              {run.state.running ? (
                <Button variant="default" onClick={run.stop}>Stop after this batch</Button>
              ) : (
                <Button variant="primary" onClick={() => run.start({ placedFrom, since })}>
                  <Download /> Import orders
                </Button>
              )}
            </div>

            <p className="text-[12px] text-ink-muted">
              {placedFrom
                ? 'Imports every order placed on or after that date, in batches until all are in. Orders already here are refreshed, never duplicated.'
                : since
                  ? 'Imports orders changed since that date — including older orders that were edited.'
                  : 'With no date, picks up where the last import stopped.'}
            </p>

            {verify.error ? <ErrorPanel error={verify.error} /> : null}
            {verify.data ? <Checks checks={verify.data.checks} /> : null}

            {run.state.error ? <ErrorPanel error={run.state.error} /> : null}
            {run.state.batches > 0 ? (
              <div className="rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12.5px]" aria-live="polite">
                {run.state.running ? 'Importing… ' : run.state.done ? 'Done. ' : 'Stopped. '}
                <span className="num font-medium">{fmtInt(run.state.imported)}</span> orders,{' '}
                <span className="num">{fmtInt(run.state.lines)}</span> lines in {run.state.batches}{' '}
                {run.state.batches === 1 ? 'batch' : 'batches'}.
                {run.state.skippedStale > 0 ? <> {fmtInt(run.state.skippedStale)} skipped as stale versions.</> : null}
                {!run.state.running && !run.state.done && run.state.after ? <> More remain — press Import orders to carry on.</> : null}
                {run.state.unmapped > 0 ? (
                  <div className="mt-1 text-warn">
                    {fmtInt(run.state.unmapped)} SKUs are not mapped to a product variant, so their demand cannot reach manufacturing yet.
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function UnicommercePanel() {
  const status = useQuery({
    queryKey: ['integrations', 'unicommerce', 'status'],
    queryFn: () => api.get<UcStatus>('/integrations/unicommerce/status'),
  });

  const verify = useMutation({
    mutationFn: () =>
      api.post<{ checks: Check[]; facilities: Facility[] }>('/integrations/unicommerce/verify', { idempotencyKey: key() }),
  });

  return (
    <Card>
      <CardHeader
        title="Unicommerce"
        description={status.data?.baseUrl || 'Not configured'}
        actions={<ConnectionBadge configured={status.data?.isConfigured} enabled={status.data?.enabled} />}
      />
      <CardBody className="space-y-3">
        {status.isLoading ? <LoadingBlock label="Reading configuration" /> : null}
        {status.error ? <ErrorPanel error={status.error} onRetry={() => void status.refetch()} /> : null}
        {status.data && !status.data.isConfigured ? <Missing missing={status.data.missing} /> : null}

        {status.data?.isPlaintextTransport ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[12px]">
            <span className="font-medium">This connection is plain HTTP.</span> Credentials cross the
            network in cleartext on every token refresh. Acceptable for development; it needs TLS or a
            whitelisted direct route before production.
          </p>
        ) : null}

        <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <Lock className="size-3.5 shrink-0" />
          Writes are disabled in the transport. Inventory push is Phase 5 and needs its own
          authorisation — this connector cannot change external stock even by mistake.
        </p>

        {status.data?.isConfigured ? (
          <>
            <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
              <PlugZap /> {verify.isPending ? 'Checking…' : 'Test connection'}
            </Button>
            {verify.error ? <ErrorPanel error={verify.error} /> : null}
            {verify.data ? (
              <>
                <Checks checks={verify.data.checks} />
                {verify.data.facilities?.length ? (
                  <Facilities facilities={verify.data.facilities} />
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function ConnectionBadge({ configured, enabled }: { configured?: boolean; enabled?: boolean }) {
  if (configured === undefined) return null;
  if (!configured) return <Badge tone="warn">Not configured</Badge>;
  if (!enabled) return <Badge tone="outline">Disabled</Badge>;
  return <Badge tone="ok">Enabled</Badge>;
}

function Missing({ missing }: { missing: string[] }) {
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12.5px]">
      Set {missing.map((m) => <code key={m} className="mx-0.5 font-mono text-[12px]">{m}</code>)} in the
      environment, then restart the API. Secrets are never shown here or sent to the browser.
    </div>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {checks.map((c) => (
        <li key={c.name} className="flex gap-2.5 px-3.5 py-2">
          {c.ok
            ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
            : <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium">{c.name}</div>
            <div className="text-[12px] text-ink-muted">{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Facilities({ facilities }: { facilities: Facility[] }) {
  const visible = facilities.filter((f) => f.isVisible);
  const hidden = facilities.filter((f) => !f.isVisible);
  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line bg-surface-muted px-3.5 py-2 text-[12px] font-medium text-ink-muted">
        Facilities — {visible.length} visible of {facilities.length}
      </div>
      <div className="scroll-x">
        <table className="w-full text-[12.5px]">
          <tbody>
            {visible.map((f) => (
              <tr key={f.code} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5 font-mono text-[12px]">{f.code}</td>
                <td className="px-3 py-1.5">{f.displayName}</td>
                <td className="px-3 py-1.5"><Badge tone="outline">{f.kind}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 ? (
        <p className="border-t border-line px-3.5 py-2 text-[12px] text-ink-muted">
          <span className="font-medium text-ink">{hidden.length} facilities are real but invisible</span> to
          this service account: {hidden.map((f) => f.code).join(', ')}. Any &ldquo;available
          elsewhere?&rdquo; search is partial until it can see them.
        </p>
      ) : null}
    </div>
  );
}
