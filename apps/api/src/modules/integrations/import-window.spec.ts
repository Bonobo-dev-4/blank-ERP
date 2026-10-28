import { ShopifyService } from './shopify.service';

function setup(pages: { hasNextPage: boolean; endCursor: string | null }[]) {
  let call = 0;
  const client = {
    query: jest.fn(async (_q: string, _v: { query: string | null; after: string | null }) => ({ orders: { pageInfo: pages[call++] ?? { hasNextPage: false, endCursor: null }, edges: [] } })),
    crmConfig: () => ({ dispatchMetafield: null, priorityMetafield: null, priorityTagMap: new Map() }),
    throttleState: () => null,
  };
  const prisma = { shopifyOrder: { findFirst: jest.fn(async () => ({ externalUpdatedAt: new Date('2026-10-13T00:00:00Z') })) } };
  const service = new ShopifyService(prisma as never, client as never, { record: jest.fn() } as never);
  return { service, client, prisma };
}

describe('importing orders by placed date', () => {
  it('filters on the placed date in India and ignores the incremental cursor', async () => {
    const s = setup([{ hasNextPage: false, endCursor: 'c1' }]);
    const r = await s.service.importOrders('org', 'u', { placedFrom: '2026-08-01' });
    expect(s.client.query.mock.calls[0][1]).toMatchObject({ query: "created_at:>='2026-08-01T00:00:00+05:30'", after: null });
    expect(s.prisma.shopifyOrder.findFirst).not.toHaveBeenCalled();
    expect(r).toMatchObject({ hasMore: false, after: null, placedFrom: '2026-08-01' });
  });

  it('says where to carry on when it stops at the page limit, and carries on from there', async () => {
    const s = setup([{ hasNextPage: true, endCursor: 'c1' }, { hasNextPage: true, endCursor: 'c2' }]);
    const r = await s.service.importOrders('org', 'u', { placedFrom: '2026-08-01', maxPages: 2 });
    expect(r).toMatchObject({ hasMore: true, after: 'c2', pages: 2 });
    await s.service.importOrders('org', 'u', { placedFrom: '2026-08-01', after: 'c2' });
    expect(s.client.query.mock.calls[2][1]).toMatchObject({ after: 'c2' });
  });

  it('still imports incrementally when no date is given', async () => {
    const s = setup([{ hasNextPage: false, endCursor: null }]);
    await s.service.importOrders('org', 'u', {});
    expect(s.client.query.mock.calls[0]![1].query).toBe("updated_at:>'2026-10-13T00:00:00.000Z'");
  });
});
