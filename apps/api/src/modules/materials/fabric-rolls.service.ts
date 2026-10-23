import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal, SYSTEM_LOCATIONS, buildRollCode, deriveRollStatus, planRollIssue,
  planRollReturn, qty, selectRollsForLength, type RollState, type UomCode,
} from '@dnd/domain';
import type { CreateFabricRollRequest, RollIssueRequest, RollReturnRequest } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';
import { LedgerService } from '../inventory/ledger.service';

/**
 * Fabric roll management.
 *
 * A roll is a physically identifiable piece of one fabric lot with its own
 * barcode and its own length. Roll lengths and the material ledger are two
 * projections of the SAME movements - every roll movement stamps `fabricRollId`
 * on the ledger row - so they can be reconciled against each other rather than
 * drifting apart. `reconcileRollLengths` below is that check.
 */
@Injectable()
export class FabricRollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      rawMaterialId?: string; materialLotId?: string; locationId?: string; shade?: string;
      status?: string; minimumWidth?: string;
    },
  ) {
    const where: Prisma.FabricRollWhereInput = {
      organizationId,
      ...(query.rawMaterialId ? { rawMaterialId: query.rawMaterialId } : {}),
      ...(query.materialLotId ? { materialLotId: query.materialLotId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.shade ? { shade: query.shade } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.minimumWidth ? { width: { gte: new Prisma.Decimal(query.minimumWidth) } } : {}),
      ...(searchFilter(query.search, ['rollNo', 'shade', 'color']) ?? {}),
    };
    const args = pageArgs(query, ['rollNo', 'currentLength', 'receivedAt', 'createdAt', 'shade'], 'rollNo');

    const [rows, total] = await Promise.all([
      this.prisma.fabricRoll.findMany({
        where, ...args,
        include: {
          rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } },
          materialLot: { select: { id: true, lotCode: true, shade: true } },
          location: { select: { id: true, code: true, name: true, kind: true } },
          barcode: { select: { code: true } },
        },
      }),
      this.prisma.fabricRoll.count({ where }),
    ]);

    return paginated(
      rows.map((r) => ({
        ...r,
        availableLength: r.currentLength.minus(r.reservedLength),
      })),
      total,
      query,
    );
  }

  async get(organizationId: string, id: string) {
    const roll = await this.prisma.fabricRoll.findFirst({
      where: { id, organizationId },
      include: {
        rawMaterial: true,
        materialLot: true,
        location: true,
        supplier: { select: { id: true, name: true } },
        barcode: true,
        movements: {
          orderBy: { occurredAt: 'desc' },
          take: 100,
          include: {
            sourceLocation: { select: { code: true, name: true } },
            destinationLocation: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!roll) throw new NotFoundException({ code: 'ROLL_NOT_FOUND', message: 'Fabric roll not found' });
    return { ...roll, availableLength: roll.currentLength.minus(roll.reservedLength) };
  }

  /**
   * Create rolls for a received fabric lot.
   *
   * Called by the goods receipt flow (one entry per physical roll on the
   * delivery) and available standalone for correcting a mis-recorded delivery.
   * The roll's quantity is NOT separately added to stock here: the receipt's
   * ledger movement already did that, and adding it again is exactly the
   * double-count the specification warns against. Rolls are an identity layer
   * over quantity that already exists.
   */
  async createForReceipt(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: {
      rawMaterialId: string;
      materialLotId: string;
      locationId: string;
      supplierId?: string | null;
      receiptLineId?: string | null;
      shade?: string | null;
      color?: string | null;
      width?: string | null;
      widthUom?: string | null;
      gsm?: number | null;
      purchaseRate?: string | null;
      lengthUom?: UomCode;
      rolls: readonly { length: string; rollNo?: string | null }[];
    },
  ): Promise<{ id: string; rollNo: string; barcode: string }[]> {
    if (input.rolls.length === 0) return [];

    const numbers = await this.numbering.nextBatch(
      tx, organizationId, DOC_SCOPES.FABRIC_ROLL, input.rolls.length,
    );

    const created: { id: string; rollNo: string; barcode: string }[] = [];
    for (let i = 0; i < input.rolls.length; i += 1) {
      const spec = input.rolls[i]!;
      const rollNo = spec.rollNo?.trim() || numbers[i]!;
      const length = new Prisma.Decimal(qty(spec.length).toFixed());

      const roll = await tx.fabricRoll.create({
        data: {
          organizationId,
          rollNo,
          rawMaterialId: input.rawMaterialId,
          materialLotId: input.materialLotId,
          locationId: input.locationId,
          supplierId: input.supplierId ?? null,
          receiptLineId: input.receiptLineId ?? null,
          shade: input.shade ?? null,
          color: input.color ?? null,
          width: input.width ? new Prisma.Decimal(input.width) : null,
          widthUom: input.widthUom ?? null,
          gsm: input.gsm ?? null,
          originalLength: length,
          currentLength: length,
          reservedLength: new Prisma.Decimal(0),
          lengthUom: input.lengthUom ?? 'METER',
          purchaseRate: input.purchaseRate ? new Prisma.Decimal(input.purchaseRate) : null,
          // Received rolls wait for inspection before they become issuable.
          status: 'QC_PENDING',
          receivedAt: new Date(),
        },
        select: { id: true, rollNo: true },
      });

      const code = buildRollCode(roll.rollNo);
      await tx.barcodeIdentifier.create({
        data: {
          organizationId,
          code,
          kind: 'FABRIC_ROLL',
          fabricRollId: roll.id,
          labelData: {
            rollNo: roll.rollNo,
            shade: input.shade ?? null,
            width: input.width ?? null,
            length: spec.length,
            uom: input.lengthUom ?? 'METER',
          },
        },
      });

      created.push({ id: roll.id, rollNo: roll.rollNo, barcode: code });
    }
    return created;
  }

  async createStandalone(organizationId: string, actorUserId: string, body: CreateFabricRollRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const rolls = await this.createForReceipt(tx, organizationId, {
        rawMaterialId: body.rawMaterialId,
        materialLotId: body.materialLotId,
        locationId: body.locationId,
        supplierId: body.supplierId ?? null,
        receiptLineId: body.receiptLineId ?? null,
        shade: body.shade ?? null,
        color: body.color ?? null,
        width: body.width ?? null,
        widthUom: body.widthUom ?? null,
        gsm: body.gsm ?? null,
        purchaseRate: body.purchaseRate ?? null,
        lengthUom: body.lengthUom,
        rolls: [{ length: body.originalLength }],
      });
      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE',
          entityType: 'FabricRoll', entityId: rolls[0]!.id,
          context: { rollNo: rolls[0]!.rollNo, originalLength: body.originalLength },
        },
        tx,
      );
      return rolls[0]!;
    });
  }

  /** Release a roll from QC hold so cutting may draw on it. */
  async setQcResult(
    organizationId: string,
    actorUserId: string,
    id: string,
    result: 'PASS' | 'FAIL',
    notes?: string | null,
  ) {
    const roll = await this.prisma.fabricRoll.findFirst({ where: { id, organizationId } });
    if (!roll) throw new NotFoundException({ code: 'ROLL_NOT_FOUND', message: 'Fabric roll not found' });

    const next = result === 'PASS'
      ? deriveRollStatus({ ...toRollState(roll), status: 'AVAILABLE' })
      : 'BLOCKED';

    const updated = await this.prisma.fabricRoll.update({
      where: { id },
      data: { qcStatus: result, status: next, defectNotes: notes ?? null, version: { increment: 1 } },
    });

    await this.audit.record({
      organizationId, actorUserId, action: result === 'PASS' ? 'APPROVE' : 'REJECT',
      entityType: 'FabricRoll', entityId: id,
      context: { rollNo: roll.rollNo, result, notes: notes ?? null },
    });
    return updated;
  }

  /**
   * Issue a length off a roll to a production location.
   *
   * One transaction writes all three effects: the roll length, the ledger
   * movement, and the roll status derived from the new length. Doing any of
   * them outside the transaction is how a roll ends up claiming 75 m while the
   * ledger says 100 m.
   */
  async issue(organizationId: string, actorUserId: string, body: RollIssueRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'roll.issue', key: body.idempotencyKey, payload: body, entityType: 'FabricRoll' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const locked = await this.lockRoll(tx, organizationId, body.fabricRollId);
          const plan = planRollIssue(toRollState(locked), body.quantity);

          const movement = await this.ledger.postMovement(tx, {
            organizationId,
            movementType: 'ISSUE_TO_PRODUCTION',
            rawMaterialId: locked.rawMaterialId,
            materialLotId: locked.materialLotId,
            fabricRollId: locked.id,
            sourceLocationId: locked.locationId,
            destinationLocationId: body.destinationLocationId,
            enteredQty: plan.issuedLength.toFixed(),
            enteredUom: locked.lengthUom as UomCode,
            referenceType: body.cuttingOrderId ? 'CuttingOrder' : 'FabricRollIssue',
            referenceId: body.cuttingOrderId ?? body.manufacturingOrderId ?? locked.id,
            referenceNo: locked.rollNo,
            reason: 'Fabric roll issued to production',
            remarks: body.remarks ?? null,
            operatorUserId: actorUserId,
            idempotencyKey: `${body.idempotencyKey}:mov`,
          });

          const updated = await tx.fabricRoll.update({
            where: { id: locked.id },
            data: {
              currentLength: new Prisma.Decimal(plan.newCurrentLength.toFixed()),
              reservedLength: new Prisma.Decimal(plan.newReservedLength.toFixed()),
              status: plan.newStatus,
              version: { increment: 1 },
            },
            select: { id: true, rollNo: true, currentLength: true, status: true },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'FabricRoll', entityId: locked.id,
              context: {
                rollNo: locked.rollNo,
                issuedLength: plan.issuedLength.toFixed(),
                remainingLength: plan.newCurrentLength.toFixed(),
                movementNo: movement.movementNo,
              },
            },
            tx,
          );

          return {
            rollId: updated.id,
            rollNo: updated.rollNo,
            issuedLength: plan.issuedLength.toFixed(),
            remainingLength: updated.currentLength.toFixed(),
            status: updated.status,
            movementNo: movement.movementNo,
          };
        });
        return { result, entityId: result.rollId };
      },
    );
  }

  /**
   * Return unused fabric to a roll.
   *
   * Capped at the roll's original length by the domain rule, which is what
   * stops a partial return from inventing fabric that was never received.
   */
  async returnToRoll(organizationId: string, actorUserId: string, body: RollReturnRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'roll.return', key: body.idempotencyKey, payload: body, entityType: 'FabricRoll' },
      async () => {
        const result = await this.prisma.inTransaction(async (tx) => {
          const locked = await this.lockRoll(tx, organizationId, body.fabricRollId);
          const plan = planRollReturn(toRollState(locked), body.quantity);

          const movement = await this.ledger.postMovement(tx, {
            organizationId,
            movementType: 'RETURN_FROM_PRODUCTION',
            rawMaterialId: locked.rawMaterialId,
            materialLotId: locked.materialLotId,
            fabricRollId: locked.id,
            sourceLocationId: body.sourceLocationId,
            destinationLocationId: body.destinationLocationId,
            enteredQty: qty(body.quantity).toFixed(),
            enteredUom: locked.lengthUom as UomCode,
            referenceType: 'FabricRollReturn',
            referenceId: locked.id,
            referenceNo: locked.rollNo,
            reason: body.reason,
            remarks: body.remarks ?? null,
            operatorUserId: actorUserId,
            idempotencyKey: `${body.idempotencyKey}:mov`,
          });

          const updated = await tx.fabricRoll.update({
            where: { id: locked.id },
            data: {
              currentLength: new Prisma.Decimal(plan.newCurrentLength.toFixed()),
              locationId: body.destinationLocationId,
              status: plan.newStatus,
              version: { increment: 1 },
            },
            select: { id: true, rollNo: true, currentLength: true, status: true },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'FabricRoll', entityId: locked.id,
              context: {
                rollNo: locked.rollNo,
                returnedLength: qty(body.quantity).toFixed(),
                newLength: plan.newCurrentLength.toFixed(),
                movementNo: movement.movementNo,
                reason: body.reason,
              },
            },
            tx,
          );

          return {
            rollId: updated.id,
            rollNo: updated.rollNo,
            returnedLength: qty(body.quantity).toFixed(),
            currentLength: updated.currentLength.toFixed(),
            status: updated.status,
            movementNo: movement.movementNo,
          };
        });
        return { result, entityId: result.rollId };
      },
    );
  }

  /**
   * Suggest which rolls to open for a required length.
   *
   * Prefers finishing partially-used rolls, which is how a cutting room
   * actually works: it minimises the number of short remnants left in the rack.
   */
  async suggestForLength(
    organizationId: string,
    input: { rawMaterialId: string; requiredLength: string; shade?: string; minimumWidth?: string },
  ) {
    const rolls = await this.prisma.fabricRoll.findMany({
      where: {
        organizationId,
        rawMaterialId: input.rawMaterialId,
        status: { in: ['AVAILABLE', 'PARTIALLY_ISSUED'] },
      },
      include: { location: { select: { code: true, name: true } }, materialLot: { select: { lotCode: true } } },
    });

    const selection = selectRollsForLength(
      input.requiredLength,
      rolls.map(toRollState),
      { requiredShade: input.shade ?? null, minimumWidth: input.minimumWidth ?? null },
    );

    const byId = new Map(rolls.map((r) => [r.id, r]));
    return {
      requiredLength: qty(input.requiredLength).toFixed(),
      selectedLength: selection.selectedLength.toFixed(),
      shortfallLength: selection.shortfallLength.toFixed(),
      shadesUsed: selection.shadesUsed,
      requiresShadeApproval: selection.shadesUsed.length > 1,
      rolls: selection.rolls.map((s) => {
        const r = byId.get(s.rollId)!;
        return {
          rollId: s.rollId,
          rollNo: r.rollNo,
          lotCode: r.materialLot.lotCode,
          shade: r.shade,
          width: r.width,
          locationCode: r.location.code,
          currentLength: r.currentLength,
          takeLength: s.length.toFixed(),
        };
      }),
    };
  }

  /**
   * Reconciliation check: for each (material, lot, location) the sum of roll
   * lengths must equal the ledger balance. A mismatch means a roll length was
   * changed without a matching movement, which is the specific failure mode
   * this design is built to make detectable.
   *
   * Scoped to locations where fabric is still held AS ROLLS - the warehouse,
   * QC hold and the rejected area. Once a length has been issued to a cutting
   * floor it is cut panels, not roll stock, so comparing it to a roll length
   * would report a variance that is not one.
   */
  async reconcileRollLengths(organizationId: string, rawMaterialId?: string) {
    const rolls = await this.prisma.fabricRoll.groupBy({
      by: ['rawMaterialId', 'materialLotId', 'locationId'],
      where: {
        organizationId,
        ...(rawMaterialId ? { rawMaterialId } : {}),
        location: { kind: { in: ['PHYSICAL', 'QUALITY_HOLD', 'BLOCKED'] } },
      },
      _sum: { currentLength: true },
    });

    const balances = await this.prisma.materialBalance.findMany({
      where: {
        organizationId,
        ...(rawMaterialId ? { rawMaterialId } : {}),
        rawMaterial: { category: 'FABRIC' },
        location: { kind: { in: ['PHYSICAL', 'QUALITY_HOLD', 'BLOCKED'] } },
      },
      select: { rawMaterialId: true, materialLotId: true, locationId: true, onHandQty: true },
    });

    const key = (r: { rawMaterialId: string; materialLotId: string; locationId: string }) =>
      `${r.rawMaterialId}|${r.materialLotId}|${r.locationId}`;
    const rollTotals = new Map(rolls.map((r) => [key(r), qty(r._sum.currentLength?.toFixed() ?? '0')]));

    const variances: {
      rawMaterialId: string; materialLotId: string; locationId: string;
      rollLength: string; ledgerQty: string; varianceQty: string;
    }[] = [];

    for (const b of balances) {
      const rollLength = rollTotals.get(key(b)) ?? new Decimal(0);
      const ledgerQty = qty(b.onHandQty.toFixed());
      const variance = qty(rollLength.minus(ledgerQty));
      if (!variance.isZero()) {
        variances.push({
          rawMaterialId: b.rawMaterialId,
          materialLotId: b.materialLotId,
          locationId: b.locationId,
          rollLength: rollLength.toFixed(),
          ledgerQty: ledgerQty.toFixed(),
          varianceQty: variance.toFixed(),
        });
      }
    }

    return { checkedKeys: balances.length, isReconciled: variances.length === 0, variances };
  }

  /** Lock the roll row so two concurrent issues cannot both see the same length. */
  private async lockRoll(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "fabric_rolls" WHERE id = ${id}::uuid FOR UPDATE`;
    const roll = await tx.fabricRoll.findFirst({ where: { id, organizationId } });
    if (!roll) throw new NotFoundException({ code: 'ROLL_NOT_FOUND', message: 'Fabric roll not found' });
    return roll;
  }
}

function toRollState(roll: {
  id: string; rollNo: string; originalLength: Prisma.Decimal; currentLength: Prisma.Decimal;
  reservedLength: Prisma.Decimal; status: string; shade: string | null; width: Prisma.Decimal | null;
}): RollState {
  return {
    id: roll.id,
    rollNo: roll.rollNo,
    originalLength: roll.originalLength.toFixed(),
    currentLength: roll.currentLength.toFixed(),
    reservedLength: roll.reservedLength.toFixed(),
    status: roll.status as never,
    shade: roll.shade,
    width: roll.width ? roll.width.toFixed() : null,
  };
}

export { SYSTEM_LOCATIONS };
