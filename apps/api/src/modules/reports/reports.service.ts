import { Injectable } from '@nestjs/common';
import { Decimal, analyseWastage, dec, rollUpCosts, type CostCategory, type CostEntry } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ReportWindow {
  readonly from?: string;
  readonly to?: string;
}

/**
 * Phase 6 reporting.
 *
 * Every figure is derived from the ledger and the frozen BOM snapshot at read
 * time rather than materialised into a reporting table. `MoCostEntry` exists in
 * the schema and is deliberately NOT used: a second store of the same numbers
 * drifts from the ledger the first time a correction is posted, and then two
 * screens disagree about what a garment cost. The ledger is the only thing
 * that is append-only, so the ledger is what gets read.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private window(w: ReportWindow): { gte?: Date; lte?: Date } | undefined {
    const gte = w.from ? new Date(w.from) : undefined;
    const lte = w.to ? new Date(w.to) : undefined;
    if (!gte && !lte) return undefined;
    return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  }

  // ---------------------------------------------------------------------------
  // Production
  // ---------------------------------------------------------------------------

  /**
   * Throughput and where it is being lost.
   *
   * Stage figures are reported side by side and never summed: a garment passes
   * through every stage, so adding them counts it once per stage. The number
   * that means something is what each stage RECEIVED against what it passed on.
   */
  async production(organizationId: string, w: ReportWindow) {
    const occurredAt = this.window(w);

    const [stages, stageRows, orders, batches] = await Promise.all([
      this.prisma.productionStage.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { id: true, code: true, name: true, sequenceHint: true },
        orderBy: { sequenceHint: 'asc' },
      }),
      this.prisma.productionStageTask.groupBy({
        by: ['productionStageId'],
        where: { organizationId, ...(occurredAt ? { updatedAt: occurredAt } : {}) },
        _sum: {
          plannedQty: true, receivedQty: true, completedQty: true, rejectedQty: true,
          reworkSentQty: true, reworkReturnedQty: true, forwardedQty: true,
        },
        _count: { _all: true },
      }),
      this.prisma.manufacturingOrder.findMany({
        where: { organizationId, ...(occurredAt ? { createdAt: occurredAt } : {}) },
        select: {
          id: true, moNo: true, status: true, orderedQty: true, completedQty: true,
          rejectedQty: true, releasedQty: true, createdAt: true,
          productVariant: { select: { sku: true, product: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.productionBatch.count({ where: { organizationId } }),
    ]);

    const bySum = new Map(stageRows.map((r) => [r.productionStageId, r]));

    const byStage = stages.map((s) => {
      const r = bySum.get(s.id);
      const received = dec(r?._sum.receivedQty?.toFixed() ?? '0');
      const completed = dec(r?._sum.completedQty?.toFixed() ?? '0');
      const rejected = dec(r?._sum.rejectedQty?.toFixed() ?? '0');
      const forwarded = dec(r?._sum.forwardedQty?.toFixed() ?? '0');
      const reworkOpen = Decimal.max(
        dec(r?._sum.reworkSentQty?.toFixed() ?? '0').minus(dec(r?._sum.reworkReturnedQty?.toFixed() ?? '0')),
        0,
      );
      // First-pass yield: completed without having been sent back. The headline
      // quality number for a stage, and the one a rework loop hides.
      const fpy = received.greaterThan(0)
        ? completed.minus(reworkOpen).dividedBy(received).times(100)
        : null;

      return {
        stageId: s.id, code: s.code, name: s.name, sequence: s.sequenceHint,
        taskCount: r?._count._all ?? 0,
        plannedQty: dec(r?._sum.plannedQty?.toFixed() ?? '0').toFixed(),
        receivedQty: received.toFixed(),
        completedQty: completed.toFixed(),
        forwardedQty: forwarded.toFixed(),
        rejectedQty: rejected.toFixed(),
        reworkOpenQty: reworkOpen.toFixed(),
        wipQty: Decimal.max(received.minus(forwarded).minus(rejected).minus(reworkOpen), 0).toFixed(),
        rejectionPct: received.greaterThan(0) ? rejected.dividedBy(received).times(100).toFixed(2) : null,
        firstPassYieldPct: fpy ? Decimal.max(fpy, 0).toFixed(2) : null,
      };
    });

    const ordered = orders.reduce<Decimal>((s, o) => s.plus(dec(o.orderedQty.toFixed())), new Decimal(0));
    const completed = orders.reduce<Decimal>((s, o) => s.plus(dec(o.completedQty.toFixed())), new Decimal(0));
    const rejected = orders.reduce<Decimal>((s, o) => s.plus(dec(o.rejectedQty.toFixed())), new Decimal(0));

    return {
      window: { from: w.from ?? null, to: w.to ?? null },
      totals: {
        orderCount: orders.length,
        batchCount: batches,
        orderedQty: ordered.toFixed(),
        completedQty: completed.toFixed(),
        rejectedQty: rejected.toFixed(),
        completionPct: ordered.greaterThan(0) ? completed.dividedBy(ordered).times(100).toFixed(2) : null,
        rejectionPct: ordered.greaterThan(0) ? rejected.dividedBy(ordered).times(100).toFixed(2) : null,
      },
      byStage,
      orders: orders.map((o) => ({
        id: o.id, orderNo: o.moNo, status: o.status,
        sku: o.productVariant?.sku ?? null,
        productName: o.productVariant?.product?.name ?? null,
        orderedQty: o.orderedQty.toFixed(),
        releasedQty: o.releasedQty.toFixed(),
        completedQty: o.completedQty.toFixed(),
        rejectedQty: o.rejectedQty.toFixed(),
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Material consumption
  // ---------------------------------------------------------------------------

  /**
   * What was actually consumed, against what the frozen BOM said it would be.
   *
   * The comparison is against `MoBomSnapshotLine`, never the live BOM. A BOM
   * someone has edited since the order was released would measure the edit
   * rather than the production run - which is the whole reason the snapshot
   * exists.
   */
  async consumption(organizationId: string, w: ReportWindow) {
    const postedAt = this.window(w);

    const [rows, materials] = await Promise.all([
      this.prisma.materialConsumption.groupBy({
        by: ['rawMaterialId'],
        where: { organizationId, ...(postedAt ? { postedAt } : {}) },
        _sum: { consumedBaseQty: true, wastageBaseQty: true, totalCost: true },
        _count: { _all: true },
      }),
      this.prisma.rawMaterial.findMany({
        where: { organizationId },
        select: { id: true, materialCode: true, name: true, baseUom: true, category: true },
      }),
    ]);

    const byId = new Map(materials.map((m) => [m.id, m]));

    // Standard quantity for the same materials, from the frozen snapshots of
    // every order that actually consumed something in this window.
    const moIds = await this.prisma.materialConsumption.findMany({
      where: { organizationId, ...(postedAt ? { postedAt } : {}) },
      select: { manufacturingOrderId: true },
      distinct: ['manufacturingOrderId'],
    });

    const snapshot = await this.prisma.moBomSnapshotLine.groupBy({
      by: ['rawMaterialId'],
      // No organizationId on this table; the order ids are already scoped.
      where: { manufacturingOrderId: { in: moIds.map((m) => m.manufacturingOrderId) } },
      _sum: { plannedQty: true },
    });
    const standardBy = new Map(snapshot.map((row) => [row.rawMaterialId, dec(row._sum?.plannedQty?.toFixed() ?? '0')]));

    const variance = analyseWastage(
      rows.map((r) => ({
        rawMaterialId: r.rawMaterialId,
        standardQty: standardBy.get(r.rawMaterialId) ?? 0,
        // Consumed plus wastage is what actually left stock for this order.
        actualQty: dec(r._sum.consumedBaseQty?.toFixed() ?? '0')
          .plus(dec(r._sum.wastageBaseQty?.toFixed() ?? '0')),
      })),
    );
    const varianceBy = new Map(variance.map((v) => [v.rawMaterialId, v]));

    const lines = rows
      .map((r) => {
        const m = byId.get(r.rawMaterialId);
        const v = varianceBy.get(r.rawMaterialId);
        const consumed = dec(r._sum.consumedBaseQty?.toFixed() ?? '0');
        const wastage = dec(r._sum.wastageBaseQty?.toFixed() ?? '0');
        return {
          rawMaterialId: r.rawMaterialId,
          materialCode: m?.materialCode ?? '-',
          name: m?.name ?? '-',
          category: m?.category ?? null,
          baseUom: m?.baseUom ?? null,
          postings: r._count._all,
          consumedQty: consumed.toFixed(),
          wastageQty: wastage.toFixed(),
          totalQty: consumed.plus(wastage).toFixed(),
          wastagePct: consumed.greaterThan(0) ? wastage.dividedBy(consumed).times(100).toFixed(2) : null,
          standardQty: (v?.standardQty ?? new Decimal(0)).toFixed(),
          varianceQty: (v?.varianceQty ?? new Decimal(0)).toFixed(),
          variancePct: v?.variancePct ? v.variancePct.toFixed(2) : null,
          isOverConsumption: v?.isOverConsumption ?? false,
          totalCost: dec(r._sum.totalCost?.toFixed() ?? '0').toFixed(),
        };
      })
      .sort((a, b) => Number(b.totalCost) - Number(a.totalCost));

    return {
      window: { from: w.from ?? null, to: w.to ?? null },
      totals: {
        materialCount: lines.length,
        consumedCost: lines.reduce((s, l) => s + Number(l.totalCost), 0).toFixed(2),
        overConsuming: lines.filter((l) => l.isOverConsumption).length,
      },
      lines,
    };
  }

  // ---------------------------------------------------------------------------
  // Costing
  // ---------------------------------------------------------------------------

  /**
   * Planned against actual cost, per manufacturing order.
   *
   * Planned comes from the frozen BOM snapshot; actual from what the ledger
   * says was consumed, plus job work charged against the order. Unit cost is
   * divided by ACCEPTED units, because rejected garments consumed material and
   * labour and produced nothing sellable - spreading their cost over all units
   * would quietly understate what a saleable garment costs.
   */
  async costing(organizationId: string, w: ReportWindow) {
    const createdAt = this.window(w);

    const orders = await this.prisma.manufacturingOrder.findMany({
      where: { organizationId, status: { notIn: ['DRAFT', 'CANCELLED'] }, ...(createdAt ? { createdAt } : {}) },
      select: {
        id: true, moNo: true, status: true, orderedQty: true, completedQty: true, rejectedQty: true,
        productVariant: { select: { sku: true, product: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (orders.length === 0) {
      return { window: { from: w.from ?? null, to: w.to ?? null }, totals: null, orders: [] };
    }
    const ids = orders.map((o) => o.id);

    const [planned, actual, jobWork] = await Promise.all([
      this.prisma.moBomSnapshotLine.groupBy({
        by: ['manufacturingOrderId'],
        where: { manufacturingOrderId: { in: ids } },
        _sum: { plannedQty: true },
      }),
      this.prisma.materialConsumption.groupBy({
        by: ['manufacturingOrderId'],
        where: { organizationId, manufacturingOrderId: { in: ids } },
        _sum: { totalCost: true, consumedBaseQty: true, wastageBaseQty: true },
      }),
      this.prisma.jobWorkOrderLine.groupBy({
        by: ['jobWorkOrderId'],
        where: { jobWorkOrder: { organizationId } },
        _sum: { lineCharge: true },
      }),
    ]);

    // Planned material value needs the per-line rate, so it is summed from the
    // snapshot lines directly rather than from a grouped quantity.
    const plannedLines = await this.prisma.moBomSnapshotLine.findMany({
      where: { manufacturingOrderId: { in: ids } },
      select: { manufacturingOrderId: true, plannedQty: true, unitCost: true },
    });
    const plannedCostBy = new Map<string, Decimal>();
    for (const l of plannedLines) {
      const v = dec(l.plannedQty.toFixed()).times(dec(l.unitCost.toFixed()));
      plannedCostBy.set(l.manufacturingOrderId, (plannedCostBy.get(l.manufacturingOrderId) ?? new Decimal(0)).plus(v));
    }

    const actualBy = new Map(actual.map((a) => [a.manufacturingOrderId, a._sum]));
    const jobWorkTotal = jobWork.reduce<Decimal>((t, j) => t.plus(dec(j._sum?.lineCharge?.toFixed() ?? '0')), new Decimal(0));
    void planned;

    const rows = orders.map((o) => {
      const plannedMaterial = plannedCostBy.get(o.id) ?? new Decimal(0);
      const actualMaterial = dec(actualBy.get(o.id)?.totalCost?.toFixed() ?? '0');

      const entries: CostEntry[] = [
        { costCategory: 'MATERIAL' as CostCategory, isPlanned: true, amount: plannedMaterial },
        { costCategory: 'MATERIAL' as CostCategory, isPlanned: false, amount: actualMaterial },
      ];

      const summary = rollUpCosts(entries, o.completedQty.toFixed());

      return {
        id: o.id, orderNo: o.moNo, status: o.status,
        sku: o.productVariant?.sku ?? null,
        productName: o.productVariant?.product?.name ?? null,
        orderedQty: o.orderedQty.toFixed(),
        acceptedQty: o.completedQty.toFixed(),
        rejectedQty: o.rejectedQty.toFixed(),
        plannedTotal: summary.plannedTotal.toFixed(),
        actualTotal: summary.actualTotal.toFixed(),
        varianceAmount: summary.varianceAmount.toFixed(),
        variancePct: summary.variancePct ? summary.variancePct.toFixed(2) : null,
        costPerAcceptedUnit: summary.costPerAcceptedUnit ? summary.costPerAcceptedUnit.toFixed(2) : null,
        byCategory: summary.byCategory.map((c) => ({
          costCategory: c.costCategory,
          plannedAmount: c.plannedAmount.toFixed(),
          actualAmount: c.actualAmount.toFixed(),
          varianceAmount: c.varianceAmount.toFixed(),
          variancePct: c.variancePct ? c.variancePct.toFixed(2) : null,
        })),
      };
    });

    const plannedTotal = rows.reduce((s, r) => s + Number(r.plannedTotal), 0);
    const actualTotal = rows.reduce((s, r) => s + Number(r.actualTotal), 0);

    return {
      window: { from: w.from ?? null, to: w.to ?? null },
      totals: {
        orderCount: rows.length,
        plannedTotal: plannedTotal.toFixed(2),
        actualTotal: actualTotal.toFixed(2),
        varianceAmount: (actualTotal - plannedTotal).toFixed(2),
        variancePct: plannedTotal > 0 ? (((actualTotal - plannedTotal) / plannedTotal) * 100).toFixed(2) : null,
        /**
         * Job work is charged against job work ORDERS, which are not yet linked
         * to a manufacturing order in the schema. Reported as a separate total
         * rather than folded in, because attributing it per order would require
         * a link that does not exist and a guess that would look like a fact.
         */
        jobWorkTotalUnattributed: jobWorkTotal.toFixed(2),
      },
      orders: rows,
    };
  }

  // ---------------------------------------------------------------------------
  // Job worker performance
  // ---------------------------------------------------------------------------

  /**
   * How each job worker is performing.
   *
   * Counted from the stage tasks assigned to them, which is where the work
   * actually happened, rather than from job work orders - an order can be
   * raised and never worked.
   */
  async jobWorkers(organizationId: string, w: ReportWindow) {
    const updatedAt = this.window(w);

    const [workers, taskRows, orderRows] = await Promise.all([
      this.prisma.jobWorker.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, kind: true, status: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productionStageTask.groupBy({
        by: ['assignedJobWorkerId'],
        where: {
          organizationId,
          assignedJobWorkerId: { not: null },
          ...(updatedAt ? { updatedAt } : {}),
        },
        _sum: {
          receivedQty: true, completedQty: true, rejectedQty: true,
          reworkSentQty: true, reworkReturnedQty: true,
        },
        _count: { _all: true },
      }),
      this.prisma.jobWorkOrder.groupBy({
        by: ['jobWorkerId'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);

    const taskBy = new Map(taskRows.map((r) => [r.assignedJobWorkerId as string, r]));
    const orderBy2 = new Map(orderRows.map((r) => [r.jobWorkerId, r._count._all]));

    const rows = workers.map((wk) => {
      const t = taskBy.get(wk.id);
      const received = dec(t?._sum.receivedQty?.toFixed() ?? '0');
      const completed = dec(t?._sum.completedQty?.toFixed() ?? '0');
      const rejected = dec(t?._sum.rejectedQty?.toFixed() ?? '0');
      const reworkOpen = Decimal.max(
        dec(t?._sum.reworkSentQty?.toFixed() ?? '0').minus(dec(t?._sum.reworkReturnedQty?.toFixed() ?? '0')),
        0,
      );

      return {
        id: wk.id, code: wk.code, name: wk.name,
        workerType: wk.kind, status: wk.status,
        taskCount: t?._count._all ?? 0,
        orderCount: orderBy2.get(wk.id) ?? 0,
        receivedQty: received.toFixed(),
        completedQty: completed.toFixed(),
        rejectedQty: rejected.toFixed(),
        reworkOpenQty: reworkOpen.toFixed(),
        // Share of what they took in that came back good first time.
        qualityPct: received.greaterThan(0)
          ? Decimal.max(completed.minus(reworkOpen), 0).dividedBy(received).times(100).toFixed(2)
          : null,
        rejectionPct: received.greaterThan(0) ? rejected.dividedBy(received).times(100).toFixed(2) : null,
        hasActivity: received.greaterThan(0) || (t?._count._all ?? 0) > 0,
      };
    });

    const active = rows.filter((r) => r.hasActivity);
    return {
      window: { from: w.from ?? null, to: w.to ?? null },
      totals: {
        workerCount: rows.length,
        activeCount: active.length,
        receivedQty: active.reduce((s, r) => s + Number(r.receivedQty), 0).toFixed(2),
        rejectedQty: active.reduce((s, r) => s + Number(r.rejectedQty), 0).toFixed(2),
      },
      workers: rows,
    };
  }
}
