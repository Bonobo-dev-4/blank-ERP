'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CloudOff, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, LoadingBlock, PageHeader,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { BrandLogoCard } from '@/components/app/brand-logo-card';
import { useAuth } from '@/components/app/auth-context';
import { ConfirmDialog } from '@/components/ui/dialog';

interface Settings {
  organization: {
    id: string; code: string; name: string; timezone: string; currency: string;
    settings: Record<string, unknown>; status: string;
  };
  integrations: {
    id: string; provider: string; name: string; isEnabled: boolean; allowExternalWrites: boolean;
    apiVersion: string | null; healthStatus: string; lastHealthCheckAt: string | null;
    lastSyncAt: string | null; config: Record<string, unknown>;
  }[];
  documentSequences: { scope: string; prefix: string; padding: number; nextValue: number }[];
}

export default function SettingsPage() {
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/admin/settings'),
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Organisation configuration, integration status and document numbering." />

      <BrandLogoCard canEdit={can('admin.manage_settings')} />

      <Card>
        <CardHeader title="Organisation" />
        <CardBody>
          <DescList
            columns={4}
            items={[
              { label: 'Name', value: data.organization.name },
              { label: 'Code', value: <CodeCell>{data.organization.code}</CodeCell> },
              { label: 'Timezone', value: data.organization.timezone },
              { label: 'Currency', value: data.organization.currency },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Integrations"
          description="Connectors ship read-only. A Unicommerce write needs UC_WRITE_ENABLED in the environment, writes allowed here, and a person confirming each one. Shopify is never written to."
        />
        <ul className="divide-y divide-line">
          {data.integrations.map((i) => (
            <li key={i.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">{humanise(i.provider)}</span>
                <Badge tone={i.isEnabled ? 'ok' : 'neutral'}>{i.isEnabled ? 'enabled' : 'disabled'}</Badge>
                <Badge tone={i.allowExternalWrites ? 'warn' : 'outline'}>
                  {i.allowExternalWrites ? 'writes allowed' : 'read only'}
                </Badge>
                {i.apiVersion ? <Badge tone="outline">API {i.apiVersion}</Badge> : null}
                {can('admin.manage_settings') ? <WriteAccessToggle integration={i} /> : null}
                <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-muted">
                  {!i.isEnabled ? <CloudOff className="size-3.5" /> : null}
                  {humanise(i.healthStatus)}
                </span>
              </div>
              <DescList
                className="mt-2"
                columns={3}
                items={[
                  { label: 'Last health check', value: i.lastHealthCheckAt ? fmtDateTime(i.lastHealthCheckAt) : 'Never' },
                  { label: 'Last sync', value: i.lastSyncAt ? fmtDateTime(i.lastSyncAt) : 'Never' },
                  {
                    label: 'Configuration',
                    value: (
                      <code className="font-mono text-[12px] text-ink-muted">
                        {JSON.stringify(i.config)}
                      </code>
                    ),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
        <CardBody className="border-t border-line bg-surface-muted py-2.5">
          <p className="flex items-start gap-2 text-[12px] text-ink-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            Credentials are never stored in this database. The connection holds an opaque reference to a
            secret in the configured secret store, which is why this screen can show configuration without
            showing anything sensitive.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Document numbering"
          description="Gap-free per-organisation counters, allocated inside the same transaction as the document itself"
        />
        <div className="scroll-x">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                <th className="px-3 py-1.5 text-left font-semibold">Scope</th>
                <th className="px-3 py-1.5 text-left font-semibold">Prefix</th>
                <th className="px-3 py-1.5 text-right font-semibold">Padding</th>
                <th className="px-3 py-1.5 text-right font-semibold">Next number</th>
              </tr>
            </thead>
            <tbody>
              {data.documentSequences.map((s) => (
                <tr key={s.scope} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5">{humanise(s.scope)}</td>
                  <td className="px-3 py-1.5"><CodeCell>{s.prefix}</CodeCell></td>
                  <td className="num px-3 py-1.5 text-right text-ink-muted">{s.padding}</td>
                  <td className="num px-3 py-1.5 text-right">{s.nextValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.documentSequences.length === 0 ? (
          <CardBody className="text-[12.5px] text-ink-muted">
            No counters yet. They are created on demand when the first document of each kind is raised.
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * The per-connection write gate, switched by an administrator with a reason
 * that goes into the audit log. It never writes anything itself.
 */
function WriteAccessToggle({ integration: i }: { integration: Settings['integrations'][number] }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const allow = !i.allowExternalWrites;
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/integrations/${i.id}/write-access`, { allow, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(allow ? `${humanise(i.provider)} writes allowed` : `${humanise(i.provider)} is read-only again`);
      setOpen(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Not changed'),
  });
  const consequence = i.provider === 'UNICOMMERCE'
    ? allow
      ? 'People with the facility-switch permission will be able to move an order item to another Unicommerce facility. Each switch is checked live and confirmed by a person; nothing is sent on its own. UC_WRITE_ENABLED must also be true.'
      : 'Facility switches will be refused before anything is sent. Switches already waiting for verification can still be checked.'
    : allow
      ? 'This connector has no write path today; the flag only records the decision.'
      : 'The connector stays read-only.';
  return (
    <>
      <Button size="sm" variant={allow ? 'elevated' : 'ghost'} onClick={() => setOpen(true)}>
        {allow ? 'Allow writes' : 'Make read-only'}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={allow ? `Allow ${humanise(i.provider)} writes?` : `Make ${humanise(i.provider)} read-only?`}
        consequence={consequence}
        confirmLabel={save.isPending ? 'Saving…' : allow ? 'Allow writes' : 'Make read-only'}
        tone={allow ? 'danger' : 'primary'}
        loading={save.isPending}
        onConfirm={() => { if (reason.trim().length >= 5) save.mutate(); }}
      >
        <label className="block">
          <span className="mb-1 block text-[12.5px] text-ink-muted">Reason (kept in the audit log)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-ink"
            placeholder="e.g. Go-live for facility switching"
          />
          {reason.trim().length > 0 && reason.trim().length < 5 ? (
            <span className="mt-1 block text-[12px] text-danger">A few more words, please.</span>
          ) : null}
        </label>
      </ConfirmDialog>
    </>
  );
}
