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

      // These are honest placeholders: the modules do not exist yet, so the
      // dashboard says so rather than showing a zero that reads as a fact.
      production: {
        available: false,
        phase: 2,
        note: 'Manufacturing orders and stage tracking arrive in phases 2 and 3',
      },
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
}
