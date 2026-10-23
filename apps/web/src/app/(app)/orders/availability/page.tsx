'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PackageSearch, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Field, Input,
  LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';

interface Reading {
  sku: string; facilityCode: string;
  sellableQty: string; committedQty: string; heldQty: string; availableQty: string;
}
interface Search {
  sku: string;
  search: {
    found: { facilityCode: string; availableQty: string }[];
    unchecked: string[];
    totalAvailable: string;
    isComplete: boolean;
  };
  readings: Reading[];
}
interface UcStatus { isConfigured: boolean; enabled: boolean; missing: string[] }

export default function AvailabilityPage() {
  const [sku, setSku] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');

  const status = useQuery({
    queryKey: ['integrations', 'unicommerce', 'status'],
    queryFn: () => api.get<UcStatus>('/integrations/unicommerce/status'),
  });

  const search = useMutation({
    mutationFn: (q: string) =>
      api.get<Search>(`/integrations/unicommerce/availability?sku=${encodeURIComponent(q)}`),
  });

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    const q = sku.trim();
    if (!q) return;
    setSubmitted(q);
    search.mutate(q);
  };

  const ready = status.data?.isConfigured && status.data?.enabled;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock availability"
        description="Is the piece sitting somewhere already? Asked of Unicommerce, which holds the stock — if it is on a shelf in a shop, that is a dispatch, not a production order."
      />

      {status.data && !ready ? (
        <EmptyState
          title="Unicommerce is not connected"
          description={
            status.data.missing.length
              ? `Set ${status.data.missing.join(', ')} in the environment and restart the API.`
              : 'Enable the connector to search facility stock.'
          }
        />
      ) : null}

      {ready ? (
        <Card>
          <CardHeader
            title="Find a SKU"
            description="Searches every configured facility one at a time, so a wide search takes a few seconds."
          />
          <CardBody>
            <form onSubmit={run} className="flex flex-wrap items-end gap-3">
              <Field label="Unicommerce SKU" className="min-w-[280px] flex-1">
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="e.g. W/2769-L-49295244427434"
                  autoComplete="off"
                />
              </Field>
              <Button type="submit" disabled={!sku.trim() || search.isPending}>
                <PackageSearch /> {search.isPending ? 'Searching…' : 'Search facilities'}
              </Button>
            </form>
            <p className="mt-2 text-[11.5px] text-ink-muted">
              This is the Unicommerce item SKU, which usually ends in the Shopify variant id.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {search.isPending ? <LoadingBlock label={`Checking facilities for ${submitted}`} /> : null}
      {search.error ? <ErrorPanel error={search.error} /> : null}

      {search.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat
              label="Available"
              value={fmtQty(search.data.search.totalAvailable, 0)}
              tone={Number(search.data.search.totalAvailable) > 0 ? 'ok' : 'warn'}
              hint={Number(search.data.search.totalAvailable) > 0 ? 'Can be dispatched' : 'Nothing free to ship'}
            />
            <Stat label="Facilities holding it" value={String(search.data.search.found.length)} hint="With stock free to promise" />
            <Stat
              label="Not checked"
              value={String(search.data.search.unchecked.length)}
              tone={search.data.search.isComplete ? 'ok' : 'warn'}
              hint={search.data.search.isComplete ? 'Every facility answered' : 'Invisible to this account'}
            />
          </div>

          {!search.data.search.isComplete ? (
            <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12px]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                <span className="font-medium">This search is incomplete.</span> The service account
                cannot see {search.data.search.unchecked.join(', ')}. Do not read &ldquo;not available&rdquo;
                as &ldquo;not available anywhere&rdquo; until it can.
              </span>
            </p>
          ) : null}

          <Card>
            <CardHeader
              title={`Facility stock for ${search.data.sku}`}
              description="Held stock is physically in the building but not sellable — blocked, quarantined, or awaiting a count. It is shown because zero available and six units in limbo are different problems."
            />
            {search.data.readings.length === 0 ? (
              <EmptyState title="No facility answered for this SKU" description="Check the SKU spelling, or whether it exists in Unicommerce." />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Facility</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Sellable</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Committed</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Held</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {search.data.readings.map((r) => (
                      <tr key={r.facilityCode} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">{r.facilityCode}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(r.sellableQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(r.committedQty, 0)}</td>
                        <td className={`num px-3 py-1.5 text-right ${Number(r.heldQty) > 0 ? 'text-warn' : 'text-ink-subtle'}`}>
                          {fmtQty(r.heldQty, 0)}
                        </td>
                        <td className={`num px-3 py-1.5 text-right font-semibold ${Number(r.availableQty) > 0 ? 'text-ok' : 'text-ink-subtle'}`}>
                          {fmtQty(r.availableQty, 0)}
                        </td>
                      </tr>
                    ))}
                    {search.data.search.unchecked.map((f) => (
                      <tr key={f} className="border-b border-line last:border-0 opacity-55">
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">{f}</td>
                        <td colSpan={4} className="px-3 py-1.5 text-right text-[11.5px] text-ink-subtle">
                          <Badge tone="outline">could not check</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
