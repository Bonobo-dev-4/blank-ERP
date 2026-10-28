import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuthenticatedUser, SetDispatchDateRequest, SetOrderPriorityRequest,
} from '@dnd/contracts';
import {
  addDays, detectShopifyDispatchDate, isValidYmd, istToday, planShopifyCrmSync, shopifyOrderDetails,
  shopifyPriority, type DispatchDateSource,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { ShopifyClient } from '../integrations/shopify.client';
import { ShopifyService, dateOf, ymdOf } from '../integrations/shopify.service';

const SOURCE_LABEL: Record<string, string> = {
  CRM_MANUAL: 'CRM', SHOPIFY_METAFIELD: 'Shopify field', SHOPIFY_CUSTOM_ATTRIBUTE: 'Shopify checkout attribute',
  SHOPIFY_NOTE: 'Shopify note', UNASSIGNED: 'unassigned',
};

const CRM_SELECT = {
  id: true, organizationId: true, status: true, externalShipmentStatus: true,
  expectedDispatchDate: true, dispatchDateSource: true, dispatchDateLocked: true,
  dispatchDateUpdatedById: true, dispatchDateUpdatedAt: true, dispatchDateOriginalValue: true,
  dispatchDateChangeReason: true, shopifyDispatchDate: true, shopifyDispatchSource: true,
  shopifyDispatchText: true, shopifyDispatchIssue: true, orderPriority: true, prioritySource: true,
  priorityUpdatedById: true, priorityUpdatedAt: true, priorityReason: true, crmRemarks: true,
  crmRemarksUpdatedById: true, crmRemarksUpdatedAt: true,
} satisfies Prisma.ShopifyOrderSelect;

/**
 * The CRM team's promises on an order: its priority, the dispatch date given
 * to the customer, and remarks.
 *
 * Every change is one transaction — the order, an append-only history row,
 * an audit entry, and the "needed by" date of any manufacturing demand the
 * order feeds — so the promise and the production view never disagree. A
 * CRM date locks the order against Shopify sync; only an explicit "use
 * Shopify's date" unlocks it.
 */
@Injectable()
export class OrderCrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly shopify: ShopifyService,
    private readonly shopifyClient: ShopifyClient,
  ) {}

  async setDispatchDate(user: AuthenticatedUser, orderId: string, body: SetDispatchDateRequest) {
    if (body.date !== null) assertSaneDate(body.date);
    await this.prisma.inTransaction(async (tx) => {
      const order = await this.load(tx, user.organizationId, orderId);
      const before = ymdOf(order.expectedDispatchDate);
      if (before === body.date && order.dispatchDateLocked) return;
      if (before !== null && before !== body.date) requireReason(body.reason, 'Changing or clearing a dispatch date needs a reason.');

      // The first CRM override keeps where the date came from.
      const original = order.dispatchDateLocked
        ? order.dispatchDateOriginalValue
        : before
          ? `${before} from ${SOURCE_LABEL[order.dispatchDateSource] ?? order.dispatchDateSource}${order.shopifyDispatchText ? `: ${order.shopifyDispatchText}` : ''}`
          : null;
      const source: DispatchDateSource = body.date ? 'CRM_MANUAL' : 'UNASSIGNED';

      await tx.shopifyOrder.update({
        where: { id: order.id },
        data: {
          expectedDispatchDate: dateOf(body.date),
          dispatchDateSource: source,
          dispatchDateLocked: true,
          dispatchDateUpdatedById: user.id,
          dispatchDateUpdatedAt: new Date(),
          dispatchDateChangeReason: body.reason?.trim() || null,
          dispatchDateOriginalValue: original,
        },
      });
      await this.record(tx, user, order.id, 'EXPECTED_DISPATCH_DATE', before, body.date, 'CRM_MANUAL', body.reason);
      await this.syncDemandDates(tx, user.organizationId, order.id);
    });
    return this.view(user.organizationId, orderId);
  }

  /** Hand the date back to Shopify: unlock, and take what Shopify says now. */
  async useShopifyDate(user: AuthenticatedUser, orderId: string, reason: string) {
    await this.prisma.inTransaction(async (tx) => {
      const order = await this.load(tx, user.organizationId, orderId);
      const before = ymdOf(order.expectedDispatchDate);
      const after = ymdOf(order.shopifyDispatchDate);
      await tx.shopifyOrder.update({
        where: { id: order.id },
        data: {
          expectedDispatchDate: order.shopifyDispatchDate,
          dispatchDateSource: after ? (order.shopifyDispatchSource ?? 'SHOPIFY_NOTE') : 'UNASSIGNED',
          dispatchDateLocked: false,
          dispatchDateUpdatedById: user.id,
          dispatchDateUpdatedAt: new Date(),
          dispatchDateChangeReason: reason.trim(),
        },
      });
      await this.record(tx, user, order.id, 'EXPECTED_DISPATCH_DATE', before, after, 'CRM_MANUAL', `Returned to Shopify's date. ${reason.trim()}`);
      await this.syncDemandDates(tx, user.organizationId, order.id);
    });
    return this.view(user.organizationId, orderId);
  }

  async setPriority(user: AuthenticatedUser, orderId: string, body: SetOrderPriorityRequest) {
    await this.prisma.inTransaction(async (tx) => {
      const order = await this.load(tx, user.organizationId, orderId);
      if (order.orderPriority === body.priority && order.prioritySource === 'CRM_MANUAL') return;
      await tx.shopifyOrder.update({
        where: { id: order.id },
        data: {
          orderPriority: body.priority,
          prioritySource: 'CRM_MANUAL',
          priorityUpdatedById: user.id,
          priorityUpdatedAt: new Date(),
          priorityReason: body.reason?.trim() || null,
        },
      });
      await this.record(tx, user, order.id, 'PRIORITY', order.orderPriority, body.priority, 'CRM_MANUAL', body.reason);
    });
    return this.view(user.organizationId, orderId);
  }

  async setRemarks(user: AuthenticatedUser, orderId: string, remarks: string | null) {
    const next = remarks?.trim() || null;
    await this.prisma.inTransaction(async (tx) => {
      const order = await this.load(tx, user.organizationId, orderId);
      if ((order.crmRemarks ?? null) === next) return;
      await tx.shopifyOrder.update({
        where: { id: order.id },
        data: { crmRemarks: next, crmRemarksUpdatedById: user.id, crmRemarksUpdatedAt: new Date() },
      });
      await this.record(tx, user, order.id, 'CRM_REMARKS', order.crmRemarks, next, 'CRM_MANUAL', null);
    });
    return this.view(user.organizationId, orderId);
  }

  async history(organizationId: string, orderId: string) {
    const rows = await this.prisma.orderCrmChange.findMany({
      where: { organizationId, shopifyOrderId: orderId },
      orderBy: { changedAt: 'desc' },
      take: 200,
    });
    const ids = [...new Set(rows.map((r) => r.changedById).filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    return rows.map((r) => ({
      id: r.id, field: r.field, previousValue: r.previousValue, newValue: r.newValue,
      source: r.source, reason: r.reason, changedAt: r.changedAt.toISOString(),
      changedBy: r.changedById ? users.find((u) => u.id === r.changedById)?.fullName ?? null : null,
    }));
  }

  /**
   * Read dispatch dates and approved-tag priorities again from the Shopify data
   * already stored — after the parser improves, or for orders imported before
   * it existed. No Shopify call; CRM-set values are never touched.
   */
  async rescan(user: AuthenticatedUser) {
    const tagMap = this.shopifyClient.crmConfig().priorityTagMap;
    let cursor: string | undefined;
    const counts = { scanned: 0, datesChanged: 0, prioritiesChanged: 0, flagged: 0 };
    for (;;) {
      const batch = await this.prisma.shopifyOrder.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true, note: true, tags: true, orderedAt: true, rawPayload: true,
          expectedDispatchDate: true, dispatchDateSource: true, dispatchDateLocked: true,
          orderPriority: true, prioritySource: true,
          shopifyDispatchDate: true, shopifyDispatchSource: true, shopifyDispatchText: true, shopifyDispatchIssue: true,
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const o of batch) {
        counts.scanned += 1;
        const raw = (o.rawPayload ?? {}) as { crmDispatch?: { value?: string | null }; crmPriority?: { value?: string | null } };
        const plan = planShopifyCrmSync(
          {
            expectedDispatchDate: ymdOf(o.expectedDispatchDate), dispatchDateSource: o.dispatchDateSource,
            dispatchDateLocked: o.dispatchDateLocked, orderPriority: o.orderPriority, prioritySource: o.prioritySource,
          },
          detectShopifyDispatchDate({
            note: o.note, attributes: shopifyOrderDetails(o.rawPayload).attributes,
            metafieldValue: raw.crmDispatch?.value ?? null, orderedAt: o.orderedAt,
          }),
          shopifyPriority({ tags: o.tags, tagMap, metafieldValue: raw.crmPriority?.value ?? null }),
        );
        if (plan.shopify.issue) counts.flagged += 1;
        const shopifyChanged =
          ymdOf(o.shopifyDispatchDate) !== plan.shopify.date || o.shopifyDispatchSource !== plan.shopify.source
          || o.shopifyDispatchText !== plan.shopify.text || o.shopifyDispatchIssue !== plan.shopify.issue;
        if (!shopifyChanged && !plan.dispatch && !plan.priority) continue;

        await this.prisma.inTransaction(async (tx) => {
          await tx.shopifyOrder.update({
            where: { id: o.id },
            data: {
              shopifyDispatchDate: dateOf(plan.shopify.date), shopifyDispatchSource: plan.shopify.source,
              shopifyDispatchText: plan.shopify.text, shopifyDispatchIssue: plan.shopify.issue,
              ...(plan.dispatch ? {
                expectedDispatchDate: dateOf(plan.dispatch.date), dispatchDateSource: plan.dispatch.source,
                dispatchDateUpdatedAt: new Date(), dispatchDateUpdatedById: null,
              } : {}),
              ...(plan.priority ? {
                orderPriority: plan.priority.value, prioritySource: plan.priority.source,
                priorityUpdatedAt: new Date(), priorityUpdatedById: null,
              } : {}),
            },
          });
          if (plan.changes.length) {
            await tx.orderCrmChange.createMany({
              data: plan.changes.map((c) => ({
                organizationId: user.organizationId, shopifyOrderId: o.id, field: c.field,
                previousValue: c.previousValue, newValue: c.newValue, source: c.source,
                reason: c.field === 'EXPECTED_DISPATCH_DATE' ? plan.dispatch?.text ?? null : null,
              })),
            });
          }
          if (plan.dispatch) await this.syncDemandDates(tx, user.organizationId, o.id);
        });
        if (plan.dispatch) counts.datesChanged += 1;
        if (plan.priority) counts.prioritiesChanged += 1;
      }
    }
    await this.audit.record({
      organizationId: user.organizationId, actorUserId: user.id, action: 'RUN',
      entityType: 'OrderCrmRescan', entityId: user.organizationId, context: counts,
    });
    return counts;
  }

  // ---------------------------------------------------------------------------

  private async view(organizationId: string, orderId: string) {
    const order = await this.prisma.shopifyOrder.findFirst({ where: { id: orderId, organizationId }, select: CRM_SELECT });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    return { orderId: order.id, crm: await this.shopify.crmView(order) };
  }

  private async load(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const order = await tx.shopifyOrder.findFirst({ where: { id, organizationId }, select: CRM_SELECT });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    return order;
  }

  private async record(
    tx: Prisma.TransactionClient, user: AuthenticatedUser, orderId: string, field: string,
    previousValue: string | null, newValue: string | null, source: string, reason: string | null | undefined,
  ) {
    await tx.orderCrmChange.create({
      data: {
        organizationId: user.organizationId, shopifyOrderId: orderId, field, previousValue, newValue,
        source, reason: reason?.trim() || null, changedById: user.id,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId, actorUserId: user.id, action: 'UPDATE',
      entityType: 'ShopifyOrder', entityId: orderId,
      context: { field, previousValue, newValue, source, reason: reason?.trim() || null },
    }, tx);
  }

  /**
   * Demand made for an order is needed by the date promised to its customer.
   * A demand shared by several orders is needed by the earliest of them.
   */
  private async syncDemandDates(tx: Prisma.TransactionClient, organizationId: string, orderId: string) {
    const mine = await tx.demandSourceMapping.findMany({
      where: { organizationId, sourceSystem: 'SHOPIFY', sourceDocType: 'ORDER', sourceDocId: orderId },
      select: { manufacturingDemandId: true },
    });
    for (const demandId of new Set(mine.map((m) => m.manufacturingDemandId))) {
      const sources = await tx.demandSourceMapping.findMany({
        where: { manufacturingDemandId: demandId, sourceSystem: 'SHOPIFY', sourceDocType: 'ORDER' },
        select: { sourceDocId: true },
      });
      const orders = await tx.shopifyOrder.findMany({
        where: { id: { in: sources.map((s) => s.sourceDocId) }, expectedDispatchDate: { not: null } },
        select: { expectedDispatchDate: true },
        orderBy: { expectedDispatchDate: 'asc' },
        take: 1,
      });
      await tx.manufacturingDemand.update({
        where: { id: demandId },
        data: { requiredByDate: orders[0]?.expectedDispatchDate ?? null },
      });
    }
  }
}

function assertSaneDate(date: string) {
  const today = istToday();
  if (!isValidYmd(date) || date < '2020-01-01' || date > addDays(today, 730)) {
    throw new BadRequestException({ code: 'INVALID_DISPATCH_DATE', message: 'Use a real date within the next two years.' });
  }
}

function requireReason(reason: string | null | undefined, message: string) {
  if (!reason || reason.trim().length < 3) {
    throw new BadRequestException({ code: 'REASON_REQUIRED', message });
  }
}
