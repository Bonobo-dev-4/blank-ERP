import { shopifyOrderListQuery } from '@dnd/contracts';
import { ShopifyService } from './shopify.service';

function setup() {
  const prisma = {
    shopifyOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new ShopifyService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe('order list filters and sorting', () => {
  it('puts VIP first, then the earliest promised dispatch, then newest, by default', async () => {
    const { service, prisma } = setup();
    await service.listOrders('org', shopifyOrderListQuery.parse({}));
    const args = prisma.shopifyOrder.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { orderPriority: 'asc' }, { expectedDispatchDate: { sort: 'asc', nulls: 'last' } }, { orderedAt: 'desc' }, { id: 'desc' },
    ]);
  });

  it('sorts by priority or dispatch date on request', async () => {
    const { service, prisma } = setup();
    await service.listOrders('org', shopifyOrderListQuery.parse({ sortBy: 'expectedDispatchDate', sortDir: 'desc' }));
    expect(prisma.shopifyOrder.findMany.mock.calls[0][0].orderBy[0]).toEqual({ expectedDispatchDate: { sort: 'desc', nulls: 'last' } });
    await service.listOrders('org', shopifyOrderListQuery.parse({ sortBy: 'orderPriority', sortDir: 'asc' }));
    expect(prisma.shopifyOrder.findMany.mock.calls[1][0].orderBy.slice(0, 2))
      .toEqual([{ orderPriority: 'asc' }, { expectedDispatchDate: { sort: 'asc', nulls: 'last' } }]);
  });

  it('applies every filter to the query, and counts with the same filter', async () => {
    const { service, prisma } = setup();
    await service.listOrders('org', shopifyOrderListQuery.parse({
      channel: 'POS', status: 'OPEN', shipmentStatus: 'PROCESSING', location: 'DLF Avenue',
      from: '2026-10-01', to: '2026-10-07', customised: 'true', unmapped: 'true', search: '#1684',
      sortBy: 'totalAmount', sortDir: 'asc',
    }));
    const { where, orderBy } = prisma.shopifyOrder.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      organizationId: 'org', channel: 'POS', status: 'OPEN', externalShipmentStatus: 'PROCESSING',
      posLocationName: 'DLF Avenue', isCustomised: true, lines: { some: { productVariantId: null } },
    });
    // Calendar dates are whole IST days, inclusive.
    expect(where.orderedAt.gte.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(where.orderedAt.lte.toISOString()).toBe('2026-10-07T18:29:59.999Z');
    expect(where.OR).toHaveLength(3);
    expect(orderBy[0]).toEqual({ totalAmount: { sort: 'asc', nulls: 'last' } });
    expect(prisma.shopifyOrder.count.mock.calls[0][0].where).toEqual(where);
  });

  it('treats "NONE" shipping as orders Unicommerce has not reported on', async () => {
    const { service, prisma } = setup();
    await service.listOrders('org', shopifyOrderListQuery.parse({ shipmentStatus: 'NONE' }));
    expect(prisma.shopifyOrder.findMany.mock.calls[0][0].where.externalShipmentStatus).toBeNull();
  });

  it('refuses sort columns outside the whitelist and malformed dates', () => {
    expect(shopifyOrderListQuery.safeParse({ sortBy: 'customerEmail' }).success).toBe(false);
    expect(shopifyOrderListQuery.safeParse({ from: '01/10/2026' }).success).toBe(false);
  });

  describe('CRM filters, in Asia/Kolkata', () => {
    // 28 Oct 2026, 00:30 in India — still 27 Oct in UTC.
    const NOW = new Date('2026-10-27T19:00:00Z');
    const day = (d: string) => new Date(`${d}T00:00:00Z`);

    it('filters by priority', async () => {
      const { service, prisma } = setup();
      await service.listOrders('org', shopifyOrderListQuery.parse({ priority: 'VIP' }), undefined, NOW);
      expect(prisma.shopifyOrder.findMany.mock.calls[0][0].where.orderPriority).toBe('VIP');
    });

    it('reads "today" as the Indian date', async () => {
      const { service, prisma } = setup();
      await service.listOrders('org', shopifyOrderListQuery.parse({ dispatch: 'TODAY' }), undefined, NOW);
      expect(prisma.shopifyOrder.findMany.mock.calls[0][0].where.expectedDispatchDate)
        .toEqual({ gte: day('2026-10-28'), lte: day('2026-10-28') });
    });

    it('counts as overdue only past promises on orders still waiting to leave', async () => {
      const { service, prisma } = setup();
      await service.listOrders('org', shopifyOrderListQuery.parse({ dispatch: 'OVERDUE' }), undefined, NOW);
      const { where } = prisma.shopifyOrder.findMany.mock.calls[0][0];
      expect(where.expectedDispatchDate).toEqual({ lt: day('2026-10-28') });
      expect(where.AND).toEqual([
        { status: { in: ['OPEN', 'PARTIALLY_FULFILLED'] } },
        { OR: [{ externalShipmentStatus: null }, { externalShipmentStatus: { notIn: ['COMPLETE', 'CANCELLED'] } }] },
      ]);
    });

    it('finds orders with no date, and custom ranges', async () => {
      const { service, prisma } = setup();
      await service.listOrders('org', shopifyOrderListQuery.parse({ dispatch: 'NONE' }), undefined, NOW);
      expect(prisma.shopifyOrder.findMany.mock.calls[0][0].where.expectedDispatchDate).toBeNull();
      await service.listOrders('org', shopifyOrderListQuery.parse({ dispatch: 'CUSTOM', dispatchFrom: '2026-11-01', dispatchTo: '2026-11-07' }), undefined, NOW);
      expect(prisma.shopifyOrder.findMany.mock.calls[1][0].where.expectedDispatchDate)
        .toEqual({ gte: day('2026-11-01'), lte: day('2026-11-07') });
    });

    it('combines priority, dispatch, channel and search, and counts with the same filter', async () => {
      const { service, prisma } = setup();
      await service.listOrders('org', shopifyOrderListQuery.parse({
        priority: 'HIGH', dispatch: 'NEXT_7_DAYS', channel: 'POS', search: 'Asha',
      }), undefined, NOW);
      const { where } = prisma.shopifyOrder.findMany.mock.calls[0][0];
      expect(where).toMatchObject({
        orderPriority: 'HIGH', channel: 'POS',
        expectedDispatchDate: { gte: day('2026-10-28'), lte: day('2026-11-03') },
      });
      expect(where.OR).toHaveLength(3);
      expect(prisma.shopifyOrder.count.mock.calls[0][0].where).toEqual(where);
    });

    it('refuses unknown priorities and presets', () => {
      expect(shopifyOrderListQuery.safeParse({ priority: 'URGENT' }).success).toBe(false);
      expect(shopifyOrderListQuery.safeParse({ dispatch: 'YESTERDAY' }).success).toBe(false);
    });
  });
});
