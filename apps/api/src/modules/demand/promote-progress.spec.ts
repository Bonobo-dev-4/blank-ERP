import { Prisma } from '@prisma/client';
import { DemandService } from './demand.service';

const q = (n: number) => new Prisma.Decimal(n);

function setup(promoted: { sourceDocId: string; sourceLineId: string; sourceLineQty: Prisma.Decimal }[]) {
  const owing = [
    { id: 'o1', lines: [{ id: 'l1', manufacturingQty: q(1) }] },             // promoted, unchanged
    { id: 'o2', lines: [{ id: 'l2', manufacturingQty: q(2) }] },             // promoted, qty changed
    { id: 'o3', lines: [{ id: 'l3', manufacturingQty: q(1) }] },             // never promoted
  ];
  const prisma = {
    shopifyOrder: {
      findMany: jest.fn()
        .mockResolvedValueOnce(owing)
        // The orders actually worked on: lines owe nothing here, so the test
        // stays on the selection rather than the demand-writing loop.
        .mockImplementationOnce(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, orderNumber: id, orderName: id, channel: 'ONLINE', orderedAt: new Date(), expectedDispatchDate: null, isCustomised: false, lines: [] }))),
    },
    demandSourceMapping: { findMany: jest.fn().mockResolvedValue(promoted) },
  };
  const idempotency = { execute: jest.fn(async (_o: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result) };
  return { service: new DemandService(prisma as never, idempotency as never), prisma };
}

describe('promoting orders to demand moves forward', () => {
  it('skips orders already promoted with the same quantity, and says how many remain', async () => {
    const s = setup([
      { sourceDocId: 'o1', sourceLineId: 'l1', sourceLineQty: q(1) },
      { sourceDocId: 'o2', sourceLineId: 'l2', sourceLineQty: q(1) },
    ]);
    const r = (await s.service.promoteShopifyOrders('org', { idempotencyKey: 'k-000000001', limit: 1 })) as unknown as { remaining: number; ordersScanned: number };
    const worked = s.prisma.shopifyOrder.findMany.mock.calls[1][0].where.id.in;
    expect(worked).toEqual(['o2']);
    expect(r).toMatchObject({ ordersScanned: 1, remaining: 1 });
  });

  it('reports up to date when everything owed is already demand', async () => {
    const s = setup([
      { sourceDocId: 'o1', sourceLineId: 'l1', sourceLineQty: q(1) },
      { sourceDocId: 'o2', sourceLineId: 'l2', sourceLineQty: q(2) },
      { sourceDocId: 'o3', sourceLineId: 'l3', sourceLineQty: q(1) },
    ]);
    const r = await s.service.promoteShopifyOrders('org', { idempotencyKey: 'k-000000002' });
    expect(r).toMatchObject({ upToDate: true, remaining: 0, ordersScanned: 0 });
  });
});
