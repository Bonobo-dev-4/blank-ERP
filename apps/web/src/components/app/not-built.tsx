import { Construction } from 'lucide-react';
import { navItemFor } from '@dnd/contracts';
import { Card } from '@/components/ui/primitives';

const PHASE_SCOPE: Record<number, string> = {
  1: 'Authentication, products, raw materials, fabric rolls, stock locations, the stock ledger, purchase orders and raw material GRN',
  2: 'BOM, MRP, material reservations, manufacturing orders and production planning',
  3: 'Barcode generation and scanning, cutting, embroidery, stitching, finishing, quality control and rework',
  4: 'Shopify orders, Unicommerce stock availability, order-line production routing, bulk PO imports and demand deduplication',
  5: 'Finished goods inward, GRN, Unicommerce inventory push and facility reconciliation',
  6: 'Forecasting, alerts, costing, advanced analytics and performance work',
};

/**
 * Placeholder for a module that genuinely does not exist yet.
 *
 * It states the phase and what that phase covers, rather than showing an empty
 * table that looks like a data problem. The specification asks for no dummy
 * interactions, and a screen that pretends to work is worse than one that
 * says it does not.
 */
export function NotBuiltYet({ href }: { href: string }) {
  const item = navItemFor(href);
  const phase = item?.phase ?? 2;

  return (
    <Card className="mx-auto max-w-2xl">
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Construction className="size-8 text-ink-subtle" />
        <h1 className="text-[16px] font-semibold text-ink">{item?.label ?? 'Not built yet'}</h1>
        <p className="max-w-lg text-[12.5px] text-ink-muted">
          This module is scheduled for <strong className="font-semibold text-ink">phase {phase}</strong> and
          has not been implemented. Nothing on this screen would reflect real data, so it is
          intentionally empty rather than showing placeholder figures.
        </p>
        <div className="mt-1 w-full max-w-lg rounded border border-line bg-surface-muted px-3 py-2 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            Phase {phase} scope
          </p>
          <p className="mt-1 text-[12.5px] text-ink">{PHASE_SCOPE[phase]}</p>
        </div>
        <p className="text-[11.5px] text-ink-subtle">
          The database schema, API contracts and business invariants for this module already exist -
          see <code className="font-mono">/docs/implementation-roadmap.md</code>.
        </p>
      </div>
    </Card>
  );
}
