import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type MaterialLocation, type RawMaterial } from '@prisma/client';
import {
  ConfigurationError, Decimal, ERR, UomConverter, assertLedgerBalanced, dec, isOwned,
  planMovement, qty, rate, type LocationRef, type MovementType, type UomCode,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { SYSTEM_LOCATIONS } from '@dnd/domain';

export interface PostMovementInput {
  readonly organizationId: string;
  readonly movementType: MovementType;
  readonly rawMaterialId: string;
  readonly materialLotId: string;
  readonly fabricRollId?: string | null;
  readonly sourceLocationId: string;
  readonly destinationLocationId: string;
  /** Quantity as the operator entered it. */
  readonly enteredQty: Prisma.Decimal | string;
  readonly enteredUom: UomCode;
  readonly unitCost?: string | null;
  readonly referenceType?: string | null;
  readonly referenceId?: string | null;
  readonly referenceLineId?: string | null;
  readonly referenceNo?: string | null;
  readonly reason?: string | null;
  readonly remarks?: string | null;
  readonly operatorUserId?: string | null;
  /** Unique per organisation; a replay of the same key is rejected by the index. */
  readonly idempotencyKey: string;
  /** Quantity covered by the requesting order's own reservation. */
  readonly reservationCoverQty?: string | null;
  readonly occurredAt?: Date;
}

export interface PostedMovement {
  readonly id: string;
  readonly movementNo: string;
  readonly baseQty: string;
  readonly baseUom: UomCode;
  readonly reservationConsumedQty: string;
}

/**
 * The ONLY write path for raw material stock.
 *
 * Nothing else in this application is permitted to touch `material_balances`.
 * Every change goes through `postMovement`, which means:
 *
 *   - no balance can change without an immutable ledger row explaining it;
 *   - the double-entry shape is guaranteed, so balances always sum to zero;
 *   - the affected rows are locked before they are read, so two concurrent
 *     issues of the same fabric cannot both see the same 100 metres.
 *
 * The arithmetic and the legality of each transition live in @dnd/domain; this
 * class is the transactional shell around them.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Post one movement. MUST be called inside a transaction supplied by the
   * caller, so a document and the stock it moves commit together.
   */
  async postMovement(
    tx: Prisma.TransactionClient,
    input: PostMovementInput,
  ): Promise<PostedMovement> {
    const material = await tx.rawMaterial.findFirst({
      where: { id: input.rawMaterialId, organizationId: input.organizationId },
    });
    if (!material) {
      throw new NotFoundException({
        code: 'MATERIAL_NOT_FOUND',
        message: 'Raw material not found',
        details: { rawMaterialId: input.rawMaterialId },
      });
    }

    const [source, destination] = await Promise.all([
      this.loadLocation(tx, input.organizationId, input.sourceLocationId),
      this.loadLocation(tx, input.organizationId, input.destinationLocationId),
    ]);

    const baseQty = await this.toBaseQty(tx, material, input.enteredQty, input.enteredUom);

    // Lock the balance rows BEFORE reading them, in a deterministic order so
    // concurrent movements queue rather than deadlock.
    const locationIds = [input.sourceLocationId, input.destinationLocationId].sort();
    await this.lockBalances(tx, input.rawMaterialId, input.materialLotId, locationIds);

    const sourceBalance = await tx.materialBalance.findUnique({
      where: {
        rawMaterialId_materialLotId_locationId: {
          rawMaterialId: input.rawMaterialId,
          materialLotId: input.materialLotId,
          locationId: input.sourceLocationId,
        },
      },
      select: { onHandQty: true, reservedQty: true },
    });

    // Validate and compute the deltas. Throws a domain error with the actual
    // numbers if the movement is not legal.
    const plan = planMovement({
      movementType: input.movementType,
      baseQty,
      source: toLocationRef(source),
      destination: toLocationRef(destination),
      sourceBalance: sourceBalance
        ? { onHandQty: sourceBalance.onHandQty.toFixed(), reservedQty: sourceBalance.reservedQty.toFixed() }
        : null,
      reservationCoverQty: input.reservationCoverQty ?? '0',
      hasReference: Boolean(input.referenceType ?? input.referenceId ?? input.referenceNo),
    });

    for (const delta of plan.deltas) {
      await this.applyBalanceDelta(tx, {
        organizationId: input.organizationId,
        rawMaterialId: input.rawMaterialId,
        materialLotId: input.materialLotId,
        locationId: delta.locationId,
        onHandDelta: delta.onHandDelta,
        reservedDelta: delta.reservedDelta,
      });
    }

    const movementNo = await this.numbering.next(tx, input.organizationId, DOC_SCOPES.MATERIAL_MOVEMENT);
    const unitCost = input.unitCost != null ? rate(input.unitCost) : null;

    const movement = await tx.materialMovement.create({
      data: {
        organizationId: input.organizationId,
        movementNo,
        movementType: input.movementType,
        rawMaterialId: input.rawMaterialId,
        materialLotId: input.materialLotId,
        fabricRollId: input.fabricRollId ?? null,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        enteredQty: new Prisma.Decimal(qty(input.enteredQty as string).toFixed()),
        enteredUom: input.enteredUom,
        baseQty: new Prisma.Decimal(plan.baseQty.toFixed()),
        baseUom: material.baseUom,
        unitCost: unitCost ? new Prisma.Decimal(unitCost.toFixed()) : null,
        totalCost: unitCost ? new Prisma.Decimal(unitCost.times(plan.baseQty).toDecimalPlaces(2).toFixed()) : null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        referenceLineId: input.referenceLineId ?? null,
        referenceNo: input.referenceNo ?? null,
        reason: input.reason ?? null,
        remarks: input.remarks ?? null,
        operatorUserId: input.operatorUserId ?? null,
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.occurredAt ?? new Date(),
      },
      select: { id: true, movementNo: true },
    });

    return {
      id: movement.id,
      movementNo: movement.movementNo,
      baseQty: plan.baseQty.toFixed(),
      baseUom: material.baseUom as UomCode,
      reservationConsumedQty: plan.reservationConsumedQty.toFixed(),
    };
  }

  /**
   * Reserve stock for a manufacturing order.
   *
   * A reservation does not move anything; it raises `reservedQty` on the exact
   * balance row so other orders stop seeing that quantity as available. The
   * `mb_reserved_within_on_hand` database constraint is the backstop that stops
   * more being promised than exists.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      rawMaterialId: string;
      materialLotId: string;
      locationId: string;
      manufacturingOrderId: string;
      materialRequirementId?: string | null;
      qty: string;
      reservedByUserId?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<{ reservationId: string; reservedQty: string }> {
    const want = qty(input.qty);
    if (want.lessThanOrEqualTo(0)) {
      throw new ConfigurationError(ERR.NON_POSITIVE_QTY, 'Reservation quantity must be greater than zero', {
        qty: want.toFixed(),
      });
    }

    await this.lockBalances(tx, input.rawMaterialId, input.materialLotId, [input.locationId]);

    const balance = await tx.materialBalance.findUnique({
      where: {
        rawMaterialId_materialLotId_locationId: {
          rawMaterialId: input.rawMaterialId,
          materialLotId: input.materialLotId,
          locationId: input.locationId,
        },
      },
      select: { id: true, onHandQty: true, reservedQty: true },
    });

    const onHand = balance ? qty(balance.onHandQty.toFixed()) : new Decimal(0);
    const reserved = balance ? qty(balance.reservedQty.toFixed()) : new Decimal(0);
    const available = onHand.minus(reserved);

    if (want.greaterThan(available)) {
      throw new ConfigurationError(
        ERR.INSUFFICIENT_UNRESERVED_STOCK,
        'Cannot reserve more than the unreserved stock at this location',
        {
          rawMaterialId: input.rawMaterialId,
          locationId: input.locationId,
          requestedQty: want.toFixed(),
          onHandQty: onHand.toFixed(),
          reservedQty: reserved.toFixed(),
          availableQty: available.toFixed(),
        },
      );
    }

    await tx.materialBalance.update({
      where: { id: balance!.id },
      data: { reservedQty: { increment: new Prisma.Decimal(want.toFixed()) }, version: { increment: 1 } },
    });

    const reservation = await tx.materialReservation.create({
      data: {
        organizationId: input.organizationId,
        rawMaterialId: input.rawMaterialId,
        materialLotId: input.materialLotId,
        locationId: input.locationId,
        manufacturingOrderId: input.manufacturingOrderId,
        materialRequirementId: input.materialRequirementId ?? null,
        reservedQty: new Prisma.Decimal(want.toFixed()),
        reservedByUserId: input.reservedByUserId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });

    return { reservationId: reservation.id, reservedQty: want.toFixed() };
  }

  /** Release an unconsumed reservation, e.g. when an order is cancelled. */
  async releaseReservation(
    tx: Prisma.TransactionClient,
    reservationId: string,
    releaseQty?: string,
  ): Promise<{ releasedQty: string }> {
    const r = await tx.materialReservation.findUnique({ where: { id: reservationId } });
    if (!r) throw new NotFoundException({ code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' });

    const open = qty(r.reservedQty.toFixed())
      .minus(qty(r.issuedQty.toFixed()))
      .minus(qty(r.releasedQty.toFixed()));
    const want = releaseQty != null ? Decimal.min(qty(releaseQty), open) : open;
    if (want.lessThanOrEqualTo(0)) return { releasedQty: '0' };

    await this.lockBalances(tx, r.rawMaterialId, r.materialLotId, [r.locationId]);
    await tx.materialBalance.update({
      where: {
        rawMaterialId_materialLotId_locationId: {
          rawMaterialId: r.rawMaterialId,
          materialLotId: r.materialLotId,
          locationId: r.locationId,
        },
      },
      data: { reservedQty: { decrement: new Prisma.Decimal(want.toFixed()) }, version: { increment: 1 } },
    });

    const releasedTotal = qty(r.releasedQty.toFixed()).plus(want);
    const fullyClosed = releasedTotal.plus(qty(r.issuedQty.toFixed())).greaterThanOrEqualTo(qty(r.reservedQty.toFixed()));
    await tx.materialReservation.update({
      where: { id: reservationId },
      data: {
        releasedQty: new Prisma.Decimal(releasedTotal.toFixed()),
        status: fullyClosed ? 'RELEASED' : r.status,
      },
    });

    return { releasedQty: want.toFixed() };
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /**
   * Take row-level locks on the balance rows a movement will touch.
   *
   * `FOR UPDATE` is not expressible through the Prisma query API, so this is
   * raw SQL by necessity. Rows that do not exist yet cannot be locked, so the
   * subsequent upsert relies on the unique index to serialise creation.
   */
  private async lockBalances(
    tx: Prisma.TransactionClient,
    rawMaterialId: string,
    materialLotId: string,
    locationIds: readonly string[],
  ): Promise<void> {
    if (locationIds.length === 0) return;
    await tx.$queryRaw`
      SELECT id FROM "material_balances"
      WHERE "rawMaterialId" = ${rawMaterialId}::uuid
        AND "materialLotId" = ${materialLotId}::uuid
        AND "locationId" = ANY(${[...locationIds]}::uuid[])
      ORDER BY "locationId"
      FOR UPDATE`;
  }

  private async applyBalanceDelta(
    tx: Prisma.TransactionClient,
    d: {
      organizationId: string;
      rawMaterialId: string;
      materialLotId: string;
      locationId: string;
      onHandDelta: Decimal;
      reservedDelta: Decimal;
    },
  ): Promise<void> {
    await tx.materialBalance.upsert({
      where: {
        rawMaterialId_materialLotId_locationId: {
          rawMaterialId: d.rawMaterialId,
          materialLotId: d.materialLotId,
          locationId: d.locationId,
        },
      },
      create: {
        organizationId: d.organizationId,
        rawMaterialId: d.rawMaterialId,
        materialLotId: d.materialLotId,
        locationId: d.locationId,
        onHandQty: new Prisma.Decimal(d.onHandDelta.toFixed()),
        reservedQty: new Prisma.Decimal(d.reservedDelta.toFixed()),
        version: 1,
      },
      update: {
        onHandQty: { increment: new Prisma.Decimal(d.onHandDelta.toFixed()) },
        reservedQty: { increment: new Prisma.Decimal(d.reservedDelta.toFixed()) },
        version: { increment: 1 },
      },
    });
  }

  private async loadLocation(
    tx: Prisma.TransactionClient,
    organizationId: string,
    locationId: string,
  ): Promise<MaterialLocation> {
    const loc = await tx.materialLocation.findFirst({ where: { id: locationId, organizationId } });
    if (!loc) {
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'Stock location not found',
        details: { locationId },
      });
    }
    return loc;
  }

  /**
   * Convert an entered quantity into the material's base unit using ONLY the
   * conversions configured for this organisation. An unconfigured conversion
   * raises NO_UOM_CONVERSION rather than guessing a roll length.
   */
  private async toBaseQty(
    tx: Prisma.TransactionClient,
    material: RawMaterial,
    enteredQty: Prisma.Decimal | string,
    enteredUom: UomCode,
  ): Promise<string> {
    if (enteredUom === material.baseUom) return qty(enteredQty.toString()).toFixed();

    const rules = await tx.uomConversion.findMany({
      where: {
        organizationId: material.organizationId,
        OR: [{ rawMaterialId: null }, { rawMaterialId: material.id }],
      },
      select: { rawMaterialId: true, fromUom: true, toUom: true, factor: true },
    });

    const converter = new UomConverter(
      rules.map((r) => ({
        rawMaterialId: r.rawMaterialId,
        fromUom: r.fromUom as UomCode,
        toUom: r.toUom as UomCode,
        factor: r.factor.toFixed(),
      })),
    );

    return converter
      .convert(enteredQty.toString(), enteredUom, material.baseUom as UomCode, material.id)
      .toFixed();
  }

  /** Resolve a system location by its well-known code. */
  async systemLocationId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    code: (typeof SYSTEM_LOCATIONS)[keyof typeof SYSTEM_LOCATIONS],
  ): Promise<string> {
    const loc = await tx.materialLocation.findUnique({
      where: { organizationId_code: { organizationId, code } },
      select: { id: true },
    });
    if (!loc) {
      throw new ConfigurationError(
        'SYSTEM_LOCATION_MISSING',
        `System location ${code} does not exist. Run the seed to create system locations.`,
        { code },
      );
    }
    return loc.id;
  }

  /**
   * Recompute a material's weighted-average cost.
   *
   * Derived from the lot costs of the stock currently held, rather than
   * accumulated incrementally:
   *
   *   averageCost = SUM(onHandQty x lot.unitCost) / SUM(onHandQty)
   *
   * An incremental running average has to know what the "previous" quantity
   * and average were, and both get wrong the moment stock sits in QC hold
   * between being received and being costed - the held quantity dilutes the
   * average at a cost of zero. Deriving the figure from the lots means it is
   * always exactly the cost of what is on the shelf, and a single bad inward
   * cannot leave permanent drift behind it.
   *
   * Owned locations only: consumed and scrapped quantity is gone, and the
   * supplier counter-account is not stock.
   */
  async recomputeAverageCost(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rawMaterialId: string,
  ): Promise<string> {
    const balances = await tx.materialBalance.findMany({
      where: { rawMaterialId },
      select: {
        onHandQty: true,
        location: { select: { kind: true } },
        materialLot: { select: { unitCost: true } },
      },
    });

    const owned = balances.filter((b) => isOwned(b.location.kind as never));

    let totalQty = new Decimal(0);
    let totalValue = new Decimal(0);
    for (const b of owned) {
      const q = dec(b.onHandQty.toFixed());
      if (q.lessThanOrEqualTo(0)) continue;
      totalQty = totalQty.plus(q);
      totalValue = totalValue.plus(q.times(dec(b.materialLot.unitCost.toFixed())));
    }

    // With no stock left, the last known cost is more useful than zero: it is
    // what MRP will value the next requirement at.
    if (totalQty.lessThanOrEqualTo(0)) {
      const current = await tx.rawMaterial.findFirstOrThrow({
        where: { id: rawMaterialId, organizationId },
        select: { averageCost: true },
      });
      return current.averageCost.toFixed();
    }

    const newAvg = rate(totalValue.dividedBy(totalQty));
    await tx.rawMaterial.update({
      where: { id: rawMaterialId },
      data: { averageCost: new Prisma.Decimal(newAvg.toFixed()) },
    });
    return newAvg.toFixed();
  }

  /**
   * Ledger integrity check for one material: every balance across every
   * location, including the virtual counter-accounts, must sum to exactly zero.
   * Exposed for the reconciliation job and the diagnostics endpoint.
   */
  async assertMaterialBalanced(rawMaterialId: string): Promise<void> {
    const balances = await this.prisma.materialBalance.findMany({
      where: { rawMaterialId },
      select: { locationId: true, onHandQty: true },
    });
    assertLedgerBalanced(
      balances.map((b) => ({ locationId: b.locationId, onHandQty: b.onHandQty.toFixed() })),
      { rawMaterialId },
    );
  }
}

function toLocationRef(loc: MaterialLocation): LocationRef {
  return { id: loc.id, code: loc.code, kind: loc.kind as never, blocksIssue: loc.blocksIssue };
}
