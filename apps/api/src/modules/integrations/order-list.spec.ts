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
  it('sorts newest first by default, with a stable tie-break', async () => {
    const { service, prisma } = setup();
    await service.listOrders('org', shopifyOrderListQuery.parse({}));
    const args = prisma.shopifyOrder.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ orderedAt: 'desc' }, { id: 'desc' }]);
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
});
