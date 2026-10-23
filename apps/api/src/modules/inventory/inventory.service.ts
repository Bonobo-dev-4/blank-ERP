import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal, SYSTEM_LOCATIONS, classifyStockLevel, computeStockPosition, dec, qty,
  type MovementType, type UomCode,
} from '@dnd/domain';
import type {
  MaterialConsumptionRequest, MaterialInwardRequest, MaterialIssueRequest,
  MaterialReturnRequest, MaterialTransferRequest, StockAdjustmentRequest,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';
import { LedgerService } from './ledger.service';

/**
 * Inventory operations.
 *
 * Each method is one business document (an inward, an issue, a consumption)
 * wrapped in one transaction, with the ledger doing the actual stock work. The
 * split between ISSUE and CONSUMPTION is the important one: issuing moves
 * material to a department and changes nothing about how much is owned, while
 * consumption retires it into the CONSUMED sink. That is what makes it
 * impossible for the same metre of fabric to be deducted at cutting and again
 * at stitching.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async listBalances(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      rawMaterialId?: string; locationId?: string; materialLotId?: string; nonZeroOnly: boolean;
    },
  ) {
    const where: Prisma.MaterialBalanceWhereInput = {
      organizationId,
      ...(query.rawMaterialId ? { rawMaterialId: query.rawMaterialId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.materialLotId ? { materialLotId: query.materialLotId } : {}),
      ...(query.nonZeroOnly ? { NOT: { onHandQty: new Prisma.Decimal(0) } } : {}),
      ...(query.search
        ? { rawMaterial: { OR: [
            { materialCode: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ] } }
        : {}),
    };

    const args = pageArgs(query, ['onHandQty', 'reservedQty', 'updatedAt'], 'updatedAt');
    const [rows, total] = await Promise.all([
      this.prisma.materialBalance.findMany({
        where, ...args,
        include: {
          rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, category: true } },
          materialLot: { select: { id: true, lotCode: true, shade: true, width: true, isGeneral: true } },
          location: { select: { id: true, code: true, name: true, kind: true, blocksIssue: true } },
        },
      }),
      this.prisma.materialBalance.count({ where }),
    ]);

    return paginated(
      rows.map((r) => ({ ...r, availableQty: r.onHandQty.minus(r.reservedQty) })),
      total,
      query,
    );
  }

  async listMovements(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      rawMaterialId?: string; materialLotId?: string; fabricRollId?: string; locationId?: string;
      movementType?: MovementType; referenceType?: string; referenceId?: string;
      from?: string; to?: string;
    },
  ) {
    const where: Prisma.MaterialMovementWhereInput = {
      organizationId,
      ...(query.rawMaterialId ? { rawMaterialId: query.rawMaterialId } : {}),
      ...(query.materialLotId ? { materialLotId: query.materialLotId } : {}),
      ...(query.fabricRollId ? { fabricRollId: query.fabricRollId } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.referenceId ? { referenceId: query.referenceId } : {}),
      ...(query.locationId
        ? { OR: [{ sourceLocationId: query.locationId }, { destinationLocationId: query.locationId }] }
        : {}),
      ...(query.from || query.to
        ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(searchFilter(query.search, ['movementNo', 'referenceNo', 'reason']) ?? {}),
    };

    const args = pageArgs(query, ['occurredAt', 'movementNo', 'baseQty'], 'occurredAt');
    const [rows, total] = await Promise.all([
      this.prisma.materialMovement.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { occurredAt: 'desc' },
        include: {
          rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } },
          materialLot: { select: { id: true, lotCode: true, shade: true } },
          fabricRoll: { select: { id: true, rollNo: true } },
          sourceLocation: { select: { id: true, code: true, name: true, kind: true } },
          destinationLocation: { select: { id: true, code: true, name: true, kind: true } },
        },
      }),
      this.prisma.materialMovement.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  /** Stock alerts, computed live from the ledger rather than a cached flag. */
  async stockAlerts(organizationId: string) {
    const materials = await this.prisma.rawMaterial.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: {
        id: true, materialCode: true, name: true, category: true, baseUom: true,
        minimumStock: true, reorderLevel: true, reorderQty: true, leadTimeDays: true,
        defaultSupplier: { select: { id: true, name: true } },
      },
    });

    const balances = await this.prisma.materialBalance.findMany({
      where: { organizationId },
      include: { location: { select: { id: true, code: true, kind: true, blocksIssue: true } } },
    });

    const grouped = new Map<string, typeof balances>();
    for (const b of balances) {
      const list = grouped.get(b.rawMaterialId);
      if (list) list.push(b);
      else grouped.set(b.rawMaterialId, [b]);
    }

    const alerts = materials
      .map((m) => {
        const rows = grouped.get(m.id) ?? [];
        const pos = computeStockPosition(
          rows.map((b) => ({
            rawMaterialId: b.rawMaterialId,
            materialLotId: b.materialLotId,
            location: { id: b.locationId, code: b.location.code, kind: b.location.kind as never, blocksIssue: b.location.blocksIssue },
            onHandQty: b.onHandQty.toFixed(),
            reservedQty: b.reservedQty.toFixed(),
          })),
        );
        const level = classifyStockLevel({
          availableQty: pos.availableQty,
          minimumStock: m.minimumStock.toFixed(),
          reorderLevel: m.reorderLevel.toFixed(),
        });
        const shortfall = Decimal.max(
          dec(m.reorderLevel.toFixed()).minus(pos.availableQty),
          0,
        );
        return {
          rawMaterialId: m.id,
          materialCode: m.materialCode,
          materialName: m.name,
          category: m.category,
          baseUom: m.baseUom,
          availableQty: pos.availableQty.toFixed(),
          onHandQty: pos.onHandQty.toFixed(),
          reservedQty: pos.reservedQty.toFixed(),
          qualityHoldQty: pos.qualityHoldQty.toFixed(),
          issuedToProductionQty: pos.issuedToProductionQty.toFixed(),
          minimumStock: m.minimumStock.toFixed(),
          reorderLevel: m.reorderLevel.toFixed(),
          suggestedOrderQty: Decimal.max(shortfall, dec(m.reorderQty.toFixed())).toFixed(),
          leadTimeDays: m.leadTimeDays,
          defaultSupplier: m.defaultSupplier,
          alertLevel: level,
          severity: level === 'OUT_OF_STOCK' ? 'CRITICAL' : level === 'BELOW_MINIMUM' ? 'WARNING' : 'INFO',
        };
      })
      .filter((a) => a.alertLevel !== 'OK')
      .sort((a, b) => severityRank(a.alertLevel) - severityRank(b.alertLevel));

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        outOfStock: alerts.filter((a) => a.alertLevel === 'OUT_OF_STOCK').length,
        belowMinimum: alerts.filter((a) => a.alertLevel === 'BELOW_MINIMUM').length,
        atReorderLevel: alerts.filter((a) => a.alertLevel === 'AT_REORDER_LEVEL').length,
      },
      alerts,
    };
  }

  // -------------------------------------------------------------------------
  // writes
  // -------------------------------------------------------------------------

  /**
   * Direct material inward, for opening balances and corrections outside the
   * purchase flow. Normal supplier deliveries come through the goods receipt
   * flow so they pass inspection first.
   */
  async inward(organizationId: string, actorUserId: string, body: MaterialInwardRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.inward', key: body.idempotencyKey, payload: body, entityType: 'MaterialMovement' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const lotId = await this.resolveOrCreateLot(tx, organizationId, body);
          const externalId = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.EXTERNAL);

          const movement = await this.ledger.postMovement(tx, {
            organizationId,
            movementType: 'OPENING_BALANCE',
            rawMaterialId: body.rawMaterialId,
            materialLotId: lotId,
            sourceLocationId: externalId,
            destinationLocationId: body.destinationLocationId,
            enteredQty: body.quantity,
            enteredUom: body.uom,
            unitCost: body.unitCost ?? null,
            referenceType: 'DirectInward',
            referenceNo: body.lotCode ?? null,
            reason: body.reason,
            remarks: body.remarks ?? null,
            operatorUserId: actorUserId,
            idempotencyKey: body.idempotencyKey,
          });

          if (body.unitCost) {
            await this.ledger.recomputeAverageCost(tx, organizationId, body.rawMaterialId);
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'MaterialMovement', entityId: movement.id,
              context: {
                movementNo: movement.movementNo, movementType: 'OPENING_BALANCE',
                rawMaterialId: body.rawMaterialId, baseQty: movement.baseQty, reason: body.reason,
              },
            },
            tx,
          );
          return movement;
        });
        return { result, entityId: result.id };
      },
    );
  }

  async transfer(organizationId: string, actorUserId: string, body: MaterialTransferRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.transfer', key: body.idempotencyKey, payload: body, entityType: 'MaterialMovement' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const movement = await this.ledger.postMovement(tx, {
            organizationId,
            movementType: 'TRANSFER',
            rawMaterialId: body.rawMaterialId,
            materialLotId: body.materialLotId,
            fabricRollId: body.fabricRollId ?? null,
            sourceLocationId: body.sourceLocationId,
            destinationLocationId: body.destinationLocationId,
            enteredQty: body.quantity,
            enteredUom: body.uom,
            referenceType: 'StockTransfer',
            reason: body.reason ?? 'Internal stock transfer',
            remarks: body.remarks ?? null,
            operatorUserId: actorUserId,
            idempotencyKey: body.idempotencyKey,
          });

          if (body.fabricRollId) {
            await tx.fabricRoll.update({
              where: { id: body.fabricRollId },
              data: { locationId: body.destinationLocationId, version: { increment: 1 } },
            });
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'MaterialMovement', entityId: movement.id,
              context: { movementNo: movement.movementNo, movementType: 'TRANSFER', baseQty: movement.baseQty },
            },
            tx,
          );
          return movement;
        });
        return { result, entityId: result.id };
      },
    );
  }

  /**
   * Issue material to a production department or a job worker.
   *
   * Draws on the manufacturing order's own reservation where one exists, so an
   * order can use the stock it was promised while other orders still cannot.
   */
  async issue(organizationId: string, actorUserId: string, body: MaterialIssueRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.issue', key: body.idempotencyKey, payload: body, entityType: 'MaterialIssue' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const destination = await tx.materialLocation.findFirstOrThrow({
            where: { id: body.destinationLocationId, organizationId },
            select: { kind: true },
          });
          const movementType: MovementType =
            destination.kind === 'JOB_WORKER' ? 'ISSUE_TO_JOB_WORKER' : 'ISSUE_TO_PRODUCTION';

          const issueNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.MATERIAL_ISSUE);
          const issue = await tx.materialIssue.create({
            data: {
              organizationId,
              issueNo,
              manufacturingOrderId: body.manufacturingOrderId ?? null,
              stageTaskId: body.stageTaskId ?? null,
              jobWorkOrderId: body.jobWorkOrderId ?? null,
              sourceLocationId: body.sourceLocationId,
              destinationLocationId: body.destinationLocationId,
              issueType: body.issueType,
              issuedByUserId: actorUserId,
              remarks: body.remarks ?? null,
              idempotencyKey: body.idempotencyKey,
            },
            select: { id: true, issueNo: true },
          });

          const lines: { lineNo: number; movementNo: string; baseQty: string }[] = [];

          for (let i = 0; i < body.lines.length; i += 1) {
            const line = body.lines[i]!;
            const cover = body.manufacturingOrderId
              ? await this.openReservationQty(tx, {
                  organizationId,
                  manufacturingOrderId: body.manufacturingOrderId,
                  rawMaterialId: line.rawMaterialId,
                  materialLotId: line.materialLotId,
                  locationId: body.sourceLocationId,
                })
              : '0';

            const movement = await this.ledger.postMovement(tx, {
              organizationId,
              movementType,
              rawMaterialId: line.rawMaterialId,
              materialLotId: line.materialLotId,
              fabricRollId: line.fabricRollId ?? null,
              sourceLocationId: body.sourceLocationId,
              destinationLocationId: body.destinationLocationId,
              enteredQty: line.quantity,
              enteredUom: line.uom,
              referenceType: 'MaterialIssue',
              referenceId: issue.id,
              referenceNo: issue.issueNo,
              reason: `Material issued (${body.issueType})`,
              remarks: line.remarks ?? null,
              operatorUserId: actorUserId,
              reservationCoverQty: cover,
              idempotencyKey: `${body.idempotencyKey}:${i}`,
            });

            await tx.materialIssueLine.create({
              data: {
                materialIssueId: issue.id,
                lineNo: i + 1,
                rawMaterialId: line.rawMaterialId,
                materialLotId: line.materialLotId,
                fabricRollId: line.fabricRollId ?? null,
                issuedBaseQty: new Prisma.Decimal(movement.baseQty),
                uom: movement.baseUom,
                movementId: movement.id,
                remarks: line.remarks ?? null,
              },
            });

            if (dec(movement.reservationConsumedQty).greaterThan(0) && body.manufacturingOrderId) {
              await this.consumeReservations(tx, {
                organizationId,
                manufacturingOrderId: body.manufacturingOrderId,
                rawMaterialId: line.rawMaterialId,
                materialLotId: line.materialLotId,
                locationId: body.sourceLocationId,
                qty: movement.reservationConsumedQty,
              });
            }

            lines.push({ lineNo: i + 1, movementNo: movement.movementNo, baseQty: movement.baseQty });
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'MaterialIssue', entityId: issue.id,
              context: { issueNo: issue.issueNo, lineCount: lines.length, movementType },
            },
            tx,
          );

          return { id: issue.id, issueNo: issue.issueNo, lines };
        });
        return { result, entityId: result.id };
      },
    );
  }

  /** Return unconsumed material from a department back to the warehouse. */
  async returnMaterial(organizationId: string, actorUserId: string, body: MaterialReturnRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.return', key: body.idempotencyKey, payload: body, entityType: 'MaterialMovement' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const source = await tx.materialLocation.findFirstOrThrow({
            where: { id: body.sourceLocationId, organizationId },
            select: { kind: true },
          });
          const movementType: MovementType =
            source.kind === 'JOB_WORKER' ? 'RETURN_FROM_JOB_WORKER' : 'RETURN_FROM_PRODUCTION';

          const movements: { movementNo: string; baseQty: string }[] = [];

          for (let i = 0; i < body.lines.length; i += 1) {
            const line = body.lines[i]!;

            // A return cannot exceed what is still outstanding on the issue
            // line it cites. Without this, a department could "return" more
            // than it was ever given and manufacture stock out of nothing.
            if (line.materialIssueLineId) {
              await this.assertReturnable(tx, line.materialIssueLineId, line.quantity);
            }

            const movement = await this.ledger.postMovement(tx, {
              organizationId,
              movementType,
              rawMaterialId: line.rawMaterialId,
              materialLotId: line.materialLotId,
              fabricRollId: line.fabricRollId ?? null,
              sourceLocationId: body.sourceLocationId,
              destinationLocationId: body.destinationLocationId,
              enteredQty: line.quantity,
              enteredUom: line.uom,
              referenceType: 'MaterialReturn',
              referenceId: body.materialIssueId ?? null,
              referenceLineId: line.materialIssueLineId ?? null,
              reason: body.reason,
              remarks: body.remarks ?? null,
              operatorUserId: actorUserId,
              idempotencyKey: `${body.idempotencyKey}:${i}`,
            });

            if (line.materialIssueLineId) {
              await tx.materialIssueLine.update({
                where: { id: line.materialIssueLineId },
                data: { returnedBaseQty: { increment: new Prisma.Decimal(movement.baseQty) } },
              });
            }
            movements.push({ movementNo: movement.movementNo, baseQty: movement.baseQty });
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'MaterialReturn', entityId: body.materialIssueId ?? null,
              context: { movementType, lineCount: movements.length, reason: body.reason },
            },
            tx,
          );
          return { movements };
        });
        return { result, entityId: null };
      },
    );
  }

  /**
   * Post actual consumption.
   *
   * This is the ONLY operation that permanently removes raw material from
   * inventory. Quantity moves from the department location into the CONSUMED
   * sink (and wastage into SCRAP), bounded by what was actually issued to that
   * department, so consumption can never exceed authorised issued stock.
   */
  async consume(organizationId: string, actorUserId: string, body: MaterialConsumptionRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.consume', key: body.idempotencyKey, payload: body, entityType: 'MaterialConsumption' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const consumedSink = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.CONSUMED);
          const scrapSink = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.SCRAP);

          const posted: { rawMaterialId: string; consumedQty: string; wastageQty: string; movementNo: string }[] = [];

          for (let i = 0; i < body.lines.length; i += 1) {
            const line = body.lines[i]!;
            const consumed = qty(line.consumedQty);
            const wastage = qty(line.wastageQty ?? '0');

            if (consumed.plus(wastage).lessThanOrEqualTo(0)) {
              throw new BadRequestException({
                code: 'NON_POSITIVE_QTY',
                message: 'Each consumption line must consume or waste some quantity',
                details: { lineNo: i + 1 },
              });
            }

            const lot = await tx.materialLot.findFirstOrThrow({
              where: { id: line.materialLotId },
              select: { unitCost: true },
            });

            let consumptionMovementNo = '';
            let consumptionMovementId: string | null = null;

            if (consumed.greaterThan(0)) {
              const m = await this.ledger.postMovement(tx, {
                organizationId,
                movementType: 'CONSUMPTION',
                rawMaterialId: line.rawMaterialId,
                materialLotId: line.materialLotId,
                fabricRollId: line.fabricRollId ?? null,
                sourceLocationId: body.sourceLocationId,
                destinationLocationId: consumedSink,
                enteredQty: consumed.toFixed(),
                enteredUom: line.uom,
                unitCost: lot.unitCost.toFixed(),
                referenceType: 'ManufacturingOrder',
                referenceId: body.manufacturingOrderId,
                reason: 'Material consumed in production',
                remarks: body.remarks ?? null,
                operatorUserId: actorUserId,
                idempotencyKey: `${body.idempotencyKey}:${i}:c`,
              });
              consumptionMovementNo = m.movementNo;
              consumptionMovementId = m.id;
            }

            let wastageMovementId: string | null = null;
            if (wastage.greaterThan(0)) {
              const w = await this.ledger.postMovement(tx, {
                organizationId,
                movementType: 'WASTAGE',
                rawMaterialId: line.rawMaterialId,
                materialLotId: line.materialLotId,
                fabricRollId: line.fabricRollId ?? null,
                sourceLocationId: body.sourceLocationId,
                destinationLocationId: scrapSink,
                enteredQty: wastage.toFixed(),
                enteredUom: line.uom,
                unitCost: lot.unitCost.toFixed(),
                referenceType: 'ManufacturingOrder',
                referenceId: body.manufacturingOrderId,
                reason: 'Production wastage',
                operatorUserId: actorUserId,
                idempotencyKey: `${body.idempotencyKey}:${i}:w`,
              });
              wastageMovementId = w.id;
            }

            const totalBase = consumed.plus(wastage);
            await tx.materialConsumption.create({
              data: {
                organizationId,
                manufacturingOrderId: body.manufacturingOrderId,
                productionBatchId: body.productionBatchId ?? null,
                stageTaskId: body.stageTaskId ?? null,
                materialIssueLineId: line.materialIssueLineId ?? null,
                rawMaterialId: line.rawMaterialId,
                materialLotId: line.materialLotId,
                fabricRollId: line.fabricRollId ?? null,
                consumedBaseQty: new Prisma.Decimal(consumed.toFixed()),
                wastageBaseQty: new Prisma.Decimal(wastage.toFixed()),
                uom: line.uom,
                unitCost: lot.unitCost,
                totalCost: new Prisma.Decimal(
                  totalBase.times(dec(lot.unitCost.toFixed())).toDecimalPlaces(2).toFixed(),
                ),
                movementId: consumptionMovementId,
                wastageMovementId,
                postedByUserId: actorUserId,
                idempotencyKey: `${body.idempotencyKey}:${i}`,
                remarks: body.remarks ?? null,
              },
            });

            if (line.materialIssueLineId) {
              await tx.materialIssueLine.update({
                where: { id: line.materialIssueLineId },
                data: { consumedBaseQty: { increment: new Prisma.Decimal(totalBase.toFixed()) } },
              });
            }

            posted.push({
              rawMaterialId: line.rawMaterialId,
              consumedQty: consumed.toFixed(),
              wastageQty: wastage.toFixed(),
              movementNo: consumptionMovementNo,
            });
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'MaterialConsumption', entityId: body.manufacturingOrderId,
              context: { manufacturingOrderId: body.manufacturingOrderId, lineCount: posted.length },
            },
            tx,
          );
          return { lines: posted };
        });
        return { result, entityId: body.manufacturingOrderId };
      },
    );
  }

  /**
   * Authorised stock adjustment. Elevated permission, mandatory reason, and a
   * ledger row against the ADJUSTMENT counter-account - so a correction is as
   * visible and as reversible as any other movement.
   */
  async adjust(organizationId: string, actorUserId: string, body: StockAdjustmentRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.adjust', key: body.idempotencyKey, payload: body, entityType: 'MaterialMovement' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const delta = dec(body.adjustmentQty);
          const authority = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.ADJUSTMENT);
          const increasing = delta.greaterThan(0);

          const movement = await this.ledger.postMovement(tx, {
            organizationId,
            movementType: increasing ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            rawMaterialId: body.rawMaterialId,
            materialLotId: body.materialLotId,
            sourceLocationId: increasing ? authority : body.locationId,
            destinationLocationId: increasing ? body.locationId : authority,
            enteredQty: delta.abs().toFixed(),
            enteredUom: body.uom,
            referenceType: 'StockAdjustment',
            reason: body.reason,
            remarks: body.remarks ?? null,
            operatorUserId: actorUserId,
            idempotencyKey: body.idempotencyKey,
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'MaterialMovement', entityId: movement.id,
              context: {
                movementNo: movement.movementNo,
                movementType: increasing ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
                adjustmentQty: body.adjustmentQty,
                reason: body.reason,
                elevated: true,
              },
            },
            tx,
          );
          return movement;
        });
        return { result, entityId: result.id };
      },
    );
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async resolveOrCreateLot(
    tx: Prisma.TransactionClient,
    organizationId: string,
    body: MaterialInwardRequest,
  ): Promise<string> {
    if (body.materialLotId) return body.materialLotId;

    if (body.lotCode) {
      const existing = await tx.materialLot.findUnique({
        where: {
          organizationId_rawMaterialId_lotCode: {
            organizationId,
            rawMaterialId: body.rawMaterialId,
            lotCode: body.lotCode,
          },
        },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const lotCode = body.lotCode ?? (await this.numbering.next(tx, organizationId, DOC_SCOPES.MATERIAL_LOT));
    const created = await tx.materialLot.create({
      data: {
        organizationId,
        rawMaterialId: body.rawMaterialId,
        lotCode,
        supplierId: body.supplierId ?? null,
        shade: body.shade ?? null,
        width: body.width ? new Prisma.Decimal(body.width) : null,
        unitCost: body.unitCost ? new Prisma.Decimal(body.unitCost) : new Prisma.Decimal(0),
        receivedAt: new Date(),
      },
      select: { id: true },
    });
    return created.id;
  }

  /** How much of this order's reservation at this exact row is still open. */
  private async openReservationQty(
    tx: Prisma.TransactionClient,
    key: {
      organizationId: string; manufacturingOrderId: string;
      rawMaterialId: string; materialLotId: string; locationId: string;
    },
  ): Promise<string> {
    const rows = await tx.materialReservation.findMany({
      where: {
        organizationId: key.organizationId,
        manufacturingOrderId: key.manufacturingOrderId,
        rawMaterialId: key.rawMaterialId,
        materialLotId: key.materialLotId,
        locationId: key.locationId,
        status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] },
      },
      select: { reservedQty: true, issuedQty: true, releasedQty: true },
    });
    const open = rows.reduce<Decimal>(
      (acc, r) =>
        acc.plus(
          Decimal.max(
            dec(r.reservedQty.toFixed()).minus(dec(r.issuedQty.toFixed())).minus(dec(r.releasedQty.toFixed())),
            0,
          ),
        ),
      new Decimal(0),
    );
    return qty(open).toFixed();
  }

  /** Apply an issued quantity across this order's open reservations, oldest first. */
  private async consumeReservations(
    tx: Prisma.TransactionClient,
    key: {
      organizationId: string; manufacturingOrderId: string; rawMaterialId: string;
      materialLotId: string; locationId: string; qty: string;
    },
  ): Promise<void> {
    let remaining = qty(key.qty);
    const rows = await tx.materialReservation.findMany({
      where: {
        organizationId: key.organizationId,
        manufacturingOrderId: key.manufacturingOrderId,
        rawMaterialId: key.rawMaterialId,
        materialLotId: key.materialLotId,
        locationId: key.locationId,
        status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const r of rows) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const open = Decimal.max(
        dec(r.reservedQty.toFixed()).minus(dec(r.issuedQty.toFixed())).minus(dec(r.releasedQty.toFixed())),
        0,
      );
      if (open.lessThanOrEqualTo(0)) continue;
      const take = Decimal.min(open, remaining);
      const newIssued = dec(r.issuedQty.toFixed()).plus(take);
      const closed = newIssued.plus(dec(r.releasedQty.toFixed())).greaterThanOrEqualTo(dec(r.reservedQty.toFixed()));
      await tx.materialReservation.update({
        where: { id: r.id },
        data: {
          issuedQty: new Prisma.Decimal(qty(newIssued).toFixed()),
          status: closed ? 'CONSUMED' : 'PARTIALLY_CONSUMED',
        },
      });
      remaining = remaining.minus(take);
    }
  }

  private async assertReturnable(
    tx: Prisma.TransactionClient,
    issueLineId: string,
    returnQty: string,
  ): Promise<void> {
    const line = await tx.materialIssueLine.findUniqueOrThrow({
      where: { id: issueLineId },
      select: { issuedBaseQty: true, returnedBaseQty: true, consumedBaseQty: true, lineNo: true },
    });
    const outstanding = dec(line.issuedBaseQty.toFixed())
      .minus(dec(line.returnedBaseQty.toFixed()))
      .minus(dec(line.consumedBaseQty.toFixed()));
    if (qty(returnQty).greaterThan(outstanding)) {
      throw new BadRequestException({
        code: 'RETURN_EXCEEDS_ISSUED',
        message: 'Return quantity exceeds the quantity still outstanding on this issue line',
        details: {
          issueLineNo: line.lineNo,
          requestedQty: qty(returnQty).toFixed(),
          outstandingQty: qty(outstanding).toFixed(),
          issuedQty: line.issuedBaseQty.toFixed(),
          returnedQty: line.returnedBaseQty.toFixed(),
          consumedQty: line.consumedBaseQty.toFixed(),
        },
      });
    }
  }
}

function severityRank(level: string): number {
  switch (level) {
    case 'OUT_OF_STOCK': return 0;
    case 'BELOW_MINIMUM': return 1;
    case 'AT_REORDER_LEVEL': return 2;
    default: return 3;
  }
}

export type { UomCode };
