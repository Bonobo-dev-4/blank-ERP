import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Decimal, dec, routeDemandLine, tallyRoutes,
  type FulfilmentRoute, type RouteDecision,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { crmForDemands } from '../order-crm/crm-lookup';
import { UnicommerceClient, UC_PATHS } from '../integrations/unicommerce.client';
import { SUPPLIED_FACILITY_CODES } from '../integrations/unicommerce.service';

interface SnapshotRow {
  itemTypeSKU: string;
  inventory: number;
  openSale?: number;
}

/**
 * Where each line of demand should be fulfilled from.
 *
 * The expensive part is asking Unicommerce, so the shape of that question
 * matters: `inventorySnapshot/get` accepts an ARRAY of SKUs, which makes this
 * one call PER FACILITY rather than one per SKU per facility. For 150 lines
 * across 17 facilities that is 17 calls instead of 2,550 — the difference
 * between a screen that loads and one nobody waits for.
 */
@Injectable()
export class FulfilmentService {
  private readonly logger = new Logger(FulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UnicommerceClient,
  ) {}

  /**
   * Read stock for many SKUs at one facility.
   *
   * A SKU the facility does not stock is simply absent from the response —
   * that is an answer ("none here"), not a failure. A facility that cannot be
   * read at all returns null, which is a different thing and must stay
   * different: see the routing rule about incomplete searches.
   */
  private async stockAt(
    facilityCode: string,
    skus: string[],
  ): Promise<Map<string, Decimal> | null> {
    if (skus.length === 0) return new Map();
    const result = await this.client.probe(
      UC_PATHS.inventorySnapshot,
      { itemTypeSKUs: skus },
      facilityCode,
    );

    if (!result.ok) {
      const code = result.body?.errors?.[0]?.message ?? '';
      // Definitive "none of these are stocked here" - the facility answered.
      if (code === 'INVENTORY_NOT_AVAILABLE') return new Map();
      return null;
    }

    const snapshots = ((result.body as { inventorySnapshots?: SnapshotRow[] }).inventorySnapshots) ?? [];
    const map = new Map<string, Decimal>();
    for (const s of snapshots) {
      // Free to promise = on hand less what is already committed to orders.
      const free = Decimal.max(dec(String(s.inventory ?? 0)).minus(dec(String(s.openSale ?? 0))), 0);
      map.set(s.itemTypeSKU, free);
    }
    // A SKU asked for but not returned is stocked at zero here.
    for (const sku of skus) if (!map.has(sku)) map.set(sku, new Decimal(0));
    return map;
  }

  /**
   * Route every open demand line.
   *
   * `facilities` defaults to every configured one. Narrow it to go faster when
   * only the home facility matters — but a narrowed search is an INCOMPLETE
   * search, and the result says so, which stops a caller concluding
   * "manufacture" from a question it never asked.
   */
  async board(
    organizationId: string,
    options: { facilities?: readonly string[]; limit?: number; skipStockCheck?: boolean } = {},
  ) {
    const limit = Math.min(500, Math.max(1, options.limit ?? 200));
    const config = this.client.describe();
    const home = config.defaultFacility;

    const demands = await this.prisma.manufacturingDemand.findMany({
      where: {
        organizationId,
        status: { notIn: ['CANCELLED', 'NOT_REQUIRED', 'FULLY_ALLOCATED'] },
      },
      select: {
        id: true, demandNo: true, channel: true, externalSku: true,
        manufacturingQty: true, allocatedQty: true, status: true, priority: true,
        requiredByDate: true, isRejectedForDispatch: true, rejectedReason: true,
        routedFacilityCode: true, createdAt: true,
        productVariant: {
          select: { id: true, sku: true, size: true, color: true, product: { select: { name: true } } },
        },
        sourceMappings: {
          select: { sourceDocNo: true, sourceSystem: true, sourceDocType: true, sourceDocId: true, sourceLineId: true },
          orderBy: { isPrimary: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ requiredByDate: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });

    if (demands.length === 0) {
      return {
        home, stockChecked: false, facilitiesChecked: [], facilitiesUnreadable: [],
        tally: { dispatch: 0, switchFacility: 0, manufacture: 0, needsCheck: 0 },
        lines: [],
      };
    }

    const skus = [...new Set(
      demands.map((d) => d.productVariant?.sku ?? d.externalSku).filter((s): s is string => !!s),
    )];

    const facilities = options.facilities?.length
      ? [...options.facilities]
      : [...SUPPLIED_FACILITY_CODES];

    const stockByFacility = new Map<string, Map<string, Decimal>>();
    const unreadable: string[] = [];
    let stockChecked = false;

    if (!options.skipStockCheck && config.isConfigured && config.enabled) {
      stockChecked = true;
      for (const facility of facilities) {
        try {
          const map = await this.stockAt(facility, skus);
          if (map) stockByFacility.set(facility, map);
          else unreadable.push(facility);
        } catch {
          unreadable.push(facility);
        }
      }
    }

    // A search is complete only when the home facility answered AND nothing
    // was skipped. Anything less and "not found" cannot mean "does not exist".
    const isSearchComplete =
      stockChecked
      && unreadable.length === 0
      && stockByFacility.has(home)
      && !options.facilities;

    const crm = await crmForDemands(this.prisma, organizationId, demands.map((d) => d.id));
    const lines = demands.map((d) => {
      const sku = d.productVariant?.sku ?? d.externalSku ?? '';
      const open = Decimal.max(
        dec(d.manufacturingQty.toFixed()).minus(dec(d.allocatedQty.toFixed())),
        0,
      );

      const homeQty = stockByFacility.get(home)?.get(sku) ?? new Decimal(0);
      const others = [...stockByFacility.entries()]
        .filter(([code]) => code !== home)
        .map(([code, m]) => ({ facilityCode: code, availableQty: m.get(sku) ?? new Decimal(0) }))
        .filter((f) => f.availableQty.greaterThan(0));

      const decision: RouteDecision = routeDemandLine({
        demandQty: open,
        homeFacilityCode: home,
        homeAvailableQty: homeQty,
        otherFacilities: others,
        isSearchComplete,
        isRejectedForDispatch: d.isRejectedForDispatch,
      });

      return {
        demandId: d.id,
        demandNo: d.demandNo,
        orderRef: d.sourceMappings[0]?.sourceDocNo ?? null,
        ...shopifySource(d.sourceMappings[0]),
        crm: crm.get(d.id) ?? null,
        channel: d.channel,
        sku,
        productName: d.productVariant?.product?.name ?? null,
        size: d.productVariant?.size ?? null,
        color: d.productVariant?.color ?? null,
        isMapped: d.productVariant !== null,
        status: d.status,
        priority: d.priority,
        requiredByDate: d.requiredByDate?.toISOString() ?? null,
        openQty: open.toFixed(),
        route: decision.route,
        dispatchQty: decision.dispatchQty.toFixed(),
        switchQty: decision.switchQty.toFixed(),
        manufactureQty: decision.manufactureQty.toFixed(),
        switchFromFacility: decision.switchFromFacility,
        reason: decision.reason,
        isProvisional: decision.isProvisional,
        isRejectedForDispatch: d.isRejectedForDispatch,
        rejectedReason: d.rejectedReason,
        homeAvailableQty: homeQty.toFixed(),
      };
    });

    return {
      home,
      stockChecked,
      facilitiesChecked: [...stockByFacility.keys()],
      facilitiesUnreadable: unreadable,
      isSearchComplete,
      tally: tallyRoutes(lines.map((l) => ({
        route: l.route as FulfilmentRoute,
        dispatchQty: dec(l.dispatchQty),
        switchQty: dec(l.switchQty),
        manufactureQty: dec(l.manufactureQty),
        switchFromFacility: l.switchFromFacility,
        reason: l.reason,
        isProvisional: l.isProvisional,
      }))),
      lines,
    };
  }

  /**
   * Send a dispatchable line to production anyway.
   *
   * The operator is holding the garment and knows something the stock figure
   * does not — the shade is off, it is damaged, the customer wants it altered.
   * Routing honours this above everything else, so the reason is required: a
   * rejection with no reason is indistinguishable from a misclick, and this
   * one costs weeks of production.
   */
  async reject(organizationId: string, actorUserId: string, demandId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Say why this cannot be dispatched. It overrides available stock.',
      });
    }
    const demand = await this.prisma.manufacturingDemand.findFirst({
      where: { id: demandId, organizationId },
      select: { id: true, demandNo: true },
    });
    if (!demand) {
      throw new NotFoundException({ code: 'DEMAND_NOT_FOUND', message: 'Demand line not found' });
    }

    await this.prisma.manufacturingDemand.update({
      where: { id: demandId },
      data: {
        isRejectedForDispatch: true,
        rejectedReason: reason.trim(),
        rejectedByUserId: actorUserId,
        rejectedAt: new Date(),
      },
    });

    this.logger.log(`${demand.demandNo} rejected for dispatch: ${reason.trim()}`);
    return { demandId, demandNo: demand.demandNo, isRejectedForDispatch: true };
  }

  /** Undo a rejection, putting the line back under the stock arithmetic. */
  async unreject(organizationId: string, demandId: string) {
    const demand = await this.prisma.manufacturingDemand.findFirst({
      where: { id: demandId, organizationId },
      select: { id: true, demandNo: true },
    });
    if (!demand) {
      throw new NotFoundException({ code: 'DEMAND_NOT_FOUND', message: 'Demand line not found' });
    }
    await this.prisma.manufacturingDemand.update({
      where: { id: demandId },
      data: {
        isRejectedForDispatch: false, rejectedReason: null,
        rejectedByUserId: null, rejectedAt: null,
      },
    });
    return { demandId, demandNo: demand.demandNo, isRejectedForDispatch: false };
  }
}

/** The ERP order and line behind a demand, when it came from a Shopify order. */
export function shopifySource(m: { sourceSystem: string; sourceDocType: string; sourceDocId: string; sourceLineId: string } | undefined) {
  return m && m.sourceSystem === 'SHOPIFY' && m.sourceDocType === 'ORDER'
    ? { orderId: m.sourceDocId, orderLineId: m.sourceLineId }
    : { orderId: null, orderLineId: null };
}
