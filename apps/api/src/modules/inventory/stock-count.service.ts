import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  OpenStockCountRequest, PostStockCountRequest, RecordStockCountRequest, StockCountListQuery,
} from '@dnd/contracts';
import { Decimal, dec } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { InventoryService } from './inventory.service';

type CountStatus = 'DRAFT' | 'COUNTED' | 'POSTED' | 'CANCELLED';

/**
 * Stock counts — cycle counting against the ledger.
 *
 * Two rules shape everything here.
 *
 * **The system quantity is snapshotted when the count opens, not when it is
 * posted.** A count is a statement about what was on the shelf at a moment. If
 * the variance were recomputed at posting time, stock legitimately issued while
 * the counter walked the aisle would appear as a discrepancy, and the
 * adjustment would silently undo real production activity.
 *
 * **Posting does not write balances.** It raises an adjustment per varying
 * line through `InventoryService.adjust`, which goes through the ledger like
 * every other movement. `LedgerService` stays the only writer of
 * `material_balances`, so a count cannot create stock that no movement explains.
 */
@Injectable()
export class StockCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(organizationId: string, query: StockCountListQuery) {
    const counts = await this.prisma.stockCount.findMany({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.locationId ? { locationId: query.locationId } : {}),
      },
      select: {
        id: true, countNo: true, status: true, countedAt: true, postedAt: true,
        createdAt: true, remarks: true,
        location: { select: { id: true, code: true, name: true, kind: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const ids = counts.map((c) => c.id);
    const variance = ids.length
      ? await this.prisma.stockCountLine.groupBy({
          by: ['stockCountId'],
          where: { stockCountId: { in: ids } },
          _sum: { varianceQty: true },
        })
      : [];
    const varianceBy = new Map(variance.map((v) => [v.stockCountId, dec(v._sum?.varianceQty?.toFixed() ?? '0')] as const));

    return counts.map((c) => ({
      id: c.id,
      countNo: c.countNo,
      status: c.status,
      location: c.location,
      lineCount: c._count.lines,
      netVarianceQty: (varianceBy.get(c.id) ?? new Decimal(0)).toFixed(),
      countedAt: c.countedAt?.toISOString() ?? null,
      postedAt: c.postedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      remarks: c.remarks,
    }));
  }

  async get(organizationId: string, id: string) {
    const count = await this.prisma.stockCount.findFirst({
      where: { id, organizationId },
      select: {
        id: true, countNo: true, status: true, countedAt: true, postedAt: true,
        createdAt: true, remarks: true,
        location: { select: { id: true, code: true, name: true, kind: true } },
        lines: {
          select: {
            id: true, systemQty: true, countedQty: true, varianceQty: true,
            reason: true, movementId: true,
            materialLotId: true,
            rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!count) throw new NotFoundException({ code: 'STOCK_COUNT_NOT_FOUND', message: 'Stock count not found' });

    const lots = await this.prisma.materialLot.findMany({
      where: { id: { in: count.lines.map((l) => l.materialLotId) } },
      select: { id: true, lotCode: true },
    });
    const lotBy = new Map(lots.map((l) => [l.id, l.lotCode] as const));

    return {
      ...count,
      countedAt: count.countedAt?.toISOString() ?? null,
      postedAt: count.postedAt?.toISOString() ?? null,
      createdAt: count.createdAt.toISOString(),
      lines: count.lines.map((l) => ({
        id: l.id,
        rawMaterialId: l.rawMaterial.id,
        materialCode: l.rawMaterial.materialCode,
        materialName: l.rawMaterial.name,
        baseUom: l.rawMaterial.baseUom,
        lotId: l.materialLotId,
        lotNo: lotBy.get(l.materialLotId) ?? null,
        systemQty: l.systemQty.toFixed(),
        countedQty: l.countedQty.toFixed(),
        varianceQty: l.varianceQty.toFixed(),
        reason: l.reason,
        isPosted: l.movementId !== null,
      })),
    };
  }

  /**
   * Open a count: freeze what the system believes is on the shelf.
   *
   * Counted quantity starts equal to the system quantity so an untouched line
   * posts nothing. A count sheet that defaulted to zero would turn every line
   * nobody reached into a total write-off.
   */
  async open(organizationId: string, actorUserId: string, body: OpenStockCountRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.stockCount.open', key: body.idempotencyKey, payload: body, entityType: 'StockCount' },
      async () =>
        this.prisma.inTransaction(async (tx) => {
          const location = await tx.materialLocation.findFirst({
            where: { id: body.locationId, organizationId },
            select: { id: true, code: true, kind: true },
          });
          if (!location) {
            throw new NotFoundException({ code: 'LOCATION_NOT_FOUND', message: 'Stock location not found' });
          }
          if (location.kind === 'SINK' || location.kind === 'COUNTERPARTY') {
            // These are accounting sinks, not shelves. Nobody can walk to one
            // and count it, so a variance against one is meaningless.
            throw new BadRequestException({
              code: 'LOCATION_NOT_COUNTABLE',
              message: 'This is a system location, not a physical place. It cannot be counted.',
              details: { kind: location.kind },
            });
          }

          const balances = await tx.materialBalance.findMany({
            where: {
              organizationId,
              locationId: body.locationId,
              ...(body.rawMaterialIds?.length ? { rawMaterialId: { in: body.rawMaterialIds } } : {}),
            },
            select: { rawMaterialId: true, materialLotId: true, onHandQty: true },
          });
          if (balances.length === 0) {
            throw new BadRequestException({
              code: 'NOTHING_TO_COUNT',
              message: 'No stock is recorded at this location, so there is nothing to count.',
            });
          }

          const open = await tx.stockCount.findFirst({
            where: { organizationId, locationId: body.locationId, status: { in: ['DRAFT', 'COUNTED'] } },
            select: { id: true, countNo: true },
          });
          if (open) {
            // Two open counts on one location produce two adjustments for the
            // same discrepancy, and the second one doubles it.
            throw new ConflictException({
              code: 'COUNT_ALREADY_OPEN',
              message: `Count ${open.countNo} is already open for this location. Finish or cancel it first.`,
              details: { stockCountId: open.id, countNo: open.countNo },
            });
          }

          const seq = await tx.stockCount.count({ where: { organizationId } });
          const countNo = `SC-${String(seq + 1).padStart(5, '0')}`;

          const created = await tx.stockCount.create({
            data: {
              organizationId,
              countNo,
              locationId: body.locationId,
              status: 'DRAFT' satisfies CountStatus,
              countedByUserId: actorUserId,
              remarks: body.remarks ?? null,
              lines: {
                create: balances.map((b) => ({
                  rawMaterialId: b.rawMaterialId,
                  materialLotId: b.materialLotId,
                  systemQty: b.onHandQty,
                  // Defaults to the system figure: an untouched line is "agrees",
                  // not "none found".
                  countedQty: b.onHandQty,
                  varianceQty: 0,
                })),
              },
            },
            select: { id: true, countNo: true, status: true },
          });
          return { result: created, entityId: created.id };
        }),
    );
  }

  /** Record counted quantities. Variance is derived, never supplied. */
  async record(organizationId: string, id: string, body: RecordStockCountRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'inventory.stockCount.record', key: body.idempotencyKey, payload: body, entityType: 'StockCount' },
      async () =>
        this.prisma.inTransaction(async (tx) => {
          const count = await tx.stockCount.findFirst({
            where: { id, organizationId },
            select: { id: true, status: true, countNo: true },
          });
          if (!count) throw new NotFoundException({ code: 'STOCK_COUNT_NOT_FOUND', message: 'Stock count not found' });
          if (count.status === 'POSTED' || count.status === 'CANCELLED') {
            throw new ConflictException({
              code: 'COUNT_NOT_EDITABLE',
              message: `Count ${count.countNo} is ${count.status.toLowerCase()} and can no longer be changed.`,
            });
          }

          for (const line of body.lines) {
            const existing = await tx.stockCountLine.findFirst({
              where: { id: line.lineId, stockCountId: id },
              select: { id: true, systemQty: true },
            });
            if (!existing) {
              throw new NotFoundException({
                code: 'COUNT_LINE_NOT_FOUND',
                message: 'That line does not belong to this count',
                details: { lineId: line.lineId },
              });
            }
            const counted = dec(line.countedQty);
            if (counted.lessThan(0)) {
              throw new BadRequestException({
                code: 'NEGATIVE_COUNT',
                message: 'A counted quantity cannot be negative',
                details: { lineId: line.lineId },
              });
            }
            await tx.stockCountLine.update({
              where: { id: existing.id },
              data: {
                countedQty: counted.toFixed(),
                // Derived here so the stored variance can never disagree with
                // the two numbers it is the difference of.
                varianceQty: counted.minus(dec(existing.systemQty.toFixed())).toFixed(),
                reason: line.reason ?? null,
              },
            });
          }

          await tx.stockCount.update({
            where: { id },
            data: { status: 'COUNTED' satisfies CountStatus, countedAt: new Date() },
          });

          return {
            result: { id, status: 'COUNTED' as const, linesRecorded: body.lines.length },
            entityId: id,
          };
        }),
    );
  }

  /**
   * Post the variances as ledger adjustments.
   *
   * Each varying line becomes one adjustment with a deterministic idempotency
   * key derived from the line, so a retry after a timeout cannot double-adjust.
   * Lines that agree with the system post nothing at all.
   */
  async post(organizationId: string, actorUserId: string, id: string, body: PostStockCountRequest) {
    const count = await this.prisma.stockCount.findFirst({
      where: { id, organizationId },
      select: {
        id: true, countNo: true, status: true, locationId: true,
        lines: {
          select: {
            id: true, rawMaterialId: true, materialLotId: true, varianceQty: true,
            movementId: true, reason: true,
            rawMaterial: { select: { baseUom: true } },
          },
        },
      },
    });
    if (!count) throw new NotFoundException({ code: 'STOCK_COUNT_NOT_FOUND', message: 'Stock count not found' });
    if (count.status === 'POSTED') {
      throw new ConflictException({
        code: 'COUNT_ALREADY_POSTED',
        message: `Count ${count.countNo} has already been posted.`,
      });
    }
    if (count.status !== 'COUNTED') {
      throw new ConflictException({
        code: 'COUNT_NOT_READY',
        message: `Count ${count.countNo} has no recorded quantities yet.`,
      });
    }

    const varying = count.lines.filter((l) => !dec(l.varianceQty.toFixed()).isZero() && l.movementId === null);

    // Adjustments go out one at a time through the ledger rather than in one
    // transaction with the status flip. A partial failure must leave the count
    // OPEN with the posted lines marked, so a retry finishes the rest instead
    // of replaying what already landed.
    const posted: string[] = [];
    for (const line of varying) {
      const result = await this.inventory.adjust(organizationId, actorUserId, {
        idempotencyKey: `stock-count:${count.id}:${line.id}`,
        rawMaterialId: line.rawMaterialId,
        materialLotId: line.materialLotId,
        locationId: count.locationId,
        adjustmentQty: line.varianceQty.toFixed(),
        uom: line.rawMaterial.baseUom,
        reason: line.reason ?? body.reason,
        remarks: `Stock count ${count.countNo}`,
      });
      // `adjust` returns the idempotency envelope, and the movement IS the
      // result inside it. Reading one level too shallow left movementId null,
      // which silently broke the audit link from a counted line to the ledger
      // row that corrected it.
      const movementId = (result as { result?: { id?: string } }).result?.id ?? null;
      await this.prisma.stockCountLine.update({
        where: { id: line.id },
        data: { movementId },
      });
      posted.push(line.id);
    }

    await this.prisma.stockCount.update({
      where: { id },
      data: { status: 'POSTED' satisfies CountStatus, postedAt: new Date(), postedByUserId: actorUserId },
    });

    return {
      id,
      countNo: count.countNo,
      status: 'POSTED' as const,
      linesAdjusted: posted.length,
      linesAgreed: count.lines.length - varying.length,
    };
  }

  /** Abandon a count without touching stock. */
  async cancel(organizationId: string, id: string) {
    const count = await this.prisma.stockCount.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true, countNo: true },
    });
    if (!count) throw new NotFoundException({ code: 'STOCK_COUNT_NOT_FOUND', message: 'Stock count not found' });
    if (count.status === 'POSTED') {
      throw new ConflictException({
        code: 'COUNT_ALREADY_POSTED',
        message: `Count ${count.countNo} is posted. Correct it with a new count, not by cancelling this one.`,
      });
    }
    await this.prisma.stockCount.update({ where: { id }, data: { status: 'CANCELLED' satisfies CountStatus } });
    return { id, status: 'CANCELLED' as const };
  }
}
