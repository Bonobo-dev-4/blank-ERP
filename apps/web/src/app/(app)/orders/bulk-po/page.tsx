'use client';

import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/primitives';

/**
 * Unicommerce bulk purchase orders.
 *
 * Deliberately not a table of nothing. This tenant does not expose a purchase
 * order READ endpoint to the service account — six documented paths were
 * probed against the live API on 23 Oct 2026 and every one returned 404, while
 * `purchaseOrder/create` responded. Showing an empty grid would imply "no bulk
 * orders exist", which is a different and false statement from "this system
 * cannot be asked".
 */
export default function BulkPoPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Unicommerce bulk POs"
        description="Wholesale and bulk purchase orders raised in Unicommerce."
      />

      <Card>
        <CardHeader
          title="Not available on this tenant"
          description="Verified against the live API, not assumed."
        />
        <CardBody className="space-y-3 text-[12.5px]">
          <p className="flex items-start gap-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
            <span>
              Unicommerce does not expose a purchase-order <strong>read</strong> endpoint to this
              service account. Six documented paths were probed against the live tenant and every one
              returned <code className="font-mono text-[11.5px]">404</code>, while the create endpoint
              responded normally — so the capability is missing or not permitted, rather than the
              account simply having no bulk orders.
            </span>
          </p>
          <p className="text-ink-muted">
            An empty table here would read as &ldquo;no bulk orders exist&rdquo;. That is a different
            claim from &ldquo;this system cannot be asked&rdquo;, and only the second one is true.
          </p>
          <div className="rounded-lg border border-line bg-surface-muted px-3.5 py-2.5">
            <p className="font-medium">To enable this screen</p>
            <p className="mt-1 text-ink-muted">
              Ask Unicommerce to grant the purchase-order read scope to the integration account, or
              confirm which document type actually carries bulk manufacturing demand for this
              business. That question is still open in the integration notes.
            </p>
          </div>
          <p className="text-ink-muted">
            In the meantime, marketplace orders from Nykaa and Myntra do arrive through the sale-order
            feed and are visible under{' '}
            <Link href="/orders" className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline">
              all orders <ArrowUpRight className="size-3" />
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
