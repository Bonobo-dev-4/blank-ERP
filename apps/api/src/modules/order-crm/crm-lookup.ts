import type { Prisma, PrismaClient } from '@prisma/client';
import {
  dispatchState, higherPriority, isDispatchSettled, istToday,
  type DispatchState, type OrderPriority,
} from '@dnd/domain';

type Db = PrismaClient | Prisma.TransactionClient;

export interface DemandCrm {
  readonly priority: OrderPriority;
  /** Earliest dispatch date promised on any order still waiting for this demand. */
  readonly dispatchDate: string | null;
  readonly dispatchState: DispatchState;
  readonly orderCount: number;
}

/**
 * The CRM view of manufacturing demand: the most urgent priority and the
 * earliest open dispatch promise among the orders it serves. Read-only — it
 * informs production; it never reorders or changes it.
 */
export async function crmForDemands(db: Db, organizationId: string, demandIds: readonly string[]): Promise<Map<string, DemandCrm>> {
  const out = new Map<string, DemandCrm>();
  if (demandIds.length === 0) return out;
  const maps = await db.demandSourceMapping.findMany({
    where: { organizationId, manufacturingDemandId: { in: [...demandIds] }, sourceSystem: 'SHOPIFY', sourceDocType: 'ORDER' },
    select: { manufacturingDemandId: true, sourceDocId: true },
  });
  const orders = await db.shopifyOrder.findMany({
    where: { organizationId, id: { in: [...new Set(maps.map((m) => m.sourceDocId))] } },
    select: { id: true, orderPriority: true, expectedDispatchDate: true, status: true, externalShipmentStatus: true },
  });
  const byId = new Map(orders.map((o) => [o.id, o] as const));
  const today = istToday();

  for (const demandId of new Set(maps.map((m) => m.manufacturingDemandId))) {
    const mine = maps.filter((m) => m.manufacturingDemandId === demandId).map((m) => byId.get(m.sourceDocId)).filter((o) => o !== undefined);
    if (mine.length === 0) continue;
    const open = mine.filter((o) => !isDispatchSettled(o));
    const dated = (open.length ? open : mine)
      .map((o) => o.expectedDispatchDate?.toISOString().slice(0, 10) ?? null)
      .filter((d): d is string => d !== null)
      .sort();
    const date = dated[0] ?? null;
    out.set(demandId, {
      priority: mine.map((o) => o.orderPriority as OrderPriority).reduce((a, b) => higherPriority(a, b)),
      dispatchDate: date,
      dispatchState: dispatchState(date, today, open.length === 0),
      orderCount: mine.length,
    });
  }
  return out;
}

/** Demand ids served by at least one order of this priority. */
export async function demandIdsWithOrderPriority(db: Db, organizationId: string, priority: OrderPriority): Promise<string[]> {
  const orders = await db.shopifyOrder.findMany({ where: { organizationId, orderPriority: priority }, select: { id: true } });
  if (orders.length === 0) return [];
  const maps = await db.demandSourceMapping.findMany({
    where: { organizationId, sourceSystem: 'SHOPIFY', sourceDocType: 'ORDER', sourceDocId: { in: orders.map((o) => o.id) } },
    select: { manufacturingDemandId: true },
  });
  return [...new Set(maps.map((m) => m.manufacturingDemandId))];
}

/** The same view for manufacturing orders, across every demand they make. */
export async function crmForManufacturingOrders(db: Db, organizationId: string, moIds: readonly string[]): Promise<Map<string, DemandCrm>> {
  const out = new Map<string, DemandCrm>();
  if (moIds.length === 0) return out;
  const allocations = await db.demandAllocation.findMany({
    where: { organizationId, manufacturingOrderId: { in: [...moIds] } },
    select: { manufacturingOrderId: true, manufacturingDemandId: true },
  });
  const demandCrm = await crmForDemands(db, organizationId, [...new Set(allocations.map((a) => a.manufacturingDemandId))]);
  const today = istToday();
  for (const moId of moIds) {
    const crms = allocations
      .filter((a) => a.manufacturingOrderId === moId)
      .map((a) => demandCrm.get(a.manufacturingDemandId))
      .filter((c): c is DemandCrm => c !== undefined);
    if (crms.length === 0) continue;
    const open = crms.filter((c) => c.dispatchState !== 'SETTLED');
    const date = (open.length ? open : crms).map((c) => c.dispatchDate).filter((d): d is string => d !== null).sort()[0] ?? null;
    out.set(moId, {
      priority: crms.map((c) => c.priority).reduce((a, b) => higherPriority(a, b)),
      dispatchDate: date,
      dispatchState: dispatchState(date, today, open.length === 0),
      orderCount: crms.reduce((n, c) => n + c.orderCount, 0),
    });
  }
  return out;
}

/** Manufacturing orders making demand for at least one order of this priority. */
export async function moIdsWithOrderPriority(db: Db, organizationId: string, priority: OrderPriority): Promise<string[]> {
  const demandIds = await demandIdsWithOrderPriority(db, organizationId, priority);
  if (demandIds.length === 0) return [];
  const allocations = await db.demandAllocation.findMany({
    where: { organizationId, manufacturingDemandId: { in: demandIds } },
    select: { manufacturingOrderId: true },
  });
  return [...new Set(allocations.map((a) => a.manufacturingOrderId))];
}
