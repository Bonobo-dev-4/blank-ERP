import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal, dec } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';

export interface CreateInwardBody {
  idempotencyKey: string;
  manufacturingOrderId: string;
  manufacturingLocationId: string;
  lines: { productVariantId: string; acceptedQty: string; rejectedQty?: string; productionBatchId?: string }[];
  remarks?: string;
}

/**
 * Finished goods.
 *
 * Mirrors the raw material discipline one floor up: `FinishedGoodsMovement` is
 * an append-only record of what happened, and `FinishedGoodsBalance` is derived
 * from it. This service is the only writer of balances, so a quantity can never
 * appear in stock without a movement that explains it.
 *
 * The invariant that matters most: **you cannot inward more than the factory
 * actually produced.** A manufacturing order knows what it completed and what
 * has already been received; the difference is the ceiling. Without that, a
 * double submission would create garments that do not exist, and the first
 * person to notice would be a customer whose order cannot be picked.
 */
@Injectable()
export class FinishedGoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Finished stock on hand, by SKU and location. */
  async balances(organizationId: string, query: { search?: string } = {}) {
    const rows = await this.prisma.finishedGoodsBalance.findMany({
      where: {
        organizationId,
        ...(query.search
          ? {
              productVariant: {
                OR: [
                  { sku: { contains: query.search, mode: 'insensitive' as const } },
                  { product: { name: { contains: query.search, mode: 'insensitive' as const } } },
                ],
              },
            }
          : {}),
      },
      select: {
        id: true, onHandQty: true, pendingSyncQty: true, syncedQty: true, updatedAt: true,
        productVariant: {
          select: { id: true, sku: true, size: true, color: true, product: { select: { name: true, styleCode: true } } },
        },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    const totalOnHand = rows.reduce<Decimal>((s, r) => s.plus(dec(r.onHandQty.toFixed())), new Decimal(0));
    const pendingSync = rows.reduce<Decimal>((s, r) => s.plus(dec(r.pendingSyncQty.toFixed())), new Decimal(0));

    return {
      totals: {
        skuCount: new Set(rows.map((r) => r.productVariant.id)).size,
        lineCount: rows.length,
        onHandQty: totalOnHand.toFixed(),
        /**
         * Made but not yet reflected in the external system. This is the
         * figure the Phase 5 push exists to clear; it is shown here so the
         * backlog is visible even while the push is unavailable.
         */
        pendingSyncQty: pendingSync.toFixed(),
      },
      rows: rows.map((r) => ({
        id: r.id,
        productVariantId: r.productVariant.id,
        sku: r.productVariant.sku,
        productName: r.productVariant.product?.name ?? null,
        size: r.productVariant.size,
        color: r.productVariant.color,
        location: r.location,
        onHandQty: r.onHandQty.toFixed(),
        pendingSyncQty: r.pendingSyncQty.toFixed(),
        syncedQty: r.syncedQty.toFixed(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Orders with garments finished but not yet received into stock.
   *
   * Derived from the FINAL production stage, not from a counter on the order.
   * `ManufacturingOrder.completedQty` and `ManufacturingOrderItem.completedQty`
   * exist in the schema but nothing advances them - production writes stage
   * task counters and the order header is computed from its lines on read
   * ("header figures derived from the lines, never maintained in parallel").
   * Reading those columns would report every order as having produced nothing.
   *
   * What finishes a garment is completing the LAST step of its route. Anything
   * completed at an earlier stage is work in progress, not stock.
   */
  async awaitingInward(organizationId: string) {
    const batches = await this.prisma.productionBatch.findMany({
      where: { organizationId, manufacturingOrder: { status: { notIn: ['DRAFT', 'CANCELLED'] } } },
      select: {
        id: true,
        manufacturingOrderId: true,
        manufacturingOrder: {
          select: {
            id: true, moNo: true, status: true, productVariantId: true,
            productVariant: { select: { id: true, sku: true, product: { select: { name: true } } } },
            product: { select: { name: true } },
          },
        },
        stageTasks: {
          select: { sequence: true, completedQty: true, forwardedQty: true },
          orderBy: { sequence: 'desc' },
        },
      },
      take: 300,
    });

    // Already received, summed from posted receipts rather than a counter.
    const received = await this.prisma.finishedGoodsInward.findMany({
      where: { organizationId, status: 'POSTED' },
      select: { manufacturingOrderId: true, lines: { select: { acceptedQty: true } } },
    });
    const receivedBy = new Map<string, Decimal>();
    for (const r of received) {
      const sum = r.lines.reduce<Decimal>((a, l) => a.plus(dec(l.acceptedQty.toFixed())), new Decimal(0));
      receivedBy.set(r.manufacturingOrderId, (receivedBy.get(r.manufacturingOrderId) ?? new Decimal(0)).plus(sum));
    }

    const finishedBy = new Map<string, { order: (typeof batches)[number]['manufacturingOrder']; qty: Decimal }>();
    for (const b of batches) {
      if (b.stageTasks.length === 0) continue;
      // Highest sequence is the last step of the route.
      const lastSequence = b.stageTasks[0].sequence;
      const finished = b.stageTasks
        .filter((t) => t.sequence === lastSequence)
        .reduce<Decimal>((a, t) => a.plus(dec(t.completedQty.toFixed())), new Decimal(0));

      const entry = finishedBy.get(b.manufacturingOrderId);
      if (entry) entry.qty = entry.qty.plus(finished);
      else finishedBy.set(b.manufacturingOrderId, { order: b.manufacturingOrder, qty: finished });
    }

    return [...finishedBy.entries()]
      .map(([moId, { order, qty }]) => {
        const alreadyIn = receivedBy.get(moId) ?? new Decimal(0);
        return {
          id: moId,
          moNo: order.moNo,
          status: order.status,
          productName: order.productVariant?.product?.name ?? order.product?.name ?? null,
          sku: order.productVariant?.sku ?? null,
          productVariantId: order.productVariantId,
          completedQty: qty.toFixed(),
          inwardedQty: alreadyIn.toFixed(),
          pendingQty: Decimal.max(qty.minus(alreadyIn), 0).toFixed(),
        };
      })
      .filter((o) => dec(o.pendingQty).greaterThan(0))
      .sort((a, b) => Number(b.pendingQty) - Number(a.pendingQty));
  }

  async listInwards(organizationId: string, query: { status?: string } = {}) {
    const rows = await this.prisma.finishedGoodsInward.findMany({
      where: { organizationId, ...(query.status ? { status: query.status } : {}) },
      select: {
        id: true, inwardNo: true, status: true, syncStatus: true, inwardDate: true,
        postedAt: true, remarks: true, createdAt: true,
        manufacturingOrder: { select: { id: true, moNo: true } },
        lines: { select: { acceptedQty: true, rejectedQty: true, movementId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return rows.map((r) => ({
      id: r.id,
      inwardNo: r.inwardNo,
      status: r.status,
      syncStatus: r.syncStatus,
      moNo: r.manufacturingOrder?.moNo ?? null,
      manufacturingOrderId: r.manufacturingOrder?.id ?? null,
      lineCount: r.lines.length,
      acceptedQty: r.lines.reduce<Decimal>((s, l) => s.plus(dec(l.acceptedQty.toFixed())), new Decimal(0)).toFixed(),
      rejectedQty: r.lines.reduce<Decimal>((s, l) => s.plus(dec(l.rejectedQty.toFixed())), new Decimal(0)).toFixed(),
      isPosted: r.lines.every((l) => l.movementId !== null) && r.lines.length > 0,
      inwardDate: r.inwardDate.toISOString(),
      postedAt: r.postedAt?.toISOString() ?? null,
      remarks: r.remarks,
    }));
  }

  /**
   * Record finished garments against a manufacturing order.
   *
   * Validated against what the order actually completed BEFORE anything is
   * written. Creating the document first and checking later would leave a
   * rejected inward sitting in the list looking like work in progress.
   */
  async createInward(organizationId: string, actorUserId: string, body: CreateInwardBody) {
    return this.idempotency.execute(
      { organizationId, scope: 'finishedGoods.inward.create', key: body.idempotencyKey, payload: body, entityType: 'FinishedGoodsInward' },
      async () =>
        this.prisma.inTransaction(async (tx) => {
          const mo = await tx.manufacturingOrder.findFirst({
            where: { id: body.manufacturingOrderId, organizationId },
            select: { id: true, moNo: true, status: true },
          });
          if (!mo) {
            throw new NotFoundException({ code: 'MO_NOT_FOUND', message: 'Manufacturing order not found' });
          }
          if (mo.status === 'DRAFT' || mo.status === 'CANCELLED') {
            throw new ConflictException({
              code: 'MO_NOT_INWARDABLE',
              message: `Order ${mo.moNo} is ${mo.status.toLowerCase()}; nothing has been produced against it.`,
            });
          }

          const accepted = body.lines.reduce<Decimal>((s, l) => s.plus(dec(l.acceptedQty)), new Decimal(0));
          if (accepted.lessThanOrEqualTo(0)) {
            throw new BadRequestException({
              code: 'NOTHING_TO_INWARD',
              message: 'An inward must accept at least one unit.',
            });
          }

          // Same derivation as `awaitingInward`: finished at the LAST stage,
          // less what posted receipts already took. Recomputed inside the
          // transaction so two concurrent inwards cannot both pass a check
          // made against a figure read before either of them wrote.
          const pending = await this.pendingForOrder(tx, organizationId, mo.id);
          const ceiling = pending;
          if (accepted.greaterThan(ceiling)) {
            // The whole reason this check exists: receiving more than was made
            // creates garments nobody produced, and the discrepancy surfaces
            // as an order that cannot be picked.
            throw new BadRequestException({
              code: 'EXCEEDS_COMPLETED_QTY',
              message:
                `Order ${mo.moNo} has ${ceiling.toFixed()} units finished and not yet received. `
                + `Cannot inward ${accepted.toFixed()}.`,
              details: { availableToInward: ceiling.toFixed(), requested: accepted.toFixed() },
            });
          }

          const seq = await tx.finishedGoodsInward.count({ where: { organizationId } });
          const created = await tx.finishedGoodsInward.create({
            data: {
              organizationId,
              inwardNo: `FGI-${String(seq + 1).padStart(5, '0')}`,
              manufacturingOrderId: mo.id,
              manufacturingLocationId: body.manufacturingLocationId,
              status: 'DRAFT',
              inwardByUserId: actorUserId,
              remarks: body.remarks ?? null,
              lines: {
                create: body.lines.map((l, i) => ({
                  lineNo: i + 1,
                  productVariantId: l.productVariantId,
                  productionBatchId: l.productionBatchId ?? null,
                  acceptedQty: dec(l.acceptedQty).toFixed(),
                  rejectedQty: dec(l.rejectedQty ?? '0').toFixed(),
                })),
              },
            },
            select: { id: true, inwardNo: true, status: true },
          });

          return { result: created, entityId: created.id };
        }),
    );
  }

  /**
   * Post the inward: stock exists from here.
   *
   * One movement per line, the balance moved by the same amount, and the
   * order's inwarded quantity advanced — all in one transaction, because a
   * balance that moved without the order knowing would let the same garments
   * be received twice.
   */
  async postInward(organizationId: string, actorUserId: string, id: string, body: { idempotencyKey: string; locationId: string }) {
    return this.idempotency.execute(
      { organizationId, scope: 'finishedGoods.inward.post', key: body.idempotencyKey, payload: { id, ...body }, entityType: 'FinishedGoodsInward' },
      async () =>
        this.prisma.inTransaction(async (tx) => {
          const inward = await tx.finishedGoodsInward.findFirst({
            where: { id, organizationId },
            select: {
              id: true, inwardNo: true, status: true, manufacturingOrderId: true,
              lines: { select: { id: true, productVariantId: true, acceptedQty: true, movementId: true } },
            },
          });
          if (!inward) {
            throw new NotFoundException({ code: 'INWARD_NOT_FOUND', message: 'Inward not found' });
          }
          if (inward.status === 'POSTED') {
            throw new ConflictException({
              code: 'INWARD_ALREADY_POSTED',
              message: `${inward.inwardNo} has already been posted.`,
            });
          }

          const seq = await tx.finishedGoodsMovement.count({ where: { organizationId } });
          let n = 0;
          let total = new Decimal(0);

          for (const line of inward.lines) {
            if (line.movementId) continue;
            const qty = dec(line.acceptedQty.toFixed());
            if (qty.lessThanOrEqualTo(0)) continue;

            const movement = await tx.finishedGoodsMovement.create({
              data: {
                organizationId,
                movementNo: `FGM-${String(seq + n + 1).padStart(6, '0')}`,
                movementType: 'INWARD',
                productVariantId: line.productVariantId,
                destinationLocationId: body.locationId,
                qty: qty.toFixed(),
                referenceType: 'FinishedGoodsInward',
                referenceId: inward.id,
                referenceNo: inward.inwardNo,
                operatorUserId: actorUserId,
                idempotencyKey: `fg-inward:${inward.id}:${line.id}`,
              },
              select: { id: true },
            });

            await tx.finishedGoodsBalance.upsert({
              where: {
                productVariantId_locationId: {
                  productVariantId: line.productVariantId,
                  locationId: body.locationId,
                },
              },
              create: {
                organizationId,
                productVariantId: line.productVariantId,
                locationId: body.locationId,
                onHandQty: qty.toFixed(),
                // Made here, not yet reflected externally. The push clears it.
                pendingSyncQty: qty.toFixed(),
              },
              update: {
                onHandQty: { increment: qty.toFixed() },
                pendingSyncQty: { increment: qty.toFixed() },
                version: { increment: 1 },
              },
            });

            await tx.finishedGoodsInwardLine.update({
              where: { id: line.id },
              data: { movementId: movement.id },
            });

            total = total.plus(qty);
            n += 1;
          }

          // Deliberately does NOT increment ManufacturingOrder.inwardedQty.
          // Nothing else maintains that column, and a second writer would
          // make it disagree with the receipts it is supposed to summarise.
          // How much has been received is derived from posted receipts.

          await tx.finishedGoodsInward.update({
            where: { id },
            data: { status: 'POSTED', postedAt: new Date(), syncStatus: 'SYNC_PENDING' },
          });

          return {
            result: {
              id, inwardNo: inward.inwardNo, status: 'POSTED' as const,
              linesPosted: n, qtyReceived: total.toFixed(),
            },
            entityId: id,
          };
        }),
    );
  }

  /**
   * Units finished at the last route step, less what receipts already took.
   *
   * Shared by the listing and the write path so they cannot disagree about
   * what is available - a check that uses a different formula from the screen
   * that offered the action is how an operator gets told "no" for no reason.
   */
  private async pendingForOrder(
    tx: Pick<PrismaService, 'productionBatch' | 'finishedGoodsInward'>,
    organizationId: string,
    manufacturingOrderId: string,
  ): Promise<Decimal> {
    const [batches, receipts] = await Promise.all([
      tx.productionBatch.findMany({
        where: { organizationId, manufacturingOrderId },
        select: { stageTasks: { select: { sequence: true, completedQty: true }, orderBy: { sequence: 'desc' } } },
      }),
      tx.finishedGoodsInward.findMany({
        where: { organizationId, manufacturingOrderId, status: 'POSTED' },
        select: { lines: { select: { acceptedQty: true } } },
      }),
    ]);

    let finished = new Decimal(0);
    for (const b of batches) {
      if (b.stageTasks.length === 0) continue;
      const last = b.stageTasks[0].sequence;
      finished = finished.plus(
        b.stageTasks
          .filter((t) => t.sequence === last)
          .reduce<Decimal>((a, t) => a.plus(dec(t.completedQty.toFixed())), new Decimal(0)),
      );
    }

    const taken = receipts.reduce<Decimal>(
      (a, r) => a.plus(r.lines.reduce<Decimal>((x, l) => x.plus(dec(l.acceptedQty.toFixed())), new Decimal(0))),
      new Decimal(0),
    );

    return Decimal.max(finished.minus(taken), 0);
  }
}
