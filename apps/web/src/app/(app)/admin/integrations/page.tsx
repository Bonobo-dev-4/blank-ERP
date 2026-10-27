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

function ShopifyPanel() {
  const qc = useQueryClient();
  const [limit, setLimit] = React.useState('50');
  const [since, setSince] = React.useState('');

  const status = useQuery({
    queryKey: ['integrations', 'shopify', 'status'],
    queryFn: () => api.get<ShopifyStatus>('/integrations/shopify/status'),
  });

  const verify = useMutation({
    mutationFn: () => api.post<{ checks: Check[] }>('/integrations/shopify/verify', { idempotencyKey: key() }),
  });

  const importOrders = useMutation({
    mutationFn: () =>
      api.post<{ imported: number; pages: number; lineCount: number; skippedStale: number; unmappedSkus: string[] }>(
        '/integrations/shopify/orders/import',
        { idempotencyKey: key(), limit: Number(limit) || 50, ...(since ? { since } : {}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shopify-orders'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

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
              <Field label="Orders per page" className="w-[130px]">
                <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
              </Field>
              <Field label="Updated since" className="w-[170px]" hint="Leave blank to backfill history">
                <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
              </Field>
              <Button variant="primary" onClick={() => importOrders.mutate()} disabled={importOrders.isPending}>
                <Download /> {importOrders.isPending ? 'Importing…' : 'Import orders'}
              </Button>
            </div>

            {!since ? (
              <p className="text-[12px] text-ink-muted">
                With no date, the importer walks forward from the oldest order — correct for a backfill,
                but it returns history rather than current demand. Set a date to pull recent orders.
              </p>
            ) : null}

            {verify.error ? <ErrorPanel error={verify.error} /> : null}
            {verify.data ? <Checks checks={verify.data.checks} /> : null}

            {importOrders.error ? <ErrorPanel error={importOrders.error} /> : null}
            {importOrders.data ? (
              <div className="rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12.5px]">
                Imported <span className="num font-medium">{fmtInt(importOrders.data.imported)}</span> orders
                across {importOrders.data.pages} {importOrders.data.pages === 1 ? 'page' : 'pages'},{' '}
                <span className="num">{fmtInt(importOrders.data.lineCount)}</span> lines.
                {importOrders.data.skippedStale > 0 ? (
                  <> {importOrders.data.skippedStale} skipped as stale versions.</>
                ) : null}
                {importOrders.data.unmappedSkus.length > 0 ? (
                  <div className="mt-1 text-warn">
                    {importOrders.data.unmappedSkus.length} SKUs are not mapped to a product variant, so
                    their demand cannot reach manufacturing yet.
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
