import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type DemandChannel as DbDemandChannel,
  type ExternalOrderStatus as DbExternalOrderStatus,
} from '@prisma/client';
import {
  classifyShopifyOrder, isStaleOrderVersion, shopifyLineQuantities, qty,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { paginated } from '../../common/pagination';
import { ShopifyClient } from './shopify.client';

/** Shop identity plus the facts that are store-specific and must be probed. */
const SHOP_QUERY = `
  query VerifyConnection {
    shop {
      name
      myshopifyDomain
      primaryDomain { host }
      currencyCode
      ianaTimezone
      plan { displayName partnerDevelopment shopifyPlus }
    }
  }
`;

/** A deliberately tiny probe: does this token actually read orders? */
const ORDER_PROBE_QUERY = `
  query ProbeOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          sourceName
          createdAt
          retailLocation { id name }
          tags
        }
      }
    }
  }
`;

const ORDERS_QUERY = `
  query ImportOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          cancelledAt
          processedAt
          sourceName
          note
          tags
          displayFinancialStatus
          displayFulfillmentStatus
          currencyCode
          retailLocation { id name }
          customer { id displayName }
          currentTotalPriceSet { shopMoney { amount } }
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                sku
                quantity
                currentQuantity
                unfulfilledQuantity
                variant { id sku title }
              }
            }
          }
        }
      }
    }
  }
`;

interface ShopNode {
  name: string; myshopifyDomain: string;
  primaryDomain: { host: string } | null;
  currencyCode: string; ianaTimezone: string;
  plan: { displayName: string; partnerDevelopment: boolean; shopifyPlus: boolean };
}

interface OrderNode {
  id: string; name: string; createdAt: string; updatedAt: string;
  cancelledAt: string | null; processedAt: string | null;
  sourceName: string | null; note: string | null; tags: string[];
  displayFinancialStatus: string | null; displayFulfillmentStatus: string | null;
  currencyCode: string | null;
  retailLocation: { id: string; name: string } | null;
  customer: { id: string; displayName: string } | null;
  currentTotalPriceSet: { shopMoney: { amount: string } } | null;
  lineItems: {
    edges: {
      node: {
        id: string; title: string; sku: string | null;
        quantity: number; currentQuantity: number; unfulfilledQuantity: number;
        variant: { id: string; sku: string | null; title: string | null } | null;
      };
    }[];
  };
}

/**
 * Shopify order import.
 *
 * **Read-only.** The transport refuses mutations outright, because the
 * specification forbids live external changes without explicit authorisation
 * and a structural guarantee beats a convention.
 *
 * The two decisions that actually matter — which channel an order came from,
 * and how many garments it demands — live in `@dnd/domain` where they are
 * tested without a network. This service moves data; it does not judge it.
 */
@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ShopifyClient,
    private readonly audit: AuditService,
  ) {}

  /** Configuration status, without ever revealing the token. */
  status() {
    return { ...this.client.describe(), throttle: this.client.throttleState() };
  }

  /**
   * Probe the live store.
   *
   * This answers the questions the schema cannot: which `sourceName` values
   * this shop emits, whether the token can actually read orders, whether it
   * can read beyond 60 days, and what the plan's rate budget is. Read-only,
   * and safe to run as often as you like.
   */
  async verify(organizationId: string, actorUserId: string) {
    const described = this.client.describe();
    if (!described.isConfigured) {
      return {
        ok: false,
        configured: false,
        missing: described.missing,
        message: `Shopify is not configured. Set ${described.missing.join(', ')} in the environment.`,
        checks: [],
      };
    }

    const checks: { name: string; ok: boolean; detail: string }[] = [];
    let shop: ShopNode | null = null;

    try {
      const data = await this.client.query<{ shop: ShopNode }>(SHOP_QUERY, {}, { estimatedCost: 5 });
      shop = data.shop;
      checks.push({
        name: 'Authentication',
        ok: true,
        detail: `Connected to ${shop.name} (${shop.myshopifyDomain}), ${shop.plan.displayName} plan`,
      });

      // The plan sets the cost budget, which sets how fast an import can run.
      const budget = shop.plan.shopifyPlus ? 1000 : 100;
      checks.push({
        name: 'Rate budget',
        ok: true,
        detail: `${shop.plan.displayName}: roughly ${budget} cost points/second. Import paces against the cost each response reports.`,
      });

      if (described.shopDomain.toLowerCase() !== shop.myshopifyDomain.toLowerCase()) {
        // Pointing at the wrong store is the one misconfiguration that looks
        // like it is working.
        checks.push({
          name: 'Shop identity',
          ok: false,
          detail: `Configured ${described.shopDomain} but the token belongs to ${shop.myshopifyDomain}.`,
        });
      }
    } catch (error) {
      checks.push({ name: 'Authentication', ok: false, detail: errorText(error) });
      return {
        ok: false, configured: true, shop: null, checks,
        sourceNames: [], retailLocations: [], tagsOnRetailOrders: [], message: null,
      };
    }

    // Can it read orders at all? A missing scope shows up here, not at login.
    let sourceNames: { value: string; count: number; classifiedAs: string }[] = [];
    let retailLocations: { name: string; count: number }[] = [];
    let tagsOnRetailOrders: { tag: string; count: number }[] = [];
    try {
      const probe = await this.client.query<{ orders: { edges: { node: OrderNode }[] } }>(
        ORDER_PROBE_QUERY,
        { first: 50, query: null },
        { estimatedCost: 60 },
      );
      const nodes = probe.orders.edges.map((e) => e.node);
      checks.push({
        name: 'Order read access',
        ok: true,
        detail: `Read ${nodes.length} recent order(s).`,
      });

      // THE thing the schema could not tell us: what this shop actually emits.
      // Reported as a CROSS-TAB, not one label per source: a single source can
      // classify several ways, and collapsing that to the last one seen hides
      // exactly the disagreements worth looking at.
      const tally = new Map<string, Map<string, number>>();
      const tagsOnRetail = new Map<string, number>();
      const retailStores = new Map<string, number>();

      for (const n of nodes) {
        const key = n.sourceName ?? '(null)';
        const classification = classifyShopifyOrder({
          retailLocationId: n.retailLocation?.id ?? null,
          retailLocationName: n.retailLocation?.name ?? null,
          sourceName: n.sourceName,
          tags: n.tags,
        });
        const byChannel = tally.get(key) ?? new Map<string, number>();
        byChannel.set(classification.channel, (byChannel.get(classification.channel) ?? 0) + 1);
        tally.set(key, byChannel);

        if (n.retailLocation) {
          retailStores.set(n.retailLocation.name, (retailStores.get(n.retailLocation.name) ?? 0) + 1);
          // Tags on retail orders are what can override a POS classification,
          // so they are surfaced to make a collision visible.
          for (const tag of n.tags ?? []) {
            tagsOnRetail.set(tag, (tagsOnRetail.get(tag) ?? 0) + 1);
          }
        }
      }

      sourceNames = [...tally.entries()]
        .map(([value, byChannel]) => ({
          value,
          count: [...byChannel.values()].reduce((a, b) => a + b, 0),
          classifiedAs: [...byChannel.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([channel, n]) => `${channel}×${n}`)
            .join(', '),
        }))
        .sort((a, b) => b.count - a.count);

      retailLocations = [...retailStores.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      tagsOnRetailOrders = [...tagsOnRetail.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);

      const withRetail = nodes.filter((n) => n.retailLocation).length;
      checks.push({
        name: 'POS discriminator',
        ok: true,
        detail:
          withRetail > 0
            ? `${withRetail} of ${nodes.length} recent orders carry a retailLocation, so POS orders are identifiable by store.`
            : `No recent order carries a retailLocation. Either this shop has no POS orders, or read_locations is not granted.`,
      });
    } catch (error) {
      checks.push({ name: 'Order read access', ok: false, detail: errorText(error) });
    }

    // Reading beyond 60 days needs read_all_orders on most apps.
    try {
      const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const res = await this.client.query<{ orders: { edges: { node: OrderNode }[] } }>(
        ORDER_PROBE_QUERY,
        { first: 1, query: `created_at:<${old}` },
        { estimatedCost: 10 },
      );
      checks.push({
        name: 'Historical orders',
        ok: true,
        detail:
          res.orders.edges.length > 0
            ? 'Orders older than 90 days are readable, so read_all_orders is granted.'
            : 'No orders older than 90 days were returned. Either the shop has none, or read_all_orders is not granted — this is not distinguishable from here.',
      });
    } catch (error) {
      checks.push({
        name: 'Historical orders',
        ok: false,
        detail: `${errorText(error)} — this usually means read_all_orders is not granted.`,
      });
    }

    const ok = checks.every((c) => c.ok);

    await this.audit.record({
      organizationId, actorUserId, action: 'RUN',
      entityType: 'IntegrationConnection', entityId: organizationId,
      context: {
        provider: 'SHOPIFY',
        shopDomain: described.shopDomain,
        apiVersion: described.apiVersion,
        ok,
        failedChecks: checks.filter((c) => !c.ok).map((c) => c.name),
      },
    });

    return {
      ok,
      configured: true,
      shop: shop
        ? {
            name: shop.name,
            domain: shop.myshopifyDomain,
            plan: shop.plan.displayName,
            currency: shop.currencyCode,
            timezone: shop.ianaTimezone,
          }
        : null,
      apiVersion: described.apiVersion,
      checks,
      /** What this shop actually emits, and how the classifier reads it. */
      sourceNames,
      /** Which shops POS orders came from, by name. */
      retailLocations,
      /**
       * Tags present on retail orders. A tag here that the classifier treats
       * as "bespoke" will override the POS classification, so this is where a
       * collision becomes visible.
       */
      tagsOnRetailOrders,
      message: null,
    };
  }

  /**
   * Import orders updated since a cursor.
   *
   * Incremental by `updatedAt`, with `ShopifyOrder.externalUpdatedAt` as the
   * stale-write guard — Shopify delivers updates out of order often enough
   * that an older version overwriting a newer one would silently resurrect
   * cancelled lines.
   */
  async importOrders(
    organizationId: string,
    actorUserId: string,
    options: { since?: string | null; maxPages?: number; pageSize?: number } = {},
  ) {
    const pageSize = Math.min(options.pageSize ?? 50, 250);
    const maxPages = Math.min(options.maxPages ?? 10, 100);
    const since = options.since
      ? new Date(options.since)
      : await this.lastImportedAt(organizationId);

    const filter = since ? `updated_at:>'${since.toISOString()}'` : null;

    let cursor: string | null = null;
    let pages = 0;
    let imported = 0;
    let skippedStale = 0;
    let lineCount = 0;
    const unmappedSkus = new Set<string>();

    while (pages < maxPages) {
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: OrderNode }[] } } =
        await this.client.query(
          ORDERS_QUERY,
          { first: pageSize, after: cursor, query: filter },
          // Connection cost is sized by `first`, and each order pulls 100 lines.
          { estimatedCost: pageSize * 2 },
        );

      for (const edge of data.orders.edges) {
        const outcome = await this.upsertOrder(organizationId, edge.node, unmappedSkus);
        if (outcome === 'STALE') skippedStale += 1;
        else {
          imported += 1;
          lineCount += edge.node.lineItems.edges.length;
        }
      }

      pages += 1;
      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
      if (!cursor) break;
    }

    await this.audit.record({
      organizationId, actorUserId, action: 'RUN',
      entityType: 'ShopifyOrder', entityId: organizationId,
      context: {
        since: since?.toISOString() ?? null,
        pages, imported, skippedStale, lineCount,
        unmappedSkuCount: unmappedSkus.size,
      },
    });

    return {
      since: since?.toISOString() ?? null,
      pages,
      imported,
      skippedStale,
      lineCount,
      // A SKU with no mapping cannot become manufacturing demand, so it is
      // reported rather than quietly dropped.
      unmappedSkus: [...unmappedSkus].slice(0, 100),
      unmappedSkuCount: unmappedSkus.size,
      throttle: this.client.throttleState(),
    };
  }

  private async upsertOrder(
    organizationId: string,
    node: OrderNode,
    unmappedSkus: Set<string>,
  ): Promise<'IMPORTED' | 'STALE'> {
    const incomingUpdatedAt = node.updatedAt ? new Date(node.updatedAt) : null;

    const existing = await this.prisma.shopifyOrder.findUnique({
      where: { organizationId_externalId: { organizationId, externalId: node.id } },
      select: { id: true, externalUpdatedAt: true },
    });

    if (existing && isStaleOrderVersion(incomingUpdatedAt, existing.externalUpdatedAt)) {
      return 'STALE';
    }

    const classification = classifyShopifyOrder({
      retailLocationId: node.retailLocation?.id ?? null,
      retailLocationName: node.retailLocation?.name ?? null,
      sourceName: node.sourceName,
      tags: node.tags,
    });

    const cancelled = Boolean(node.cancelledAt);
    const status = cancelled
      ? 'CANCELLED'
      : node.displayFulfillmentStatus === 'FULFILLED'
        ? 'FULFILLED'
        : node.displayFulfillmentStatus === 'PARTIALLY_FULFILLED'
          ? 'PARTIALLY_FULFILLED'
          : 'OPEN';

    return this.prisma.inTransaction<'IMPORTED' | 'STALE'>(async (tx) => {
      const header = {
        organizationId,
        externalId: node.id,
        orderNumber: node.name.replace(/^#/, ''),
        orderName: node.name,
        channel: classification.channel as DbDemandChannel,
        channelBasis: classification.basis,
        isCustomised: classification.isCustomised,
        posLocationId: classification.posLocationId,
        posLocationName: classification.posLocationName,
        orderedAt: new Date(node.processedAt ?? node.createdAt),
        financialStatus: node.displayFinancialStatus,
        fulfillmentStatus: node.displayFulfillmentStatus,
        status: status as DbExternalOrderStatus,
        currency: node.currencyCode,
        totalAmount: node.currentTotalPriceSet
          ? new Prisma.Decimal(node.currentTotalPriceSet.shopMoney.amount)
          : null,
        customerRef: node.customer?.displayName ?? null,
        note: node.note,
        tags: node.tags,
        cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
        // Verbatim, so a classification can be re-derived later without
        // another API call.
        rawPayload: node as unknown as Prisma.InputJsonValue,
        externalUpdatedAt: incomingUpdatedAt,
      };

      const order = await tx.shopifyOrder.upsert({
        where: { organizationId_externalId: { organizationId, externalId: node.id } },
        create: header,
        update: header,
        select: { id: true },
      });

      for (const { node: line } of node.lineItems.edges) {
        const sku = line.sku ?? line.variant?.sku ?? null;
        const quantities = shopifyLineQuantities({
          quantity: line.quantity,
          currentQuantity: line.currentQuantity,
          unfulfilledQuantity: line.unfulfilledQuantity,
          orderCancelled: cancelled,
        });

        // Map to an internal SKU where one exists. Where it does not, the
        // line is still stored — it just cannot become demand yet.
        const mapping = sku
          ? await tx.productVariant.findFirst({
              where: { organizationId, sku },
              select: { id: true, size: true, color: true },
            })
          : null;
        if (sku && !mapping) unmappedSkus.add(sku);

        const lineData = {
          organizationId,
          shopifyOrderId: order.id,
          externalLineId: line.id,
          productVariantId: mapping?.id ?? null,
          externalSku: sku,
          externalVariantId: line.variant?.id ?? null,
          title: line.title,
          size: mapping?.size ?? null,
          color: mapping?.color ?? null,
          orderedQty: new Prisma.Decimal(quantities.orderedQty.toFixed(4)),
          cancelledQty: new Prisma.Decimal(quantities.cancelledQty.toFixed(4)),
          fulfilledQty: new Prisma.Decimal(quantities.fulfilledQty.toFixed(4)),
          refundedQty: new Prisma.Decimal(quantities.cancelledQty.toFixed(4)),
          // What production would be asked for, BEFORE stock is considered.
          // Availability is a separate step and deliberately not a reservation.
          manufacturingQty: new Prisma.Decimal(quantities.demandQty.toFixed(4)),
          rawPayload: line as unknown as Prisma.InputJsonValue,
        };

        await tx.shopifyOrderLine.upsert({
          where: { organizationId_externalLineId: { organizationId, externalLineId: line.id } },
          create: lineData,
          update: lineData,
        });
      }

      return 'IMPORTED';
    });
  }

  private async lastImportedAt(organizationId: string): Promise<Date | null> {
    const latest = await this.prisma.shopifyOrder.findFirst({
      where: { organizationId, externalUpdatedAt: { not: null } },
      orderBy: { externalUpdatedAt: 'desc' },
      select: { externalUpdatedAt: true },
    });
    return latest?.externalUpdatedAt ?? null;
  }

  async listOrders(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      channel?: string; status?: string;
    },
  ) {
    const where: Prisma.ShopifyOrderWhereInput = {
      organizationId,
      ...(query.channel ? { channel: query.channel as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? { OR: [{ orderName: { contains: query.search, mode: 'insensitive' } },
                 { customerRef: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.shopifyOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { orderedAt: 'desc' },
        include: {
          lines: {
            select: {
              id: true, externalSku: true, title: true, productVariantId: true,
              orderedQty: true, cancelledQty: true, fulfilledQty: true,
              manufacturingQty: true, availabilityStatus: true,
            },
          },
        },
      }),
      this.prisma.shopifyOrder.count({ where }),
    ]);

    return paginated(
      rows.map((o) => ({
        ...o,
        demandQty: o.lines
          .reduce((a, l) => a.plus(qty(l.manufacturingQty.toFixed())), qty('0'))
          .toFixed(4),
        unmappedLineCount: o.lines.filter((l) => !l.productVariantId).length,
      })),
      total,
      query,
    );
  }
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const r = (error as { response?: { message?: string } }).response;
    if (r?.message) return r.message;
  }
  return error instanceof Error ? error.message : String(error);
}
