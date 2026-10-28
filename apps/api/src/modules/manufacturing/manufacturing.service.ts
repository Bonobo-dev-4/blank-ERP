import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LocationKind as DbLocationKind, type UomCode as DbUomCode } from '@prisma/client';
import {
  Decimal, ISSUABLE_KINDS, allocateFromStock, amount, assessMoRelease, assertMoTransition,
  authoriseMoRelease, explodeBom, isMoEditable, qty, rollupMoQuantities, runMrp, snapshotBom,
  type AllocationConstraints, type BalanceRow, type LotAttributes, type MrpResult,
  type ProductionDemandLine, type UomCode,
} from '@dnd/domain';
import type {
  AuthenticatedUser, CreateManufacturingOrderRequest, ReleaseManufacturingOrderRequest,
  ReserveMaterialRequest, UpdateManufacturingOrderRequest,
} from '@dnd/contracts';
import type { OrderPriority } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { crmForManufacturingOrders, moIdsWithOrderPriority } from '../order-crm/crm-lookup';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';
import { BomService } from '../bom/bom.service';
import { MrpService } from '../mrp/mrp.service';
import { LedgerService } from '../inventory/ledger.service';

const ORDER_INCLUDE = {
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      productVariant: {
        select: { id: true, sku: true, size: true, color: true, sizeSortOrder: true, name: true },
      },
    },
  },
  product: { select: { id: true, styleCode: true, name: true, category: true } },
  bomVersion: {
    select: { id: true, version: true, status: true, bom: { select: { id: true, bomCode: true } } },
  },
  route: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ManufacturingOrderInclude;

/**
 * Manufacturing orders.
 *
 * The load-bearing operation here is `release`. Releasing an order does two
 * things in one transaction that must never come apart:
 *
 *   1. pins the BOM version onto the order, and
 *   2. copies that version's lines into `MoBomSnapshotLine`.
 *
 * Everything downstream — costing, wastage analysis, issue limits, variance —
 * reads the **snapshot**, never the master BOM. Without it, editing a BOM would
 * silently rewrite the recipe of orders already being cut on the floor, and the
 * variance report would compare today's actuals against a plan that never
 * existed when the work was done.
 */
@Injectable()
export class ManufacturingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bom: BomService,
    private readonly mrp: MrpService,
    private readonly ledger: LedgerService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async list(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      status?: string; productId?: string; priority?: string; overdueOnly?: boolean; dueBefore?: string;
      orderPriority?: OrderPriority;
    },
  ) {
    const where: Prisma.ManufacturingOrderWhereInput = {
      organizationId,
      ...(query.orderPriority
        ? { id: { in: await moIdsWithOrderPriority(this.prisma, organizationId, query.orderPriority) } }
        : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.priority ? { priority: query.priority as never } : {}),
      ...(query.dueBefore ? { dueDate: { lte: new Date(query.dueBefore) } } : {}),
      ...(query.overdueOnly
        ? {
            dueDate: { lt: new Date() },
            status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] },
          }
        : {}),
      ...(searchFilter(query.search, ['moNo', 'primarySourceDocNo']) ?? {}),
    };

    const args = pageArgs(query, ['moNo', 'createdAt', 'dueDate', 'priority'], 'createdAt');
    const [rows, total] = await Promise.all([
      this.prisma.manufacturingOrder.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { createdAt: 'desc' },
        include: ORDER_INCLUDE,
      }),
      this.prisma.manufacturingOrder.count({ where }),
    ]);

    // The customer promise behind each order: shown to production, never acted on automatically.
    const crm = await crmForManufacturingOrders(this.prisma, organizationId, rows.map((o) => o.id));
    return paginated(rows.map((o) => ({ ...this.decorateOrder(o), crm: crm.get(o.id) ?? null })), total, query);
  }

  async get(organizationId: string, id: string) {
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { id, organizationId },
      include: {
        ...ORDER_INCLUDE,
        bomSnapshotLines: { orderBy: { lineNo: 'asc' } },
        reservations: {
          where: { status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] } },
          include: {
            rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } },
            materialLot: { select: { id: true, lotCode: true, shade: true } },
            location: { select: { id: true, code: true, name: true } },
          },
        },
        requirements: {
          include: { rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({ code: 'MANUFACTURING_ORDER_NOT_FOUND', message: 'Manufacturing order not found' });
    }

    const crm = await crmForManufacturingOrders(this.prisma, organizationId, [order.id]);
    return {
      ...this.decorateOrder(order),
      crm: crm.get(order.id) ?? null,
      // Quantities are formatted at the column's own scale here rather than
      // left to the generic serialiser, which emits the shortest exact string
      // ("2.5", not "2.5000"). The snapshot is the authoritative record of what
      // the order was released against, so it reads the same everywhere.
      bomSnapshotLines: order.bomSnapshotLines.map((l) => ({
        ...l,
        consumptionQtyPerUnit: l.consumptionQtyPerUnit.toFixed(4),
        wastageQtyPerUnit: l.wastageQtyPerUnit.toFixed(4),
        grossQtyPerUnit: l.grossQtyPerUnit.toFixed(4),
        unitCost: l.unitCost.toFixed(6),
        plannedQty: l.plannedQty.toFixed(4),
        plannedCost: l.plannedCost.toFixed(2),
        // The snapshot is the authority for a released order. Labelling it as
        // such in the payload stops a UI from quietly showing master-BOM
        // figures beside it as if they were the same thing.
        source: 'FROZEN_AT_RELEASE' as const,
      })),
      reservations: order.reservations,
      requirements: order.requirements,
    };
  }

  /**
   * Live material readiness for an order.
   *
   * Read-only and never persisted: this is what the MO detail screen shows
   * while a planner decides whether to release. The figures that get frozen
   * are written by `release`, from its own transaction.
   */
  async readiness(organizationId: string, id: string) {
    return this.prisma.inTransaction(async (tx) => {
      const order = await this.loadOrder(tx, organizationId, id);
      const { result, bomVersionId, criticality } = await this.planOrder(tx, organizationId, order);

      const assessment = assessMoRelease(result.lines, criticality, {
        plannedQty: order.orderedQty.toFixed(),
      });

      return {
        manufacturingOrderId: order.id,
        moNo: order.moNo,
        status: order.status,
        bomVersionId,
        orderedQty: order.orderedQty.toFixed(4),
        maxProducibleQty: assessment.maxProducibleQty.toFixed(4),
        isClear: assessment.isClear,
        requiresShortageOverride: assessment.requiresOverride,
        totalShortageValue: assessment.totalShortageValue.toFixed(2),
        totalEstimatedCost: result.totalEstimatedCost.toFixed(2),
        lines: result.lines.map((l) => ({
          rawMaterialId: l.rawMaterialId,
          materialCode: l.materialCode,
          materialName: l.materialName,
          uom: l.uom,
          isCritical: criticality[l.rawMaterialId] ?? true,
          netRequiredQty: l.netRequiredQty.toFixed(4),
          wastageQty: l.wastageQty.toFixed(4),
          grossRequiredQty: l.grossRequiredQty.toFixed(4),
          availableQty: l.availableQty.toFixed(4),
          reservedElsewhereQty: l.reservedElsewhereQty.toFixed(4),
          openPurchaseQty: l.openPurchaseQty.toFixed(4),
          expectedArrivalDate: l.expectedArrivalDate,
          shortageQty: l.shortageQty.toFixed(4),
          suggestedPurchaseQty: l.suggestedPurchaseQty.toFixed(4),
          unitCost: l.unitCost.toFixed(6),
          estimatedCost: l.estimatedCost.toFixed(2),
          readiness: l.readiness,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // writes
  // -------------------------------------------------------------------------

  async create(organizationId: string, actorUserId: string, body: CreateManufacturingOrderRequest) {
    const work = () =>
      this.prisma.inTransaction(async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: body.productId, organizationId },
          select: { id: true, styleCode: true, name: true, category: true },
        });
        if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

        const variants = await tx.productVariant.findMany({
          where: {
            id: { in: body.items.map((i) => i.productVariantId) },
            organizationId,
            productId: body.productId,
          },
          select: { id: true, sku: true, size: true, color: true },
        });
        if (variants.length !== body.items.length) {
          const found = new Set(variants.map((v) => v.id));
          throw new BadRequestException({
            code: 'VARIANT_NOT_IN_PRODUCT',
            message: 'One or more SKUs do not belong to this style',
            details: { missingIds: body.items.map((i) => i.productVariantId).filter((id) => !found.has(id)) },
          });
        }
        const variantById = new Map(variants.map((v) => [v.id, v]));

        const orderedQty = body.items.reduce<Decimal>((acc, i) => acc.plus(qty(i.orderedQty)), new Decimal(0));
        const moNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.MANUFACTURING_ORDER);

        const created = await tx.manufacturingOrder.create({
          data: {
            organizationId,
            moNo,
            status: 'DRAFT',
            priority: body.priority,
            productionType: body.productionType,
            productId: body.productId,
            // Only pinned when the order really is a single SKU; the size
            // breakdown always lives on the item rows.
            productVariantId: body.items.length === 1 ? body.items[0].productVariantId : null,
            primarySourceSystem: 'MANUAL',
            orderedQty: new Prisma.Decimal(orderedQty.toFixed(4)),
            routeId: body.routeId ?? null,
            plannedStartDate: body.plannedStartDate ? new Date(body.plannedStartDate) : null,
            plannedEndDate: body.plannedEndDate ? new Date(body.plannedEndDate) : null,
            dueDate: body.dueDate ? new Date(body.dueDate) : null,
            manufacturingLocationId: body.manufacturingLocationId ?? null,
            supervisorUserId: body.supervisorUserId ?? null,
            remarks: body.remarks ?? null,
            idempotencyKey: body.idempotencyKey ?? null,
            createdByUserId: actorUserId,
            items: {
              create: body.items.map((i, index) => {
                const v = variantById.get(i.productVariantId)!;
                return {
                  lineNo: index + 1,
                  productVariantId: i.productVariantId,
                  size: v.size,
                  color: v.color,
                  orderedQty: new Prisma.Decimal(i.orderedQty),
                };
              }),
            },
          },
          include: ORDER_INCLUDE,
        });

        await this.audit.record(
          {
            organizationId, actorUserId, action: 'CREATE',
            entityType: 'ManufacturingOrder', entityId: created.id,
            context: { moNo, productId: body.productId, orderedQty: orderedQty.toFixed(4), lineCount: body.items.length },
          },
          tx,
        );

        return { result: this.decorateOrder(created), entityId: created.id };
      });

    if (!body.idempotencyKey) return (await work()).result;

    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'manufacturing.create',
        key: body.idempotencyKey,
        payload: body,
        entityType: 'ManufacturingOrder',
      },
      work,
    );
    return result;
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: UpdateManufacturingOrderRequest,
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const order = await this.loadOrder(tx, organizationId, id);
      if (!isMoEditable(order.status)) {
        throw new ConflictException({
          code: 'MO_NOT_EDITABLE',
          message: `Order ${order.moNo} is ${order.status}; the floor is already working to these quantities`,
          details: { status: order.status },
        });
      }

      let orderedQty = qty(order.orderedQty.toFixed());
      if (body.items) {
        const variants = await tx.productVariant.findMany({
          where: {
            id: { in: body.items.map((i) => i.productVariantId) },
            organizationId,
            productId: order.productId,
          },
          select: { id: true, size: true, color: true },
        });
        if (variants.length !== body.items.length) {
          throw new BadRequestException({
            code: 'VARIANT_NOT_IN_PRODUCT',
            message: 'One or more SKUs do not belong to this style',
          });
        }
        const variantById = new Map(variants.map((v) => [v.id, v]));

        await tx.manufacturingOrderItem.deleteMany({ where: { manufacturingOrderId: id } });
        for (const [index, item] of body.items.entries()) {
          const v = variantById.get(item.productVariantId)!;
          await tx.manufacturingOrderItem.create({
            data: {
              manufacturingOrderId: id,
              lineNo: index + 1,
              productVariantId: item.productVariantId,
              size: v.size,
              color: v.color,
              orderedQty: new Prisma.Decimal(item.orderedQty),
            },
          });
        }
        orderedQty = body.items.reduce<Decimal>((acc, i) => acc.plus(qty(i.orderedQty)), new Decimal(0));
      }

      const updated = await tx.manufacturingOrder.update({
        where: { id },
        data: {
          ...(body.priority ? { priority: body.priority } : {}),
          ...(body.productionType ? { productionType: body.productionType } : {}),
          ...(body.routeId !== undefined ? { routeId: body.routeId ?? null } : {}),
          ...(body.plannedStartDate !== undefined
            ? { plannedStartDate: body.plannedStartDate ? new Date(body.plannedStartDate) : null }
            : {}),
          ...(body.plannedEndDate !== undefined
            ? { plannedEndDate: body.plannedEndDate ? new Date(body.plannedEndDate) : null }
            : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? new Date(body.dueDate) : null } : {}),
          ...(body.manufacturingLocationId !== undefined
            ? { manufacturingLocationId: body.manufacturingLocationId ?? null }
            : {}),
          ...(body.supervisorUserId !== undefined ? { supervisorUserId: body.supervisorUserId ?? null } : {}),
          ...(body.remarks !== undefined ? { remarks: body.remarks ?? null } : {}),
          ...(body.items ? { orderedQty: new Prisma.Decimal(orderedQty.toFixed(4)) } : {}),
        },
        include: ORDER_INCLUDE,
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'UPDATE',
          entityType: 'ManufacturingOrder', entityId: id,
          context: { moNo: order.moNo, itemsReplaced: Boolean(body.items) },
        },
        tx,
      );

      return this.decorateOrder(updated);
    });
  }

  /**
   * Reserve stock against the order's requirements.
   *
   * Reservation is a claim, not a movement: the material stays exactly where it
   * is and nothing leaves the warehouse. What changes is that nobody else's
   * order can promise the same metre. Issuing — which does move it — is a
   * separate, later act.
   */
  async reserve(organizationId: string, actorUserId: string, id: string, body: ReserveMaterialRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'manufacturing.reserve',
        key: body.idempotencyKey,
        payload: { manufacturingOrderId: id, ...body },
        entityType: 'ManufacturingOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const order = await this.loadOrder(tx, organizationId, id);
          if (!isMoEditable(order.status)) {
            throw new ConflictException({
              code: 'MO_NOT_RESERVABLE',
              message: `Order ${order.moNo} is ${order.status}; material is reserved before release, not after`,
              details: { status: order.status },
            });
          }

          const { result: plan, bomVersionId } = await this.planOrder(tx, organizationId, order);

          const wanted = body.rawMaterialIds ? new Set(body.rawMaterialIds) : null;
          const lines = plan.lines.filter((l) => !wanted || wanted.has(l.rawMaterialId));

          // Reservations already held by THIS order count towards what it
          // needs; re-running reservation must top up, never double-book.
          const existing = await tx.materialReservation.groupBy({
            by: ['rawMaterialId'],
            where: { manufacturingOrderId: id, status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] } },
            _sum: { reservedQty: true },
          });
          const heldByMaterial = new Map(
            existing.map((e) => [e.rawMaterialId, qty(e._sum.reservedQty?.toFixed() ?? '0')]),
          );

          const outcomes: ReservationOutcome[] = [];

          for (const line of lines) {
            const held = heldByMaterial.get(line.rawMaterialId) ?? new Decimal(0);
            const stillNeeded = Decimal.max(line.grossRequiredQty.minus(held), 0);
            if (stillNeeded.lessThanOrEqualTo(0)) {
              outcomes.push({
                rawMaterialId: line.rawMaterialId,
                materialCode: line.materialCode ?? line.rawMaterialId,
                requiredQty: line.grossRequiredQty.toFixed(4),
                alreadyReservedQty: held.toFixed(4),
                newlyReservedQty: '0.0000',
                shortfallQty: '0.0000',
                shadesUsed: [],
              });
              continue;
            }

            const { rows, lots } = await this.loadStockForAllocation(tx, organizationId, line.rawMaterialId);
            const constraints: AllocationConstraints = { singleShade: body.singleShade };
            const allocation = allocateFromStock(stillNeeded.toFixed(4), rows, lots, constraints);

            for (const alloc of allocation.lines) {
              await this.ledger.reserve(tx, {
                organizationId,
                rawMaterialId: line.rawMaterialId,
                materialLotId: alloc.materialLotId,
                locationId: alloc.locationId,
                manufacturingOrderId: id,
                qty: alloc.qty.toFixed(4),
                reservedByUserId: actorUserId,
                // Scoped so re-running reservation for a different material
                // cannot collide with this row's key.
                idempotencyKey: `${body.idempotencyKey}:${line.rawMaterialId}:${alloc.materialLotId}:${alloc.locationId}`,
              });
            }

            outcomes.push({
              rawMaterialId: line.rawMaterialId,
              materialCode: line.materialCode ?? line.rawMaterialId,
              requiredQty: line.grossRequiredQty.toFixed(4),
              alreadyReservedQty: held.toFixed(4),
              newlyReservedQty: allocation.allocatedQty.toFixed(4),
              shortfallQty: allocation.shortfallQty.toFixed(4),
              shadesUsed: allocation.shadesUsed,
            });
          }

          const fullyReserved = outcomes.every((o) => Number(o.shortfallQty) === 0);
          const nextStatus = fullyReserved ? 'MATERIAL_RESERVED' : 'PENDING_MATERIAL';
          assertMoTransition(order.status, nextStatus);
          await tx.manufacturingOrder.update({
            where: { id },
            data: { status: nextStatus, bomVersionId: order.bomVersionId ?? bomVersionId },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'RESERVE',
              entityType: 'ManufacturingOrder', entityId: id,
              context: {
                moNo: order.moNo,
                materialCount: outcomes.length,
                fullyReserved,
                singleShade: body.singleShade,
              },
            },
            tx,
          );

          return {
            result: {
              manufacturingOrderId: id,
              moNo: order.moNo,
              status: nextStatus,
              fullyReserved,
              materials: outcomes,
            },
            entityId: id,
          };
        }),
    );
    return result;
  }

  /**
   * Release an order to the floor.
   *
   * THE critical operation of phase 2. In one transaction it freezes the BOM
   * version onto the order and copies its lines into `MoBomSnapshotLine`. If
   * those two ever separated, a BOM edit would rewrite the recipe of work
   * already in progress.
   */
  async release(
    organizationId: string,
    user: AuthenticatedUser,
    id: string,
    body: ReleaseManufacturingOrderRequest,
  ) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'manufacturing.release',
        key: body.idempotencyKey,
        payload: { manufacturingOrderId: id, ...body },
        entityType: 'ManufacturingOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const order = await this.loadOrder(tx, organizationId, id);
          assertMoTransition(order.status, 'RELEASED');

          const releaseQty = body.releaseQty ? qty(body.releaseQty) : qty(order.orderedQty.toFixed());
          const { result: plan, bomVersionId, criticality, explosion } = await this.planOrder(
            tx,
            organizationId,
            order,
            body.bomVersionId ?? null,
            releaseQty,
          );

          const assessment = assessMoRelease(plan.lines, criticality, {
            plannedQty: order.orderedQty.toFixed(),
            releaseQty: releaseQty.toFixed(),
          });

          // Permission is checked here rather than on the route because it is
          // conditional: `manufacturing.release` is enough for a clear order,
          // and only a shortage escalates the requirement.
          authoriseMoRelease(assessment, {
            hasShortageOverride: user.permissions.includes('manufacturing.release_with_shortage'),
            reason: body.shortageOverrideReason,
          });

          // ---- the freeze -------------------------------------------------
          const snapshot = snapshotBom(explosion.bom, explosion.result);
          await tx.moBomSnapshotLine.createMany({
            data: snapshot.map((l) => ({
              manufacturingOrderId: id,
              bomVersionId,
              lineNo: l.lineNo,
              rawMaterialId: l.rawMaterialId,
              materialCode: l.materialCode,
              materialName: l.materialName,
              consumptionQtyPerUnit: new Prisma.Decimal(l.consumptionQtyPerUnit.toFixed(4)),
              wastageQtyPerUnit: new Prisma.Decimal(l.wastageQtyPerUnit.toFixed(4)),
              grossQtyPerUnit: new Prisma.Decimal(l.grossQtyPerUnit.toFixed(4)),
              uom: l.uom as DbUomCode,
              unitCost: new Prisma.Decimal(l.unitCost.toFixed(6)),
              plannedQty: new Prisma.Decimal(l.plannedQty.toFixed(4)),
              plannedCost: new Prisma.Decimal(l.plannedCost.toFixed(2)),
              productionStageCode: l.productionStageCode,
            })),
          });
          // -------------------------------------------------------------------

          const plannedMaterialCost = amount(explosion.result.totalMaterialCost);

          // Release proportionally across the size lines, so a partial release
          // keeps the size ratio the order was planned with rather than
          // emptying the first line first.
          const ordered = qty(order.orderedQty.toFixed());
          let allocated = new Decimal(0);
          const itemReleases = order.items.map((item, index) => {
            const isLast = index === order.items.length - 1;
            const share = ordered.greaterThan(0)
              ? qty(item.orderedQty.toFixed()).dividedBy(ordered).times(releaseQty)
              : new Decimal(0);
            // The last line absorbs the rounding, so the lines always add up
            // to exactly the released quantity.
            const value = isLast ? releaseQty.minus(allocated) : share.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
            allocated = allocated.plus(value);
            return { id: item.id, releasedQty: Decimal.max(value, 0) };
          });

          for (const r of itemReleases) {
            await tx.manufacturingOrderItem.update({
              where: { id: r.id },
              data: { releasedQty: new Prisma.Decimal(r.releasedQty.toFixed(4)), bomVersionId },
            });
          }

          await tx.manufacturingOrder.update({
            where: { id },
            data: {
              status: 'RELEASED',
              bomVersionId,
              releasedQty: new Prisma.Decimal(releaseQty.toFixed(4)),
              plannedMaterialCost: new Prisma.Decimal(plannedMaterialCost.toFixed(2)),
              plannedTotalCost: new Prisma.Decimal(plannedMaterialCost.toFixed(2)),
              releasedByUserId: user.id,
              releasedAt: new Date(),
              actualStartDate: order.actualStartDate ?? new Date(),
              shortageOverrideByUserId: assessment.requiresOverride ? user.id : null,
              shortageOverrideReason: assessment.requiresOverride ? (body.shortageOverrideReason ?? null) : null,
            },
          });

          // Persist the requirements this release was judged against, so the
          // variance report later compares actuals with the plan that was
          // actually in force.
          for (const line of plan.lines) {
            await tx.materialRequirement.create({
              data: {
                organizationId,
                manufacturingOrderId: id,
                bomVersionId,
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

          await this.audit.record(
            {
              organizationId, actorUserId: user.id, action: 'RELEASE',
              entityType: 'ManufacturingOrder', entityId: id,
              context: {
                moNo: order.moNo,
                bomVersionId,
                releasedQty: releaseQty.toFixed(4),
                snapshotLineCount: snapshot.length,
                plannedMaterialCost: plannedMaterialCost.toFixed(2),
                releasedWithShortage: assessment.requiresOverride,
                shortageOverrideReason: assessment.requiresOverride ? body.shortageOverrideReason : null,
                shortages: assessment.criticalShortages.map((s) => ({
                  materialCode: s.materialCode,
                  shortageQty: s.shortageQty.toFixed(4),
                })),
              },
            },
            tx,
          );

          return {
            result: {
              manufacturingOrderId: id,
              moNo: order.moNo,
              status: 'RELEASED' as const,
              bomVersionId,
              releasedQty: releaseQty.toFixed(4),
              snapshotLineCount: snapshot.length,
              plannedMaterialCost: plannedMaterialCost.toFixed(2),
              releasedWithShortage: assessment.requiresOverride,
            },
            entityId: id,
          };
        }),
    );
    return result;
  }

  /** Put an order on hold, or take it off hold. */
  async setHold(organizationId: string, actorUserId: string, id: string, hold: boolean, reason?: string | null) {
    return this.prisma.inTransaction(async (tx) => {
      const order = await this.loadOrder(tx, organizationId, id);
      const target = hold ? 'ON_HOLD' : 'RELEASED';
      assertMoTransition(order.status, target);

      await tx.manufacturingOrder.update({
        where: { id },
        data: { status: target, remarks: reason ?? order.remarks },
      });
      await this.audit.record(
        {
          organizationId, actorUserId, action: hold ? 'HOLD' : 'RESUME',
          entityType: 'ManufacturingOrder', entityId: id,
          context: { moNo: order.moNo, from: order.status, reason: reason ?? null },
        },
        tx,
      );
      return { manufacturingOrderId: id, moNo: order.moNo, status: target };
    });
  }

  /**
   * Cancel an order and release everything it was holding.
   *
   * Reservations must come back: an order nobody will ever make must not keep
   * material promised, or the warehouse slowly fills with stock that is
   * available in reality and unavailable in the system.
   */
  async cancel(organizationId: string, actorUserId: string, id: string, reason: string) {
    return this.prisma.inTransaction(async (tx) => {
      const order = await this.loadOrder(tx, organizationId, id);
      assertMoTransition(order.status, 'CANCELLED');

      const reservations = await tx.materialReservation.findMany({
        where: { manufacturingOrderId: id, status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] } },
        select: { id: true },
      });
      let released = new Decimal(0);
      for (const r of reservations) {
        const { releasedQty } = await this.ledger.releaseReservation(tx, r.id);
        released = released.plus(qty(releasedQty));
      }

      await tx.manufacturingOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: reason,
          cancelledQty: new Prisma.Decimal(
            qty(order.orderedQty.toFixed()).minus(qty(order.inwardedQty.toFixed())).toFixed(4),
          ),
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CANCEL',
          entityType: 'ManufacturingOrder', entityId: id,
          context: {
            moNo: order.moNo,
            from: order.status,
            reason,
            reservationsReleased: reservations.length,
            quantityReleased: released.toFixed(4),
          },
        },
        tx,
      );

      return {
        manufacturingOrderId: id,
        moNo: order.moNo,
        status: 'CANCELLED' as const,
        reservationsReleased: reservations.length,
        quantityReleased: released.toFixed(4),
      };
    });
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async loadOrder(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const order = await tx.manufacturingOrder.findFirst({
      where: { id, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException({ code: 'MANUFACTURING_ORDER_NOT_FOUND', message: 'Manufacturing order not found' });
    }
    return order;
  }

  /**
   * Explode an order's BOM and plan it against live stock.
   *
   * Shared by readiness, reservation and release so all three agree. Three
   * separate implementations of "what does this order need" is exactly how a
   * planner comes to see one number on screen and a different one in an error.
   */
  private async planOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    order: Prisma.ManufacturingOrderGetPayload<{ include: typeof ORDER_INCLUDE }>,
    overrideBomVersionId: string | null = null,
    forQty?: Decimal,
  ) {
    const first = order.items[0];
    if (!first) {
      throw new BadRequestException({
        code: 'MO_HAS_NO_ITEMS',
        message: `Order ${order.moNo} has no SKU lines`,
      });
    }

    const bomVersionId =
      overrideBomVersionId ??
      order.bomVersionId ??
      (await this.bom.resolveBomVersionId(tx, organizationId, order.productId, first.productVariantId));

    if (!bomVersionId) {
      throw new BadRequestException({
        code: 'NO_APPROVED_BOM',
        message: `Order ${order.moNo} has no approved BOM, so its material requirement cannot be computed`,
        details: { manufacturingOrderId: order.id, productId: order.productId },
      });
    }

    const { domain, criticality } = await this.bom.loadForExplosion(tx, organizationId, bomVersionId);

    const ordered = qty(order.orderedQty.toFixed());
    const scale = forQty && ordered.greaterThan(0) ? forQty.dividedBy(ordered) : new Decimal(1);

    const demand: ProductionDemandLine[] = order.items.map((i) => ({
      productVariantId: i.productVariantId,
      size: i.size ?? i.productVariant.size,
      quantity: qty(qty(i.orderedQty.toFixed()).times(scale)).toFixed(4),
    }));

    const result = explodeBom(domain, demand);
    const supply = await this.mrp.supplyPositions(
      tx,
      organizationId,
      result.requirements.map((r) => r.rawMaterialId),
      // Credit back what this order already holds: its own reservation must
      // not read as a shortage against itself.
      { forManufacturingOrderId: order.id },
    );
    const plan: MrpResult = runMrp(result.requirements, supply, result.plannedQty, {
      requiredByDate: order.plannedStartDate,
    });

    return { result: plan, bomVersionId, criticality, explosion: { bom: domain, result } };
  }

  /** Balance rows and lot attributes for one material, for the allocator. */
  private async loadStockForAllocation(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rawMaterialId: string,
  ): Promise<{ rows: BalanceRow[]; lots: LotAttributes[] }> {
    const balances = await tx.materialBalance.findMany({
      where: {
        rawMaterialId,
        location: { organizationId, kind: { in: [...ISSUABLE_KINDS] as DbLocationKind[] } },
      },
      include: {
        location: { select: { id: true, code: true, kind: true, status: true } },
        materialLot: {
          select: { id: true, shade: true, width: true, receivedAt: true, unitCost: true },
        },
      },
    });

    return {
      rows: balances.map<BalanceRow>((b) => ({
        rawMaterialId: b.rawMaterialId,
        materialLotId: b.materialLotId,
        location: {
          id: b.location.id,
          code: b.location.code,
          kind: b.location.kind,
          // An archived or inactive location still holds stock on paper, but
          // nothing new may be drawn from it.
          blocksIssue: b.location.status !== 'ACTIVE',
        },
        onHandQty: b.onHandQty.toFixed(),
        reservedQty: b.reservedQty.toFixed(),
      })),
      lots: balances.map<LotAttributes>((b) => ({
        materialLotId: b.materialLot.id,
        shade: b.materialLot.shade,
        width: b.materialLot.width?.toFixed() ?? null,
        receivedAt: b.materialLot.receivedAt,
        unitCost: b.materialLot.unitCost?.toFixed() ?? null,
      })),
    };
  }

  /** Header figures derived from the lines, never maintained in parallel. */
  private decorateOrder(order: Prisma.ManufacturingOrderGetPayload<{ include: typeof ORDER_INCLUDE }>) {
    const rollup = rollupMoQuantities(
      order.items.map((i) => ({
        orderedQty: i.orderedQty.toFixed(),
        releasedQty: i.releasedQty.toFixed(),
        completedQty: i.completedQty.toFixed(),
        rejectedQty: i.rejectedQty.toFixed(),
        inwardedQty: i.inwardedQty.toFixed(),
        cancelledQty: i.cancelledQty.toFixed(),
      })),
    );

    const isOpen = !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(order.status);

    return {
      ...order,
      items: order.items.sort((a, b) => a.productVariant.sizeSortOrder - b.productVariant.sizeSortOrder),
      rollup: {
        orderedQty: rollup.orderedQty.toFixed(4),
        releasedQty: rollup.releasedQty.toFixed(4),
        completedQty: rollup.completedQty.toFixed(4),
        rejectedQty: rollup.rejectedQty.toFixed(4),
        inwardedQty: rollup.inwardedQty.toFixed(4),
        cancelledQty: rollup.cancelledQty.toFixed(4),
        pendingReleaseQty: rollup.pendingReleaseQty.toFixed(4),
        completionPct: rollup.completionPct.toFixed(2),
      },
      isEditable: isMoEditable(order.status),
      isOverdue: isOpen && order.dueDate != null && order.dueDate < new Date(),
      hasBomSnapshot: order.bomVersionId != null && order.releasedAt != null,
    };
  }
}

export interface ReservationOutcome {
  readonly rawMaterialId: string;
  readonly materialCode: string;
  readonly requiredQty: string;
  readonly alreadyReservedQty: string;
  readonly newlyReservedQty: string;
  readonly shortfallQty: string;
  readonly shadesUsed: readonly string[];
}
