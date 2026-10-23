import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type LocationKind as DbLocationKind,
  type PurchaseOrderStatus as DbPurchaseOrderStatus,
  type UomCode as DbUomCode,
} from '@prisma/client';
import {
  Decimal, ISSUABLE_KINDS, aggregateMrpLines, explodeBom, qty, runMrp,
  type ExplodedRequirement, type MaterialSupplyPosition, type MrpResult,
  type ProductionDemandLine, type UomCode,
} from '@dnd/domain';
import type { RequisitionFromMrpRequest, RunMrpRequest } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated } from '../../common/pagination';
import { BomService } from '../bom/bom.service';

/** Purchase orders whose outstanding quantity is still genuinely incoming. */
const OPEN_PO_STATUSES: DbPurchaseOrderStatus[] = ['APPROVED', 'PARTIALLY_RECEIVED'];

/**
 * Material requirement planning.
 *
 * An MRP run is a **snapshot with a timestamp**, not a live view. That is
 * deliberate: a planner raises purchase requisitions from a run, and those
 * quantities have to still mean something an hour later when someone approves
 * them. A live recomputation would silently change the numbers underneath the
 * approval.
 *
 * Two rules distinguish this from "required minus stock":
 *
 *  1. **Open purchase orders are not stock.** They are reported with their
 *     expected arrival date so a planner can judge, but the shortage figure is
 *     computed against physically available stock only. Fabric on a lorry
 *     cannot be cut.
 *  2. **Stock reserved by other orders is already gone.** It is excluded from
 *     available and reported separately, so the planner can see that the
 *     material exists but is promised elsewhere.
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bom: BomService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // running
  // -------------------------------------------------------------------------

  async run(organizationId: string, actorUserId: string, body: RunMrpRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const runNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.MRP_RUN);
      const requiredBy = body.requiredByDate ? new Date(body.requiredByDate) : null;

      const run = await tx.mrpRun.create({
        data: {
          organizationId,
          runNo,
          status: 'RUNNING',
          scope: body.manufacturingOrderIds
            ? { kind: 'MANUFACTURING_ORDERS', manufacturingOrderIds: body.manufacturingOrderIds }
            : { kind: 'AD_HOC', adHoc: body.adHoc as unknown as Prisma.InputJsonValue },
          parameters: {
            requiredByDate: body.requiredByDate ?? null,
            notes: body.notes ?? null,
            // Recorded so a run can be read years later without guessing what
            // the planner's definition of "available" was at the time.
            availabilityRule: 'UNRESERVED_STOCK_IN_ISSUABLE_LOCATIONS',
            issuableLocationKinds: [...ISSUABLE_KINDS],
            openPurchaseOrdersCountedAsStock: false,
          },
          runByUserId: actorUserId,
          startedAt: new Date(),
        },
        select: { id: true },
      });

      const plans = body.manufacturingOrderIds
        ? await this.planForOrders(tx, organizationId, body.manufacturingOrderIds, requiredBy)
        : [await this.planAdHoc(tx, organizationId, body.adHoc!, requiredBy)];

      // Aggregate across orders: ten orders needing the same fabric compete for
      // one pile of it. Planning them independently would promise the same
      // metre ten times.
      const aggregated = aggregateMrpLines(plans.map((p) => p.result));

      for (const plan of plans) {
        for (const line of plan.result.lines) {
          await tx.materialRequirement.create({
            data: {
              organizationId,
              mrpRunId: run.id,
              manufacturingOrderId: plan.manufacturingOrderId,
              bomVersionId: plan.bomVersionId,
              rawMaterialId: line.rawMaterialId,
              netRequiredQty: new Prisma.Decimal(line.netRequiredQty.toFixed(4)),
              wastageQty: new Prisma.Decimal(line.wastageQty.toFixed(4)),
              grossRequiredQty: new Prisma.Decimal(line.grossRequiredQty.toFixed(4)),
              uom: line.uom as DbUomCode,
              availableQty: new Prisma.Decimal(line.availableQty.toFixed(4)),
              reservedElsewhereQty: new Prisma.Decimal(line.reservedElsewhereQty.toFixed(4)),
              openPurchaseQty: new Prisma.Decimal(line.openPurchaseQty.toFixed(4)),
              expectedArrivalDate: line.expectedArrivalDate,
              shortageQty: new Prisma.Decimal(line.shortageQty.toFixed(4)),
              estimatedUnitCost: new Prisma.Decimal(line.unitCost.toFixed(6)),
              estimatedCost: new Prisma.Decimal(line.estimatedCost.toFixed(2)),
            },
          });
        }
      }

      const shortageLines = aggregated.filter((l) => l.shortageQty.greaterThan(0));
      const totalShortageValue = shortageLines.reduce<Decimal>(
        (acc, l) => acc.plus(l.shortageValue),
        new Decimal(0),
      );

      await tx.mrpRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          shortageLineCount: shortageLines.length,
          totalShortageValue: new Prisma.Decimal(totalShortageValue.toFixed(2)),
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'RUN', entityType: 'MrpRun', entityId: run.id,
          context: {
            runNo,
            orderCount: plans.length,
            lineCount: aggregated.length,
            shortageLineCount: shortageLines.length,
          },
        },
        tx,
      );

      return this.presentRun(organizationId, run.id, tx);
    });
  }

  /** Explode each order's own BOM, then plan them against shared stock. */
  private async planForOrders(
    tx: Prisma.TransactionClient,
    organizationId: string,
    manufacturingOrderIds: readonly string[],
    requiredBy: Date | null,
  ) {
    const orders = await tx.manufacturingOrder.findMany({
      where: { id: { in: [...manufacturingOrderIds] }, organizationId },
      include: {
        items: { include: { productVariant: { select: { id: true, sku: true, size: true } } } },
      },
    });

    if (orders.length !== new Set(manufacturingOrderIds).size) {
      const found = new Set(orders.map((o) => o.id));
      throw new NotFoundException({
        code: 'MANUFACTURING_ORDER_NOT_FOUND',
        message: 'One or more manufacturing orders do not exist',
        details: { missingIds: manufacturingOrderIds.filter((id) => !found.has(id)) },
      });
    }

    const plans: PlannedOrder[] = [];
    for (const order of orders) {
      // A released order is planned against the BOM it was frozen to, not the
      // current master. Planning it against a newer BOM would report shortages
      // for material the floor was never going to use.
      const snapshotLines = order.releasedAt
        ? await tx.moBomSnapshotLine.findMany({ where: { manufacturingOrderId: order.id } })
        : [];

      if (snapshotLines.length > 0) {
        plans.push({
          manufacturingOrderId: order.id,
          bomVersionId: order.bomVersionId,
          result: await this.planRequirements(
            tx,
            organizationId,
            snapshotLines.map<ExplodedRequirement>((l) => ({
              rawMaterialId: l.rawMaterialId,
              materialCode: l.materialCode,
              materialName: l.materialName,
              uom: l.uom as UomCode,
              productionStageId: null,
              productionStageCode: l.productionStageCode,
              netRequiredQty: qty(l.consumptionQtyPerUnit.toFixed()).times(qty(order.releasedQty.toFixed())),
              wastageQty: qty(l.wastageQtyPerUnit.toFixed()).times(qty(order.releasedQty.toFixed())),
              grossRequiredQty: qty(l.plannedQty.toFixed()),
              unitCost: qty(l.unitCost.toFixed()),
              estimatedCost: qty(l.plannedCost.toFixed()),
            })),
            qty(order.releasedQty.toFixed()),
            requiredBy ?? order.plannedStartDate,
            order.id,
          ),
        });
        continue;
      }

      const bomVersionId = await this.resolveOrderBom(tx, organizationId, order);
      const { domain } = await this.bom.loadForExplosion(tx, organizationId, bomVersionId);

      const demand: ProductionDemandLine[] = order.items.map((i) => ({
        productVariantId: i.productVariantId,
        size: i.size ?? i.productVariant.size,
        quantity: i.orderedQty.toFixed(),
      }));

      const explosion = explodeBom(domain, demand);
      plans.push({
        manufacturingOrderId: order.id,
        bomVersionId,
        result: await this.planRequirements(
          tx,
          organizationId,
          explosion.requirements,
          explosion.plannedQty,
          requiredBy ?? order.plannedStartDate,
          order.id,
        ),
      });
    }
    return plans;
  }

  private async planAdHoc(
    tx: Prisma.TransactionClient,
    organizationId: string,
    adHoc: NonNullable<RunMrpRequest['adHoc']>,
    requiredBy: Date | null,
  ): Promise<PlannedOrder> {
    let bomVersionId = adHoc.bomVersionId ?? null;

    if (!bomVersionId) {
      const firstVariant = adHoc.lines.find((l) => l.productVariantId)?.productVariantId;
      bomVersionId = firstVariant
        ? await this.bom.resolveBomVersionId(tx, organizationId, adHoc.productId, firstVariant)
        : await this.styleLevelBomVersionId(tx, organizationId, adHoc.productId);
    }
    if (!bomVersionId) {
      throw new BadRequestException({
        code: 'NO_APPROVED_BOM',
        message: 'This style has no approved BOM, so its material requirement cannot be computed',
        details: { productId: adHoc.productId },
      });
    }

    const { domain } = await this.bom.loadForExplosion(tx, organizationId, bomVersionId);
    const explosion = explodeBom(
      domain,
      adHoc.lines.map<ProductionDemandLine>((l) => ({
        productVariantId: l.productVariantId ?? undefined,
        size: l.size ?? null,
        quantity: l.quantity,
      })),
    );

    return {
      manufacturingOrderId: null,
      bomVersionId,
      result: await this.planRequirements(
        tx,
        organizationId,
        explosion.requirements,
        explosion.plannedQty,
        requiredBy,
      ),
    };
  }

  /** Read the live stock and incoming-supply position, then run the planner. */
  private async planRequirements(
    tx: Prisma.TransactionClient,
    organizationId: string,
    requirements: readonly ExplodedRequirement[],
    plannedQty: Decimal,
    requiredBy: Date | null,
    forManufacturingOrderId: string | null = null,
  ): Promise<MrpResult> {
    const supply = await this.supplyPositions(
      tx,
      organizationId,
      requirements.map((r) => r.rawMaterialId),
      { forManufacturingOrderId },
    );
    return runMrp(requirements, supply, plannedQty, { requiredByDate: requiredBy });
  }

  /**
   * What the planner knows about each material right now.
   *
   * `availableQty` counts only unreserved stock in issuable locations, which is
   * the same definition the reservation path enforces. If these two ever
   * disagreed, MRP would promise material that reservation then refuses.
   *
   * `forManufacturingOrderId` credits back the stock THAT order has already
   * reserved. Without it an order becomes unreleasable the moment it reserves
   * its own material: the reservation removes the stock from "available", the
   * readiness check then reports a shortage of exactly the quantity the order
   * is holding, and the planner is asked to override a shortage that does not
   * exist. The domain's own definition is "reserved by OTHER manufacturing
   * orders", and this is what makes that true.
   */
  async supplyPositions(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rawMaterialIds: readonly string[],
    options: { readonly forManufacturingOrderId?: string | null } = {},
  ): Promise<MaterialSupplyPosition[]> {
    const ids = [...new Set(rawMaterialIds)];
    if (ids.length === 0) return [];

    const [materials, balances, openPoItems] = await Promise.all([
      tx.rawMaterial.findMany({
        where: { id: { in: ids }, organizationId },
        select: {
          id: true, baseUom: true, leadTimeDays: true, reorderQty: true,
          purchaseRate: true, averageCost: true,
        },
      }),
      tx.materialBalance.findMany({
        where: {
          rawMaterialId: { in: ids },
          location: { organizationId, kind: { in: [...ISSUABLE_KINDS] as DbLocationKind[] } },
        },
        select: { rawMaterialId: true, onHandQty: true, reservedQty: true },
      }),
      tx.rawMaterialPurchaseItem.findMany({
        where: {
          rawMaterialId: { in: ids },
          purchaseOrder: { organizationId, status: { in: OPEN_PO_STATUSES } },
        },
        select: {
          rawMaterialId: true,
          orderedBaseQty: true,
          receivedBaseQty: true,
          expectedDate: true,
          purchaseOrder: { select: { expectedDate: true } },
        },
      }),
    ]);

    const issuable = new Map<string, { onHand: Decimal; reserved: Decimal }>();
    for (const b of balances) {
      const acc = issuable.get(b.rawMaterialId) ?? { onHand: new Decimal(0), reserved: new Decimal(0) };
      acc.onHand = acc.onHand.plus(qty(b.onHandQty.toFixed()));
      acc.reserved = acc.reserved.plus(qty(b.reservedQty.toFixed()));
      issuable.set(b.rawMaterialId, acc);
    }

    // Stock this order itself is holding. It is not available to anyone else,
    // but it is certainly available to the order that reserved it.
    const ownReservations = new Map<string, Decimal>();
    if (options.forManufacturingOrderId) {
      const held = await tx.materialReservation.findMany({
        where: {
          manufacturingOrderId: options.forManufacturingOrderId,
          rawMaterialId: { in: ids },
          status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] },
        },
        select: { rawMaterialId: true, reservedQty: true, issuedQty: true, releasedQty: true },
      });
      for (const r of held) {
        // Only the OPEN part: quantity already issued has physically left the
        // issuable location and is no longer sitting in that balance row.
        const open = Decimal.max(
          qty(r.reservedQty.toFixed()).minus(qty(r.issuedQty.toFixed())).minus(qty(r.releasedQty.toFixed())),
          0,
        );
        ownReservations.set(r.rawMaterialId, (ownReservations.get(r.rawMaterialId) ?? new Decimal(0)).plus(open));
      }
    }

    const incoming = new Map<string, { qty: Decimal; earliest: Date | null }>();
    for (const item of openPoItems) {
      const outstanding = qty(item.orderedBaseQty.toFixed()).minus(qty(item.receivedBaseQty.toFixed()));
      if (outstanding.lessThanOrEqualTo(0)) continue;
      const when = item.expectedDate ?? item.purchaseOrder.expectedDate ?? null;
      const acc = incoming.get(item.rawMaterialId) ?? { qty: new Decimal(0), earliest: null };
      acc.qty = acc.qty.plus(outstanding);
      // Earliest expected arrival, because that is the first date any of the
      // shortage could start being covered.
      if (when && (acc.earliest === null || when < acc.earliest)) acc.earliest = when;
      incoming.set(item.rawMaterialId, acc);
    }

    return materials.map<MaterialSupplyPosition>((m) => {
      const stock = issuable.get(m.id) ?? { onHand: new Decimal(0), reserved: new Decimal(0) };
      const supply = incoming.get(m.id) ?? { qty: new Decimal(0), earliest: null };
      const own = ownReservations.get(m.id) ?? new Decimal(0);
      const reservedElsewhere = Decimal.max(stock.reserved.minus(own), 0);
      return {
        rawMaterialId: m.id,
        availableQty: Decimal.max(stock.onHand.minus(reservedElsewhere), 0).toFixed(4),
        reservedElsewhereQty: reservedElsewhere.toFixed(4),
        openPurchaseQty: supply.qty.toFixed(4),
        expectedArrivalDate: supply.earliest,
        leadTimeDays: m.leadTimeDays,
        unitCost: (m.purchaseRate ?? m.averageCost).toFixed(),
        // `reorderQty` is the quantity the material master says to buy when
        // reordering, so it is the closest thing the schema holds to a
        // supplier minimum. Treating it as a floor stops MRP suggesting a
        // 3 m fabric order no mill would accept.
        minimumOrderQty: m.reorderQty.greaterThan(0) ? m.reorderQty.toFixed() : null,
        orderMultiple: null,
        uom: m.baseUom as UomCode,
      };
    });
  }

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async listRuns(
    organizationId: string,
    query: { page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string; status?: string },
  ) {
    const where: Prisma.MrpRunWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search ? { runNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const args = pageArgs(query, ['runNo', 'createdAt'], 'createdAt');
    const [rows, total] = await Promise.all([
      this.prisma.mrpRun.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { createdAt: 'desc' },
        include: { _count: { select: { requirements: true, requisitions: true } } },
      }),
      this.prisma.mrpRun.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async getRun(organizationId: string, id: string) {
    return this.presentRun(organizationId, id);
  }

  /**
   * Shortages across every completed run, newest first.
   *
   * The screen this feeds answers "what is stopping production today", so it
   * reads requirements rather than re-running the planner: a shortage a
   * planner has already seen and acted on should not change under them.
   */
  async listShortages(
    organizationId: string,
    query: { page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; uncoveredOnly?: boolean },
  ) {
    const where: Prisma.MaterialRequirementWhereInput = {
      organizationId,
      shortageQty: { gt: 0 },
      ...(query.uncoveredOnly ? { openPurchaseQty: { equals: 0 } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.materialRequirement.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          rawMaterial: { select: { id: true, materialCode: true, name: true, category: true, baseUom: true } },
          manufacturingOrder: { select: { id: true, moNo: true, status: true, dueDate: true } },
          mrpRun: { select: { id: true, runNo: true, createdAt: true } },
        },
      }),
      this.prisma.materialRequirement.count({ where }),
    ]);

    return paginated(
      rows.map((r) => ({
        ...r,
        uncoveredShortageQty: Decimal.max(
          qty(r.shortageQty.toFixed()).minus(qty(r.openPurchaseQty.toFixed())),
          0,
        ).toFixed(4),
      })),
      total,
      query,
    );
  }

  /**
   * Turn purchase suggestions into a requisition.
   *
   * Quantities come from the request rather than being recomputed, because a
   * planner routinely adjusts them — and a suggestion acted on hours later
   * must not silently change under them.
   */
  async createRequisitionFromRun(
    organizationId: string,
    actorUserId: string,
    body: RequisitionFromMrpRequest,
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const run = await tx.mrpRun.findFirst({
        where: { id: body.mrpRunId, organizationId },
        select: { id: true, runNo: true, status: true },
      });
      if (!run) throw new NotFoundException({ code: 'MRP_RUN_NOT_FOUND', message: 'MRP run not found' });
      if (run.status !== 'COMPLETED') {
        throw new BadRequestException({
          code: 'MRP_RUN_NOT_COMPLETED',
          message: `Run ${run.runNo} is ${run.status}`,
          details: { status: run.status },
        });
      }

      const requirements = await tx.materialRequirement.findMany({
        where: { mrpRunId: run.id, id: { in: body.lines.map((l) => l.materialRequirementId) } },
        select: { id: true, rawMaterialId: true, uom: true },
      });
      const byId = new Map(requirements.map((r) => [r.id, r]));

      for (const line of body.lines) {
        const req = byId.get(line.materialRequirementId);
        if (!req) {
          throw new BadRequestException({
            code: 'REQUIREMENT_NOT_IN_RUN',
            message: 'A suggestion does not belong to this MRP run',
            details: { materialRequirementId: line.materialRequirementId, mrpRunId: run.id },
          });
        }
        if (req.rawMaterialId !== line.rawMaterialId) {
          throw new BadRequestException({
            code: 'REQUIREMENT_MATERIAL_MISMATCH',
            message: 'A suggestion names a different material than the requirement it points at',
            details: { materialRequirementId: req.id, expected: req.rawMaterialId, received: line.rawMaterialId },
          });
        }
      }

      const requisitionNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.PURCHASE_REQUISITION);
      const created = await tx.purchaseRequisition.create({
        data: {
          organizationId,
          requisitionNo,
          status: 'PENDING_APPROVAL',
          requiredByDate: body.requiredByDate ? new Date(body.requiredByDate) : null,
          mrpRunId: run.id,
          raisedByUserId: actorUserId,
          remarks: body.remarks ?? `Raised from MRP run ${run.runNo}`,
          items: {
            create: body.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              requestedQty: new Prisma.Decimal(l.requestedQty),
              uom: byId.get(l.materialRequirementId)!.uom,
              suggestedSupplierId: l.suggestedSupplierId ?? null,
              materialRequirementId: l.materialRequirementId,
            })),
          },
        },
        include: { items: true },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE', entityType: 'PurchaseRequisition', entityId: created.id,
          context: { requisitionNo, mrpRunId: run.id, mrpRunNo: run.runNo, lineCount: body.lines.length },
        },
        tx,
      );

      return created;
    });
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async presentRun(organizationId: string, id: string, client?: Prisma.TransactionClient) {
    const db = client ?? this.prisma;
    const run = await db.mrpRun.findFirst({
      where: { id, organizationId },
      include: {
        requirements: {
          include: {
            rawMaterial: { select: { id: true, materialCode: true, name: true, category: true, baseUom: true } },
            manufacturingOrder: { select: { id: true, moNo: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        requisitions: { select: { id: true, requisitionNo: true, status: true } },
      },
    });
    if (!run) throw new NotFoundException({ code: 'MRP_RUN_NOT_FOUND', message: 'MRP run not found' });

    // Aggregate for display: the same material required by three orders is one
    // purchasing decision, not three.
    const byMaterial = new Map<string, AggregatedLine>();
    for (const r of run.requirements) {
      const acc = byMaterial.get(r.rawMaterialId) ?? {
        rawMaterialId: r.rawMaterialId,
        material: r.rawMaterial,
        uom: r.uom,
        netRequiredQty: new Decimal(0),
        wastageQty: new Decimal(0),
        grossRequiredQty: new Decimal(0),
        availableQty: qty(r.availableQty.toFixed()),
        reservedElsewhereQty: qty(r.reservedElsewhereQty.toFixed()),
        openPurchaseQty: qty(r.openPurchaseQty.toFixed()),
        expectedArrivalDate: r.expectedArrivalDate,
        unitCost: qty(r.estimatedUnitCost?.toFixed() ?? '0'),
        orderCount: 0,
      };
      acc.netRequiredQty = acc.netRequiredQty.plus(qty(r.netRequiredQty.toFixed()));
      acc.wastageQty = acc.wastageQty.plus(qty(r.wastageQty.toFixed()));
      acc.grossRequiredQty = acc.grossRequiredQty.plus(qty(r.grossRequiredQty.toFixed()));
      if (r.manufacturingOrderId) acc.orderCount += 1;
      byMaterial.set(r.rawMaterialId, acc);
    }

    const lines = [...byMaterial.values()]
      .map((a) => {
        const shortage = Decimal.max(a.grossRequiredQty.minus(a.availableQty), 0);
        const uncovered = Decimal.max(shortage.minus(a.openPurchaseQty), 0);
        return {
          rawMaterialId: a.rawMaterialId,
          materialCode: a.material.materialCode,
          materialName: a.material.name,
          category: a.material.category,
          uom: a.uom,
          netRequiredQty: a.netRequiredQty.toFixed(4),
          wastageQty: a.wastageQty.toFixed(4),
          grossRequiredQty: a.grossRequiredQty.toFixed(4),
          availableQty: a.availableQty.toFixed(4),
          reservedElsewhereQty: a.reservedElsewhereQty.toFixed(4),
          openPurchaseQty: a.openPurchaseQty.toFixed(4),
          expectedArrivalDate: a.expectedArrivalDate,
          shortageQty: shortage.toFixed(4),
          uncoveredShortageQty: uncovered.toFixed(4),
          shortageValue: shortage.times(a.unitCost).toDecimalPlaces(2).toFixed(2),
          unitCost: a.unitCost.toFixed(6),
          estimatedCost: a.grossRequiredQty.times(a.unitCost).toDecimalPlaces(2).toFixed(2),
          readiness: shortage.lessThanOrEqualTo(0)
            ? 'READY'
            : uncovered.greaterThan(0)
              ? 'SHORT'
              : 'PARTIALLY_AVAILABLE',
          orderCount: a.orderCount,
        };
      })
      .sort((a, b) => (a.materialCode < b.materialCode ? -1 : 1));

    return {
      id: run.id,
      runNo: run.runNo,
      status: run.status,
      scope: run.scope,
      parameters: run.parameters,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      shortageLineCount: lines.filter((l) => Number(l.shortageQty) > 0).length,
      totalShortageValue: run.totalShortageValue.toFixed(2),
      isProductionReady: lines.every((l) => Number(l.shortageQty) === 0),
      lines,
      requirementIdsByMaterial: Object.fromEntries(
        [...byMaterial.keys()].map((materialId) => [
          materialId,
          run.requirements.filter((r) => r.rawMaterialId === materialId).map((r) => r.id),
        ]),
      ),
      requisitions: run.requisitions,
    };
  }

  private async resolveOrderBom(
    tx: Prisma.TransactionClient,
    organizationId: string,
    order: { id: string; moNo: string; productId: string; bomVersionId: string | null; items: { productVariantId: string }[] },
  ): Promise<string> {
    if (order.bomVersionId) return order.bomVersionId;

    const first = order.items[0];
    const resolved = first
      ? await this.bom.resolveBomVersionId(tx, organizationId, order.productId, first.productVariantId)
      : await this.styleLevelBomVersionId(tx, organizationId, order.productId);

    if (!resolved) {
      throw new BadRequestException({
        code: 'NO_APPROVED_BOM',
        message: `Order ${order.moNo} has no approved BOM, so its material requirement cannot be computed`,
        details: { manufacturingOrderId: order.id, productId: order.productId },
      });
    }
    return resolved;
  }

  private async styleLevelBomVersionId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productId: string,
  ): Promise<string | null> {
    const found = await tx.bomVersion.findFirst({
      where: { status: 'APPROVED', bom: { organizationId, productId, productVariantId: null } },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    return found?.id ?? null;
  }
}

interface PlannedOrder {
  readonly manufacturingOrderId: string | null;
  readonly bomVersionId: string | null;
  readonly result: MrpResult;
}

interface AggregatedLine {
  rawMaterialId: string;
  material: { materialCode: string; name: string; category: string; baseUom: string };
  uom: string;
  netRequiredQty: Decimal;
  wastageQty: Decimal;
  grossRequiredQty: Decimal;
  availableQty: Decimal;
  reservedElsewhereQty: Decimal;
  openPurchaseQty: Decimal;
  expectedArrivalDate: Date | null;
  unitCost: Decimal;
  orderCount: number;
}
