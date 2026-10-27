'use client';

import Link from 'next/link';
import { ArrowUpRight, FileUp, Lock } from 'lucide-react';
import { IMPORT_SPECS, IMPORT_TYPES, MAX_IMPORT_ROWS, type ImportType } from '@dnd/contracts';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { CsvImportButton } from '@/components/app/csv-import';
import { useAuth } from '@/components/app/auth-context';

/** Where each import's records live, so a person can go and look afterwards. */
const SCREEN: Record<ImportType, { href: string; label: string }> = {
  'raw-materials': { href: '/materials', label: 'Raw Material Master' },
  suppliers: { href: '/purchasing/suppliers', label: 'Vendor Management' },
  locations: { href: '/admin/locations', label: 'Locations' },
  products: { href: '/admin/products', label: 'Product Master' },
  'product-mappings': { href: '/admin/mappings', label: 'SKU Mappings' },
  'stock-adjustments': { href: '/inventory/adjustments', label: 'Stock Adjustments' },
};

/**
 * Every CSV import in one place.
 *
 * The same dialog also sits on each record's own screen. Here, a person sees
 * only the imports their role allows — an import can never do more than they
 * could do by hand on that screen.
 */
export default function ImportsPage() {
  const { can } = useAuth();
  const allowed = IMPORT_TYPES.filter((t) => can(IMPORT_SPECS[t].permission));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data Import"
        description={`Create and update records in bulk from a CSV file. Each import shows what every row will do before anything is saved, and saves nothing if any row has a problem. Up to ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows per file.`}
      />

      {allowed.length === 0 ? (
        <Card>
          <EmptyState
            icon={Lock}
            title="No imports available to your role"
            description="Each import needs the same permission as editing those records by hand. Ask an administrator if you need one."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {allowed.map((t) => {
            const spec = IMPORT_SPECS[t];
            const required = spec.columns.filter((c) => c.required === 'always').map((c) => c.label);
            return (
              <Card key={t} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="glass-inset grid size-9 shrink-0 place-items-center rounded-full">
                    <FileUp className="size-4 text-ink-muted" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="t-card-title text-ink">{spec.label}</h2>
                    <p className="mt-0.5 text-[13px] text-ink-muted">{spec.description}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-1 text-[12.5px]">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-ink-subtle">Matched by</dt>
                    <dd className="text-ink">{spec.mode === 'append' ? 'Each row is a new adjustment' : spec.keyColumns.map((k) => spec.columns.find((c) => c.key === k)?.label ?? k).join(' + ')}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-ink-subtle">Required</dt>
                    <dd className="text-ink">{required.join(', ')}</dd>
                  </div>
                </dl>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                  <CsvImportButton type={t} />
                  <Link href={SCREEN[t].href} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-brand-strong hover:bg-brand-soft">
                    {SCREEN[t].label} <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
