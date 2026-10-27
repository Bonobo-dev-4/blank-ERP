import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Decimal, dec, demandFingerprint, reconcileIncomingDemand,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';

/**
 * Manufacturing demand.
 *
 * This is the join the whole of phase 4 exists for: an imported order line is a
 * record of what a customer bought, and demand is a decision about what the
 * factory is being asked to make. They are not the same thing, which is why
 * promoting one into the other is explicit rather than a side effect of import.
 *
 * Deduplication keys on what the demand IS - this SKU, for that commerce order
 * line - not on the document it arrived in. The same order legitimately arrives
 * twice, once from Shopify directly and once mirrored through Unicommerce, and
 * keying on the document would manufacture it twice.
 */
/** Columns the demand list may be sorted by — a whitelist, never a raw field. */
export const DEMAND_SORT_KEYS = ['requiredByDate', 'createdAt', 'demandNo', 'requestedQty', 'manufacturingQty', 'priority', 'status'] as const;
export type DemandSortKey = (typeof DEMAND_SORT_KEYS)[number];

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    organizationId: string,
    query: {
      status?: string; channel?: string; priority?: string; search?: string; mapped?: boolean;
      sortBy?: DemandSortKey; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const q = query.search?.trim();
    const where: Prisma.ManufacturingDemandWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.channel ? { channel: query.channel as never } : {}),
      ...(query.priority ? { priority: query.priority as never } : {}),
      ...(query.mapped === true ? { productVariantId: { not: null } } : {}),
      ...(query.mapped === false ? { productVariantId: null } : {}),
      ...(q
        ? {
            OR: [
              { demandNo: { contains: q, mode: 'insensitive' } },
              { externalSku: { contains: q, mode: 'insensitive' } },
              { productVariant: { sku: { contains: q, mode: 'insensitive' } } },
              { productVariant: { product: { name: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    // Default: most urgent first — what is due soonest, then newest.
    const dir = query.sortDir ?? 'asc';
    const orderBy: Prisma.ManufacturingDemandOrderByWithRelationInput[] = query.sortBy
      ? [
          query.sortBy === 'requiredByDate'
            ? { requiredByDate: { sort: dir, nulls: 'last' } }
            : { [query.sortBy]: dir },
          { id: dir },
        ]
      : [{ requiredByDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];

    const [rows, total, counts, byChannel, byPriority] = await Promise.all([
      this.prisma.manufacturingDemand.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
        select: {
          id: true, demandNo: true, channel: true, externalSku: true, requestedQty: true,
          manufacturingQty: true, allocatedQty: true, cancelledQty: true, status: true,
          priority: true, requiredByDate: true, decisionReason: true, createdAt: true,
          productVariant: {
            select: { id: true, sku: true, size: true, color: true, product: { select: { name: true } } },
          },
          sourceMappings: {
            select: { sourceSystem: true, sourceDocNo: true, sourceLineQty: true, isPrimary: true },
          },
        },
      }),
      this.prisma.manufacturingDemand.count({ where }),
      this.prisma.manufacturingDemand.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.manufacturingDemand.groupBy({ by: ['channel'], where: { organizationId }, _count: { _all: true } }),
      this.prisma.manufacturingDemand.groupBy({ by: ['priority'], where: { organizationId }, _count: { _all: true } }),
    ]);

    return {
      data: rows.map((d) => ({
        id: d.id,
        demandNo: d.demandNo,
        channel: d.channel,
        sku: d.productVariant?.sku ?? d.externalSku,
        productName: d.productVariant?.product?.name ?? null,
        size: d.productVariant?.size ?? null,
        color: d.productVariant?.color ?? null,
        isMapped: d.productVariant !== null,
        requestedQty: d.requestedQty.toFixed(),
        manufacturingQty: d.manufacturingQty.toFixed(),
        allocatedQty: d.allocatedQty.toFixed(),
        cancelledQty: d.cancelledQty.toFixed(),
        openQty: Decimal.max(
          dec(d.manufacturingQty.toFixed()).minus(dec(d.allocatedQty.toFixed())),
          0,
        ).toFixed(),
        status: d.status,
        priority: d.priority,
        requiredByDate: d.requiredByDate?.toISOString() ?? null,
        decisionReason: d.decisionReason,
        createdAt: d.createdAt.toISOString(),
        sources: d.sourceMappings.map((m) => ({
          system: m.sourceSystem,
          docNo: m.sourceDocNo,
          qty: m.sourceLineQty.toFixed(),
          isPrimary: m.isPrimary,
        })),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      byChannel: Object.fromEntries(byChannel.map((c) => [c.channel, c._count._all])),
      byPriority: Object.fromEntries(byPriority.map((c) => [c.priority, c._count._all])),
    };
  }

  /**
   * Promote imported Shopify order lines into manufacturing demand.
   *
   * Only lines that still owe the customer something are promoted - a line
   * already shipped or refunded is history, not a request to make anything.
   *
   * A line whose SKU has no product variant still becomes demand, flagged
   * NEEDS_MAPPING. Dropping it would make the shortfall invisible; the business
   * is owed those garments whether or not anyone has mapped the SKU yet.
   */
  async promoteShopifyOrders(
    organizationId: string,
    body: { idempotencyKey: string; since?: string; limit?: number },
  ) {
    return this.idempotency.execute(
      { organizationId, scope: 'demand.promoteShopify', key: body.idempotencyKey, payload: body, entityType: 'ManufacturingDemand' },
      async () => {
        const take = Math.min(1000, Math.max(1, body.limit ?? 500));
        const orders = await this.prisma.shopifyOrder.findMany({
          where: {
            organizationId,
            status: { not: 'CANCELLED' },
            ...(body.since ? { orderedAt: { gte: new Date(body.since) } } : {}),
          },
          orderBy: { orderedAt: 'desc' },
          take,
          select: {
            id: true, orderNumber: true, orderName: true, channel: true, orderedAt: true,
            requiredByDate: true, isCustomised: true,
            lines: {
              select: {
                id: true, externalSku: true, productVariantId: true,
                manufacturingQty: true, orderedQty: true,
              },
            },
          },
        });

        if (orders.length === 0) {
          throw new BadRequestException({
            code: 'NO_ORDERS_TO_PROMOTE',
            message: 'No imported orders match. Import orders first, or widen the date.',
          });
        }

        let created = 0;
        let attached = 0;
        let updated = 0;
        let ignored = 0;
        let skippedNoDemand = 0;

        for (const order of orders) {
          for (const line of order.lines) {
            const demandQty = dec(line.manufacturingQty.toFixed());
            if (demandQty.lessThanOrEqualTo(0)) {
              // Already shipped, refunded or cancelled. Nothing is owed.
              skippedNoDemand += 1;
              continue;
            }

            const fingerprint = demandFingerprint({
              commerceOrderRef: order.orderName ?? order.orderNumber,
              commerceLineRef: line.id,
              productVariantId: line.productVariantId,
              externalSku: line.externalSku,
            });

            await this.prisma.inTransaction(async (tx) => {
              const [existingDemand, existingMapping] = await Promise.all([
                tx.manufacturingDemand.findFirst({
                  where: { organizationId, dedupeFingerprint: fingerprint },
                  select: { id: true, requestedQty: true, manufacturingQty: true },
                }),
                tx.demandSourceMapping.findUnique({
                  where: {
                    organizationId_sourceSystem_sourceDocType_sourceDocId_sourceLineId: {
                      organizationId,
                      sourceSystem: 'SHOPIFY',
                      sourceDocType: 'ORDER',
                      sourceDocId: order.id,
                      sourceLineId: line.id,
                    },
                  },
                  select: { id: true, sourceLineQty: true },
                }),
              ]);

              const decision = reconcileIncomingDemand({
                existingDemand,
                existingMapping,
                incomingQty: demandQty,
              });

              if (decision.action === 'IGNORE_DUPLICATE') {
                ignored += 1;
                return;
              }

              if (decision.action === 'UPDATE_QUANTITY' && existingDemand && existingMapping) {
                const delta = decision.quantityDelta ?? new Decimal(0);
                await tx.manufacturingDemand.update({
                  where: { id: existingDemand.id },
                  data: {
                    requestedQty: dec(existingDemand.requestedQty.toFixed()).plus(delta).toFixed(),
                    manufacturingQty: Decimal.max(
                      dec(existingDemand.manufacturingQty.toFixed()).plus(delta),
                      0,
                    ).toFixed(),
                    decisionReason: decision.reason,
                  },
                });
                await tx.demandSourceMapping.updateMany({
                  where: {
                    organizationId, sourceSystem: 'SHOPIFY', sourceDocType: 'ORDER',
                    sourceDocId: order.id, sourceLineId: line.id,
                  },
                  data: { sourceLineQty: demandQty.toFixed(), lastSeenAt: new Date() },
                });
                updated += 1;
                return;
              }

              let demandId: string;
              if (decision.action === 'ATTACH_TO_EXISTING' && existingDemand) {
                demandId = existingDemand.id;
                attached += 1;
              } else {
                const seq = await tx.manufacturingDemand.count({ where: { organizationId } });
                const demand = await tx.manufacturingDemand.create({
                  data: {
                    organizationId,
                    demandNo: `DEM-${String(seq + 1).padStart(6, '0')}`,
                    channel: order.channel,
                    productVariantId: line.productVariantId,
                    externalSku: line.externalSku,
                    requestedQty: demandQty.toFixed(),
                    manufacturingQty: demandQty.toFixed(),
                    // Unmapped SKUs still become demand. Dropping them would
                    // hide a real shortfall behind a mapping gap.
                    status: line.productVariantId ? 'NEW' : 'NEEDS_MAPPING',
                    requiredByDate: order.requiredByDate,
                    dedupeFingerprint: fingerprint,
                    decisionReason: decision.reason,
                  },
                  select: { id: true },
                });
                demandId = demand.id;
                created += 1;
              }

              await tx.demandSourceMapping.create({
                data: {
                  organizationId,
                  manufacturingDemandId: demandId,
                  sourceSystem: 'SHOPIFY',
                  sourceDocType: 'ORDER',
                  sourceDocId: order.id,
                  sourceDocNo: order.orderName ?? order.orderNumber,
                  sourceLineId: line.id,
                  sourceLineQty: demandQty.toFixed(),
                  isPrimary: decision.action !== 'ATTACH_TO_EXISTING',
                },
              });
            });
          }
        }

        this.logger.log(
          `Promoted Shopify demand: ${created} created, ${attached} attached, ${updated} updated`,
        );

        return {
          result: {
            ordersScanned: orders.length,
            created, attached, updated, ignored, skippedNoDemand,
          },
          entityId: null,
        };
      },
    );
  }
}
