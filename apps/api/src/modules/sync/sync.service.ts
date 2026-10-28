import { Injectable, Logger } from '@nestjs/common';
import { Decimal, dec, normaliseCommerceRef, reconcile } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ShopifyService } from '../integrations/shopify.service';
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
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UnicommerceClient,
    private readonly unicommerce: UnicommerceService,
    private readonly shopify: ShopifyService,
  ) {}

  /**
   * Refresh order state from BOTH external systems.
   *
   * Someone edits an order in Shopify, or a parcel moves in Unicommerce, and
   * this ERP's copy goes quietly stale. One call brings both up to date:
   *
   *  - Shopify: re-import everything updated since the newest version we
   *    hold, less an hour of overlap. Re-importing is safe by construction -
   *    the importer upserts, and the stale-version guard refuses to let an
   *    older copy overwrite a newer one, so overlap costs nothing and a gap
   *    would cost a missed change.
   *  - Unicommerce: read the last 35 days of sale orders and carry their
   *    status onto ours, matched by order number - the join both systems
   *    share. Unicommerce fulfils, so for shipping its word is the truth.
   */
  async resyncOrders(organizationId: string, actorUserId: string) {
    const started = Date.now();

    // --- Shopify: changed orders since the newest we hold --------------------
    const newest = await this.prisma.shopifyOrder.aggregate({
      where: { organizationId },
      _max: { externalUpdatedAt: true },
    });
    const since = newest._max.externalUpdatedAt
      ? new Date(newest._max.externalUpdatedAt.getTime() - 60 * 60 * 1000)
      : new Date(Date.now() - 7 * 86_400_000);

    let shopifyResult: { imported: number; skippedStale: number } | { error: string };
    try {
      const r = (await this.shopify.importOrders(organizationId, actorUserId, {
        since: since.toISOString(),
        pageSize: 50,
      })) as { imported?: number; skippedStale?: number };
      shopifyResult = { imported: r.imported ?? 0, skippedStale: r.skippedStale ?? 0 };
    } catch (error) {
      // One side failing must not stop the other: a Shopify outage is no
      // reason to skip the Unicommerce statuses, and vice versa.
      shopifyResult = { error: errorMessage(error) };
      this.logger.warn(`Shopify resync failed: ${errorMessage(error)}`);
    }

    // --- Unicommerce: shipment status by order number ------------------------
    let unicommerceResult:
      | { checked: number; matched: number; updated: number }
      | { error: string }
      | { skipped: string };
    const uc = this.client.describe();
    if (!uc.isConfigured || !uc.enabled) {
      unicommerceResult = { skipped: 'Unicommerce is not configured.' };
    } else {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - 35 * 86_400_000);
        const external = await this.unicommerce.searchOrders(from, to);

        // Match on normalised order number: "#167939", "167939" and
        // "DD-167939" all reduce to the same key.
        const ours = await this.prisma.shopifyOrder.findMany({
          where: { organizationId, orderedAt: { gte: new Date(from.getTime() - 86_400_000) } },
          select: { id: true, orderName: true, orderNumber: true, externalShipmentStatus: true },
        });
        const byRef = new Map(
          ours.map((o) => [normaliseCommerceRef(o.orderName ?? o.orderNumber), o] as const),
        );

        let matched = 0;
        let updated = 0;
        for (const ext of external) {
          if (!ext.displayOrderCode || !ext.status) continue;
          const ours2 = byRef.get(normaliseCommerceRef(ext.displayOrderCode));
          if (!ours2) continue;
          matched += 1;
          if (ours2.externalShipmentStatus === ext.status) continue;
          await this.prisma.shopifyOrder.update({
            where: { id: ours2.id },
            data: { externalShipmentStatus: ext.status, externalStatusSyncedAt: new Date() },
          });
          updated += 1;
        }
        unicommerceResult = { checked: external.length, matched, updated };
      } catch (error) {
        unicommerceResult = { error: errorMessage(error) };
        this.logger.warn(`Unicommerce status resync failed: ${errorMessage(error)}`);
      }
    }

    return {
      sinceShopify: since.toISOString(),
      shopify: shopifyResult,
      unicommerce: unicommerceResult,
      tookMs: Date.now() - started,
    };
  }

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
        detail: 'Unicommerce writes are off (UC_WRITE_ENABLED). External inventory changes need explicit authorisation.',
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

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const r = (error as { response?: { message?: string } }).response;
    if (r?.message) return r.message;
  }
  return error instanceof Error ? error.message : String(error);
}
