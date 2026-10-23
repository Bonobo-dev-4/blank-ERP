import { Injectable } from '@nestjs/common';
import { BUILD_STATUS_SUMMARY } from '@dnd/contracts';
import { Decimal, amount, dec } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Dashboard figures.
 *
 * Every number here is a live aggregate over real rows. Modules that are not
 * built yet report `available: false` with the phase they are due in, rather
 * than a zero that looks like a real measurement - the specification is
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
      production,
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
      },

      production,

      // These are honest placeholders: the modules do not exist yet, so the
      // dashboard says so rather than showing a zero that reads as a fact.
      demand: {
        available: false,
        phase: 4,
        note: 'Shopify and Unicommerce order intelligence arrives in phase 4',
      },
      finishedGoods: {
        available: false,
        phase: 5,
        note: 'Finished goods inward and Unicommerce inventory push arrive in phase 5',
      },

      topAlerts: alerts.alerts.slice(0, 8),
      recentMovements,
      receiptsAwaitingInspection: recentReceipts,
      buildStatus: BUILD_STATUS_SUMMARY,
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
    const [stageRows, stages, orderRows, orderTotals] = await Promise.all([
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
        _sum: { orderedQty: true, completedQty: true, rejectedQty: true },
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
        completedQty: (orderTotals._sum.completedQty ?? dec(0)).toFixed(),
        rejectedQty: (orderTotals._sum.rejectedQty ?? dec(0)).toFixed(),
      },
      line,
      /** Stages holding work right now - what a supervisor walks to first. */
      activeStages: active.length,
      wipTotal: active.reduce((sum, l) => sum.plus(dec(l.wipQty)), dec(0)).toFixed(),
    };
  }
}
