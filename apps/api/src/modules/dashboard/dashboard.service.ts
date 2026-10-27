import { Injectable } from '@nestjs/common';
import { BUILD_STATUS_SUMMARY } from '@dnd/contracts';
import { Decimal, amount, dec } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Dashboard figures.
 *
 * Every number here is a live aggregate over real rows - the specification is
 * explicit that the dashboard must not fake interactions or figures.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async summary(organizationId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      materialCount, activeMaterialCount, productCount, variantCount,
      supplierCount, locationCount, lotCount, rollCount,
      openPoCount, pendingApprovalPoCount, overduePoCount, pendingInspectionCount,
      movementsToday, alerts, rollLengths, inventoryValue, recentMovements, recentReceipts,
      production, poByStatus, quality,
    ] = await Promise.all([
      this.prisma.rawMaterial.count({ where: { organizationId } }),
      this.prisma.rawMaterial.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.product.count({ where: { organizationId } }),
      this.prisma.productVariant.count({ where: { organizationId } }),
      this.prisma.supplier.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.materialLocation.count({ where: { organizationId, isSystem: false } }),
      this.prisma.materialLot.count({ where: { organizationId } }),
      this.prisma.fabricRoll.count({ where: { organizationId, status: { in: ['AVAILABLE', 'PARTIALLY_ISSUED'] } } }),
      this.prisma.rawMaterialPurchaseOrder.count({
        where: { organizationId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } },
      }),
      this.prisma.rawMaterialPurchaseOrder.count({ where: { organizationId, status: 'PENDING_APPROVAL' } }),
      this.prisma.rawMaterialPurchaseOrder.count({
        where: {
          organizationId,
          status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
          expectedDate: { lt: new Date() },
        },
      }),
      this.prisma.rawMaterialReceipt.count({ where: { organizationId, status: 'PENDING_INSPECTION' } }),
      this.prisma.materialMovement.count({ where: { organizationId, occurredAt: { gte: startOfToday } } }),
      this.inventory.stockAlerts(organizationId),
      this.prisma.fabricRoll.aggregate({
        where: { organizationId, status: { in: ['AVAILABLE', 'PARTIALLY_ISSUED'] } },
        _sum: { currentLength: true },
      }),
      this.inventoryValue(organizationId),
      this.prisma.materialMovement.findMany({
        where: { organizationId },
        orderBy: { occurredAt: 'desc' },
        take: 12,
        include: {
          rawMaterial: { select: { materialCode: true, name: true, baseUom: true } },
          sourceLocation: { select: { code: true, kind: true } },
          destinationLocation: { select: { code: true, kind: true } },
        },
      }),
      this.prisma.rawMaterialReceipt.findMany({
        where: { organizationId, status: 'PENDING_INSPECTION' },
        orderBy: { receiptDate: 'desc' },
        take: 8,
        include: {
          supplier: { select: { name: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.productionLine(organizationId),
      this.prisma.rawMaterialPurchaseOrder.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.qualitySummary(organizationId),
    ]);

    return {
      generatedAt: new Date().toISOString(),

      masterData: {
        rawMaterials: materialCount,
        activeRawMaterials: activeMaterialCount,
        products: productCount,
        skus: variantCount,
        suppliers: supplierCount,
        stockLocations: locationCount,
        materialLots: lotCount,
      },

      inventory: {
        available: true,
        issuableFabricRolls: rollCount,
        fabricMetresOnHand: dec(rollLengths._sum.currentLength?.toFixed() ?? '0').toFixed(2),
        movementsToday,
        rawMaterialStockValue: inventoryValue.toFixed(),
        outOfStockCount: alerts.counts.outOfStock,
        belowMinimumCount: alerts.counts.belowMinimum,
        atReorderLevelCount: alerts.counts.atReorderLevel,
      },

      purchasing: {
        available: true,
        openPurchaseOrders: openPoCount,
        awaitingApproval: pendingApprovalPoCount,
        overdue: overduePoCount,
        receiptsPendingInspection: pendingInspectionCount,
        byStatus: Object.fromEntries(poByStatus.map((r) => [r.status, r._count._all])),
      },

      production,
      quality,

      topAlerts: alerts.alerts.slice(0, 8),
      recentMovements,
      receiptsAwaitingInspection: recentReceipts,
      buildStatus: BUILD_STATUS_SUMMARY,
    };
  }

  /**
   * Daily history for the trend charts, bucketed in the organisation's own
   * timezone so "today" means the factory's today, not UTC's.
   *
   * Every series is read from an immutable ledger — stage movements and
   * material movements — so a day with no rows is a real zero, and a window
   * with no rows at all is reported as having no history rather than drawn
   * as a flat line that looks like a measurement.
   *
   * "Stage work completed" counts completions at EVERY stage, so it is
   * throughput (work done), not garments finished; the label says so.
   */
  async trends(organizationId: string, from: Date, to: Date) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const timeZone = org?.timezone ?? 'Asia/Kolkata';
    const dayOf = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const key = (d: Date) => dayOf.format(d);

    const [stageMoves, materialMoves] = await Promise.all([
      this.prisma.productionStageMovement.findMany({
        where: {
          organizationId,
          occurredAt: { gte: from, lte: to },
          movementType: { in: ['RELEASE_TO_FIRST_STAGE', 'CANCEL_RELEASE', 'COMPLETE', 'REJECT'] },
        },
        select: { movementType: true, qty: true, occurredAt: true },
      }),
      this.prisma.materialMovement.findMany({
        where: { organizationId, occurredAt: { gte: from, lte: to } },
        select: { occurredAt: true },
      }),
    ]);

    // Every calendar day in the window, so gaps render as zeros in place.
    const days: string[] = [];
    for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 86_400_000)) {
      const k = key(t);
      if (days[days.length - 1] !== k) days.push(k);
    }
    const lastKey = key(to);
    if (days[days.length - 1] !== lastKey) days.push(lastKey);

    const rows = new Map(
      days.map((d) => [d, { released: dec(0), completed: dec(0), rejected: dec(0), movements: 0 }]),
    );
    for (const m of stageMoves) {
      const row = rows.get(key(m.occurredAt));
      if (!row) continue;
      const qty = dec(m.qty.toFixed());
      if (m.movementType === 'RELEASE_TO_FIRST_STAGE') row.released = row.released.plus(qty);
      else if (m.movementType === 'CANCEL_RELEASE') row.released = row.released.minus(qty);
      else if (m.movementType === 'COMPLETE') row.completed = row.completed.plus(qty);
      else if (m.movementType === 'REJECT') row.rejected = row.rejected.plus(qty);
    }
    for (const m of materialMoves) {
      const row = rows.get(key(m.occurredAt));
      if (row) row.movements += 1;
    }

    return {
      timeZone,
      from: from.toISOString(),
      to: to.toISOString(),
      hasProductionHistory: stageMoves.length > 0,
      hasMovementHistory: materialMoves.length > 0,
      days: days.map((d) => {
        const r = rows.get(d)!;
        return {
          date: d,
          released: Decimal.max(r.released, 0).toFixed(),
          completed: r.completed.toFixed(),
          rejected: r.rejected.toFixed(),
          movements: r.movements,
        };
      }),
    };
  }

  /**
   * When the ERP last heard from each commerce system, for the top bar.
   *
   * Read from the orders themselves rather than a heartbeat table: the newest
   * imported Shopify order and the newest Unicommerce status check are the
   * facts a person actually means by "is the sync working".
   */
  async syncPulse(organizationId: string) {
    const [shopify, unicommerce] = await Promise.all([
      this.prisma.shopifyOrder.aggregate({
        where: { organizationId },
        _max: { importedAt: true, updatedAt: true },
      }),
      this.prisma.shopifyOrder.aggregate({
        where: { organizationId, externalStatusSyncedAt: { not: null } },
        _max: { externalStatusSyncedAt: true },
      }),
    ]);
    return {
      shopify: {
        lastImportedAt: shopify._max.importedAt?.toISOString() ?? null,
        lastUpdatedAt: shopify._max.updatedAt?.toISOString() ?? null,
      },
      unicommerce: {
        lastStatusSyncAt: unicommerce._max.externalStatusSyncedAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Production quality over the last 30 days, straight from the inspection
   * records: what was inspected and how it came out. Quantities are garments,
   * summed over inspections — a re-inspection is its own inspection, so the
   * count of inspections is reported alongside.
   */
  async qualitySummary(organizationId: string, from?: Date, to?: Date) {
    const since = from ?? new Date(Date.now() - 30 * 86_400_000);
    const until = to ?? new Date();
    const [agg, openRework] = await Promise.all([
      this.prisma.qualityInspection.aggregate({
        where: { organizationId, inspectedAt: { gte: since, lte: until } },
        _count: { _all: true },
        _sum: { inspectedQty: true, passedQty: true, failedQty: true, reworkQty: true, holdQty: true },
      }),
      this.prisma.reworkOrder.count({
        where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    ]);
    const q = (v: { toFixed(): string } | null) => (v ? dec(v.toFixed()) : dec(0)).toFixed();
    return {
      windowDays: Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000)),
      from: since.toISOString(),
      to: until.toISOString(),
      inspections: agg._count._all,
      inspectedQty: q(agg._sum.inspectedQty),
      passedQty: q(agg._sum.passedQty),
      failedQty: q(agg._sum.failedQty),
      reworkQty: q(agg._sum.reworkQty),
      holdQty: q(agg._sum.holdQty),
      openReworkOrders: openRework,
    };
  }

  /**
   * Value of raw material stock the organisation owns.
   *
   * Lot unit cost times quantity, over owned locations only - consumed and
   * scrapped quantity is gone, and the supplier counter-account is not stock.
   */
  private async inventoryValue(organizationId: string): Promise<Decimal> {
    const rows = await this.prisma.materialBalance.findMany({
      where: {
        organizationId,
        location: {
          kind: { in: ['PHYSICAL', 'PRODUCTION_FLOOR', 'JOB_WORKER', 'QUALITY_HOLD', 'BLOCKED', 'IN_TRANSIT'] },
        },
      },
      select: { onHandQty: true, materialLot: { select: { unitCost: true } } },
    });
    return amount(
      rows.reduce<Decimal>(
        (acc, r) => acc.plus(dec(r.onHandQty.toFixed()).times(dec(r.materialLot.unitCost.toFixed()))),
        new Decimal(0),
      ),
    );
  }

  /**
   * The production line, stage by stage.
   *
   * This is a FUNNEL, not a progress bar. A garment is counted once, at the
   * stage it has actually reached, and the quantities deliberately do not sum:
   * 120 cut, 112 stitched and 96 finished is 96 garments, not 328. What the
   * line is really for is showing where quantity LEAVES - to rejection, or to
   * rework that has not come back - because that is the number nobody has on
   * a spreadsheet.
   */
  private async productionLine(organizationId: string) {
    const [stageRows, stages, orderRows, orderTotals, overdueOrders] = await Promise.all([
      this.prisma.productionStageTask.groupBy({
        by: ['productionStageId'],
        where: { organizationId },
        _sum: {
          plannedQty: true, receivedQty: true, completedQty: true, rejectedQty: true,
          reworkSentQty: true, reworkReturnedQty: true, forwardedQty: true,
        },
      }),
      this.prisma.productionStage.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { id: true, code: true, name: true, sequenceHint: true },
        orderBy: { sequenceHint: 'asc' },
      }),
      this.prisma.manufacturingOrder.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.manufacturingOrder.aggregate({
        where: { organizationId, status: { notIn: ['CANCELLED', 'DRAFT'] } },
        _sum: { orderedQty: true, releasedQty: true, completedQty: true, rejectedQty: true },
      }),
      // Past due and still open. Closed, completed and cancelled orders are
      // finished business, whatever their due date said.
      this.prisma.manufacturingOrder.count({
        where: {
          organizationId,
          dueDate: { lt: new Date() },
          status: { in: ['PENDING_MATERIAL', 'MATERIAL_RESERVED', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD'] },
        },
      }),
    ]);

    const bySum = new Map(stageRows.map((r) => [r.productionStageId, r._sum]));

    const line = stages.map((stage) => {
      const s = bySum.get(stage.id);
      const received = dec(s?.receivedQty?.toFixed() ?? '0');
      const completed = dec(s?.completedQty?.toFixed() ?? '0');
      const rejected = dec(s?.rejectedQty?.toFixed() ?? '0');
      const forwarded = dec(s?.forwardedQty?.toFixed() ?? '0');
      const reworkSent = dec(s?.reworkSentQty?.toFixed() ?? '0');
      const reworkReturned = dec(s?.reworkReturnedQty?.toFixed() ?? '0');

      // Outstanding rework, not cumulative: a garment reworked twice is one
      // garment, and the difference is the only figure that stays true.
      const reworkOpen = Decimal.max(reworkSent.minus(reworkReturned), 0);
      // Sitting at this stage right now: taken in, not yet passed on or lost.
      const wip = Decimal.max(received.minus(forwarded).minus(rejected).minus(reworkOpen), 0);

      return {
        stageId: stage.id,
        code: stage.code,
        name: stage.name,
        sequence: stage.sequenceHint,
        receivedQty: received.toFixed(),
        completedQty: completed.toFixed(),
        forwardedQty: forwarded.toFixed(),
        rejectedQty: rejected.toFixed(),
        reworkOpenQty: reworkOpen.toFixed(),
        wipQty: wip.toFixed(),
        hasActivity: received.greaterThan(0) || completed.greaterThan(0),
      };
    });

    const statusCounts = Object.fromEntries(orderRows.map((r) => [r.status, r._count._all]));
    const active = line.filter((l) => dec(l.wipQty).greaterThan(0));

    return {
      available: true,
      orders: {
        total: orderRows.reduce((n, r) => n + r._count._all, 0),
        byStatus: statusCounts,
        orderedQty: (orderTotals._sum.orderedQty ?? dec(0)).toFixed(),
        releasedQty: (orderTotals._sum.releasedQty ?? dec(0)).toFixed(),
        completedQty: (orderTotals._sum.completedQty ?? dec(0)).toFixed(),
        rejectedQty: (orderTotals._sum.rejectedQty ?? dec(0)).toFixed(),
        overdue: overdueOrders,
      },
      line,
      /** Stages holding work right now - what a supervisor walks to first. */
      activeStages: active.length,
      wipTotal: active.reduce((sum, l) => sum.plus(dec(l.wipQty)), dec(0)).toFixed(),
    };
  }
}
