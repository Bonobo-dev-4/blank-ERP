import { Injectable } from '@nestjs/common';
import { Decimal, dec, reconcile } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UnicommerceClient } from '../integrations/unicommerce.client';
import { UnicommerceService } from '../integrations/unicommerce.service';

/**
 * Phase 5 synchronisation.
 *
 * The push itself is not enabled. What IS available, and what this service
 * provides, is everything around it: the backlog of stock made here and not
 * yet reflected externally, and a read-only comparison of the two systems.
 *
 * Both are genuinely useful without write access, and building them now means
 * the day a service account arrives, the only new thing is the write.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UnicommerceClient,
    private readonly unicommerce: UnicommerceService,
  ) {}

  /**
   * What is waiting to go out.
   *
   * Reports why the push cannot run as prominently as what it would send,
   * because "nothing happened" without a reason is indistinguishable from a
   * broken job.
   */
  async pushBacklog(organizationId: string) {
    const config = this.client.describe();

    const [balances, inwards] = await Promise.all([
      this.prisma.finishedGoodsBalance.findMany({
        where: { organizationId, pendingSyncQty: { gt: 0 } },
        select: {
          id: true, pendingSyncQty: true, onHandQty: true, syncedQty: true,
          productVariant: { select: { id: true, sku: true, product: { select: { name: true } } } },
          location: { select: { code: true, name: true } },
        },
        orderBy: { pendingSyncQty: 'desc' },
        take: 200,
      }),
      this.prisma.finishedGoodsInward.count({
        where: { organizationId, status: 'POSTED', syncStatus: 'SYNC_PENDING' },
      }),
    ]);

    const pending = balances.reduce<Decimal>((s, b) => s.plus(dec(b.pendingSyncQty.toFixed())), new Decimal(0));

    // Every reason the push cannot run, listed together. A single boolean
    // would make a three-part problem look like one switch.
    const blockers: { code: string; detail: string }[] = [];
    if (!config.isConfigured) {
      blockers.push({ code: 'NOT_CONFIGURED', detail: `Unicommerce is not configured: ${config.missing.join(', ')}.` });
    }
    if (!config.allowExternalWrites) {
      blockers.push({
        code: 'EXTERNAL_WRITES_DISABLED',
        detail: 'INTEGRATION_ALLOW_EXTERNAL_WRITES is false. External inventory changes need explicit authorisation.',
      });
    }
    blockers.push({
      code: 'TRANSPORT_READ_ONLY',
      detail: 'The connector refuses write paths structurally. Enabling the push is a reviewed change, not a config flag.',
    });
    if (config.isPlaintextTransport) {
      blockers.push({
        code: 'PLAINTEXT_TRANSPORT',
        detail: 'The connection is plain HTTP. Writing inventory over a cleartext link should not be enabled.',
      });
    }

    return {
      canPush: false,
      blockers,
      totals: {
        pendingQty: pending.toFixed(),
        skuCount: balances.length,
        inwardsAwaitingSync: inwards,
      },
      lines: balances.map((b) => ({
        id: b.id,
        productVariantId: b.productVariant.id,
        sku: b.productVariant.sku,
        productName: b.productVariant.product?.name ?? null,
        location: b.location.code,
        onHandQty: b.onHandQty.toFixed(),
        pendingSyncQty: b.pendingSyncQty.toFixed(),
        syncedQty: b.syncedQty.toFixed(),
      })),
    };
  }

  /**
   * Compare what this system holds against what Unicommerce reports.
   *
   * Read-only and available today. An overage is never resolved automatically:
   * external stock exceeding ours means something was credited twice, and
   * quietly adjusting it down would hide an integration defect rather than fix
   * it (decisions.md, and the domain rule in `reconcile`).
   */
  async reconciliation(organizationId: string, options: { facilityCode?: string; limit?: number } = {}) {
    const config = this.client.describe();
    if (!config.isConfigured || !config.enabled) {
      return {
        available: false,
        reason: config.missing.length
          ? `Unicommerce is not configured: ${config.missing.join(', ')}.`
          : 'The Unicommerce connector is disabled.',
        facilityCode: null,
        rows: [],
        totals: null,
      };
    }

    const facilityCode = options.facilityCode ?? config.defaultFacility;
    const limit = Math.min(50, Math.max(1, options.limit ?? 25));

    const balances = await this.prisma.finishedGoodsBalance.findMany({
      where: { organizationId, onHandQty: { gt: 0 } },
      select: {
        onHandQty: true, syncedQty: true,
        productVariant: { select: { id: true, sku: true, product: { select: { name: true } } } },
      },
      orderBy: { onHandQty: 'desc' },
      take: limit,
    });

    if (balances.length === 0) {
      return {
        available: true,
        reason: null,
        facilityCode,
        rows: [],
        totals: { compared: 0, matched: 0, shortfall: 0, overage: 0, unreadable: 0 },
      };
    }

    const rows = [];
    let matched = 0;
    let shortfall = 0;
    let overage = 0;
    let unreadable = 0;

    for (const b of balances) {
      const sku = b.productVariant.sku;
      const reading = await this.unicommerce.inventoryAt(sku, facilityCode);

      if (!reading) {
        // The facility could not be asked. Distinct from "it holds none" -
        // treating the two the same would invent a variance.
        unreadable += 1;
        rows.push({
          sku,
          productName: b.productVariant.product?.name ?? null,
          erpQty: b.onHandQty.toFixed(),
          externalQty: null,
          varianceQty: null,
          isMatched: false,
          recommendation: 'UNREADABLE' as const,
        });
        continue;
      }

      const verdict = reconcile({ erpQty: b.onHandQty.toFixed(), externalQty: reading.availableQty });
      if (verdict.isMatched) matched += 1;
      else if (verdict.recommendation === 'RETRY_SHORTFALL') shortfall += 1;
      else overage += 1;

      rows.push({
        sku,
        productName: b.productVariant.product?.name ?? null,
        erpQty: b.onHandQty.toFixed(),
        externalQty: reading.availableQty.toFixed(),
        varianceQty: verdict.varianceQty.toFixed(),
        isMatched: verdict.isMatched,
        recommendation: verdict.recommendation,
      });
    }

    return {
      available: true,
      reason: null,
      facilityCode,
      rows,
      totals: { compared: rows.length, matched, shortfall, overage, unreadable },
    };
  }
}
