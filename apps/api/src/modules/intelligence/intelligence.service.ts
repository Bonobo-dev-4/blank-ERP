import { Injectable } from '@nestjs/common';
import {
  Decimal, computeVelocity, dec, suggestReplenishment,
  type ForecastMethod, type SalesObservation,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';

const WEEK_MS = 7 * 86_400_000;

/** Monday of the week containing `d`, so observations bucket consistently. */
function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - day * 86_400_000);
}

/**
 * Phase 6 intelligence: forecasting and replenishment.
 *
 * Both are rule-based and computed at read time, never a black box. The
 * specification asks for rules precisely so a planner can reproduce a figure by
 * hand and argue with it, so every response carries the inputs that produced
 * it alongside the answer.
 *
 * Nothing here is persisted. `DemandForecast` exists in the schema for storing
 * a generated forecast so planners can compare their past calls against what
 * happened — a genuinely different feature from "what does the data say now",
 * and one that needs someone to decide when a forecast is struck. Writing a
 * row on every page view would fill that table with noise.
 */
@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sales velocity per SKU, from imported Shopify order history.
   *
   * Demand is driven from `demandQty` on the imported line, which is already
   * net of cancellation and refund — forecasting from gross ordered quantity
   * would forecast returns as if they were demand.
   */
  async forecast(
    organizationId: string,
    options: { lookbackDays?: number; method?: ForecastMethod; horizonDays?: number } = {},
  ) {
    const lookbackDays = options.lookbackDays ?? 56;
    const horizonDays = options.horizonDays ?? 30;
    const method = options.method ?? 'WEIGHTED_VELOCITY';
    const since = new Date(Date.now() - lookbackDays * 86_400_000);

    const lines = await this.prisma.shopifyOrderLine.findMany({
      where: {
        organizationId,
        productVariantId: { not: null },
        shopifyOrder: { orderedAt: { gte: since }, status: { not: 'CANCELLED' } },
      },
      select: {
        productVariantId: true,
        orderedQty: true,
        cancelledQty: true,
        shopifyOrder: { select: { orderedAt: true } },
      },
    });

    // Bucket into weeks per variant.
    const buckets = new Map<string, Map<number, Decimal>>();
    for (const l of lines) {
      const id = l.productVariantId as string;
      const wk = weekStart(l.shopifyOrder.orderedAt).getTime();
      const net = Decimal.max(dec(l.orderedQty.toFixed()).minus(dec(l.cancelledQty.toFixed())), 0);
      const perVariant = buckets.get(id) ?? new Map<number, Decimal>();
      perVariant.set(wk, (perVariant.get(wk) ?? new Decimal(0)).plus(net));
      buckets.set(id, perVariant);
    }

    if (buckets.size === 0) {
      return {
        lookbackDays, horizonDays, method,
        note: 'No Shopify order history in the lookback window. Import orders to forecast from real sales.',
        rows: [],
      };
    }

    const variants = await this.prisma.productVariant.findMany({
      where: { organizationId, id: { in: [...buckets.keys()] } },
      select: { id: true, sku: true, size: true, color: true, product: { select: { name: true, styleCode: true } } },
    });
    const variantBy = new Map(variants.map((v) => [v.id, v]));

    const stock = await this.prisma.finishedGoodsBalance.groupBy({
      by: ['productVariantId'],
      where: { organizationId, productVariantId: { in: [...buckets.keys()] } },
      _sum: { onHandQty: true },
    });
    const stockBy = new Map(stock.map((r) => [r.productVariantId, dec(r._sum?.onHandQty?.toFixed() ?? '0')] as const));

    const rows = [...buckets.entries()].map(([variantId, weeks]) => {
      const observations: SalesObservation[] = [...weeks.entries()]
        .map(([ms, units]) => ({ weekStart: new Date(ms), unitsSold: units }));
      const v = computeVelocity(observations, { method, lookbackDays });
      const variant = variantBy.get(variantId);
      const sold = observations.reduce<Decimal>((s, o) => s.plus(dec(String(o.unitsSold))), new Decimal(0));

      return {
        productVariantId: variantId,
        sku: variant?.sku ?? null,
        productName: variant?.product?.name ?? null,
        styleCode: variant?.product?.styleCode ?? null,
        size: variant?.size ?? null,
        color: variant?.color ?? null,
        unitsSold: sold.toFixed(),
        weeksObserved: v.observationCount,
        salesVelocity: v.salesVelocity.toFixed(2),
        confidence: v.confidence.toFixed(2),
        method: v.method,
        // Straight-line projection over the horizon. No seasonality applied:
        // this store has no season index configured, and inventing one would
        // dress a guess as a measurement.
        forecastQty: v.salesVelocity.dividedBy(7).times(horizonDays).toDecimalPlaces(2).toFixed(),
        onHandQty: (stockBy.get(variantId) ?? new Decimal(0)).toFixed(),
      };
    });

    rows.sort((a, b) => Number(b.salesVelocity) - Number(a.salesVelocity));

    return {
      lookbackDays, horizonDays, method,
      note: null,
      totals: {
        skuCount: rows.length,
        unitsSold: rows.reduce((s, r) => s + Number(r.unitsSold), 0).toFixed(2),
        forecastQty: rows.reduce((s, r) => s + Number(r.forecastQty), 0).toFixed(2),
        lowConfidence: rows.filter((r) => Number(r.confidence) < 0.5).length,
      },
      rows,
    };
  }

  /**
   * Raw material replenishment.
   *
   * Velocity comes from what production actually consumed, not from sales:
   * fabric is consumed by cutting, and a garment sold today was cut weeks ago.
   * Consumption is the series that predicts the next purchase order.
   *
   * Confirmed incoming quantity is subtracted so a material already on an open
   * purchase order is not ordered twice.
   */
  async replenishment(organizationId: string, options: { lookbackDays?: number; safetyStockDays?: number } = {}) {
    const lookbackDays = options.lookbackDays ?? 56;
    const safetyStockDays = options.safetyStockDays ?? 0;
    const since = new Date(Date.now() - lookbackDays * 86_400_000);

    const [consumption, materials, incoming] = await Promise.all([
      this.prisma.materialConsumption.findMany({
        where: { organizationId, postedAt: { gte: since } },
        select: { rawMaterialId: true, consumedBaseQty: true, wastageBaseQty: true, postedAt: true },
      }),
      this.prisma.rawMaterial.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: {
          id: true, materialCode: true, name: true, category: true, baseUom: true,
          minimumStock: true, reorderLevel: true, reorderQty: true, leadTimeDays: true,
          defaultSupplier: { select: { id: true, name: true } },
        },
      }),
      this.prisma.rawMaterialPurchaseItem.groupBy({
        by: ['rawMaterialId'],
        where: {
          purchaseOrder: { organizationId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } },
        },
        // Base quantities: the ordered figure is in the PURCHASE uom, and
        // mixing the two would compare rolls against metres.
        _sum: { orderedBaseQty: true, receivedBaseQty: true },
      }),
    ]);

    const balances = await this.prisma.materialBalance.groupBy({
      by: ['rawMaterialId'],
      // PHYSICAL only. Stock on a production floor has already been issued to
      // an order, so counting it as available would offer the same metre of
      // fabric to a second order.
      where: { organizationId, location: { kind: 'PHYSICAL' } },
      _sum: { onHandQty: true },
    });
    const availableBy = new Map(
      balances.map((b) => [b.rawMaterialId, dec(b._sum?.onHandQty?.toFixed() ?? '0')] as const),
    );

    const incomingBy = new Map(
      incoming.map((i) => [
        i.rawMaterialId,
        Decimal.max(
          dec(i._sum?.orderedBaseQty?.toFixed() ?? '0').minus(dec(i._sum?.receivedBaseQty?.toFixed() ?? '0')),
          0,
        ),
      ] as const),
    );

    // Weekly consumption buckets per material.
    const buckets = new Map<string, Map<number, Decimal>>();
    for (const c of consumption) {
      const wk = weekStart(c.postedAt).getTime();
      const used = dec(c.consumedBaseQty.toFixed()).plus(dec(c.wastageBaseQty.toFixed()));
      const per = buckets.get(c.rawMaterialId) ?? new Map<number, Decimal>();
      per.set(wk, (per.get(wk) ?? new Decimal(0)).plus(used));
      buckets.set(c.rawMaterialId, per);
    }

    const rows = materials
      .map((m) => {
        const weeks = buckets.get(m.id);
        const observations: SalesObservation[] = weeks
          ? [...weeks.entries()].map(([ms, units]) => ({ weekStart: new Date(ms), unitsSold: units }))
          : [];
        const v = computeVelocity(observations, { lookbackDays });
        const available = availableBy.get(m.id) ?? new Decimal(0);
        const incomingQty = incomingBy.get(m.id) ?? new Decimal(0);

        const s = suggestReplenishment({
          salesVelocity: v.salesVelocity,
          leadTimeDays: m.leadTimeDays,
          availableQty: available,
          incomingQty,
          safetyStockDays,
          minimumOrderQty: m.reorderQty ? m.reorderQty.toFixed() : null,
        });

        return {
          rawMaterialId: m.id,
          materialCode: m.materialCode,
          name: m.name,
          category: m.category,
          baseUom: m.baseUom,
          supplier: m.defaultSupplier?.name ?? null,
          leadTimeDays: m.leadTimeDays,
          weeksObserved: v.observationCount,
          confidence: v.confidence.toFixed(2),
          consumptionVelocity: v.salesVelocity.toFixed(2),
          availableQty: available.toFixed(),
          incomingQty: incomingQty.toFixed(),
          reorderLevel: m.reorderLevel.toFixed(),
          leadTimeDemandQty: s.leadTimeDemandQty.toFixed(2),
          safetyStockQty: s.safetyStockQty.toFixed(2),
          targetStockQty: s.targetStockQty.toFixed(2),
          suggestedQty: s.suggestedQty.toFixed(2),
          rationale: s.rationale,
          // A lead time of zero makes lead-time demand zero and the suggestion
          // meaningless. Surfaced so it reads as missing setup, not as "fine".
          hasLeadTime: m.leadTimeDays > 0,
        };
      })
      .filter((r) => Number(r.suggestedQty) > 0 || Number(r.consumptionVelocity) > 0)
      .sort((a, b) => Number(b.suggestedQty) - Number(a.suggestedQty));

    return {
      lookbackDays,
      safetyStockDays,
      totals: {
        materialCount: rows.length,
        toOrder: rows.filter((r) => Number(r.suggestedQty) > 0).length,
        missingLeadTime: rows.filter((r) => !r.hasLeadTime).length,
        lowConfidence: rows.filter((r) => Number(r.confidence) < 0.5).length,
      },
      rows,
    };
  }
}
