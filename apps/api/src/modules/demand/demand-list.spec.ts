import { DemandService } from './demand.service';

function setup() {
  const prisma = {
    manufacturingDemand: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  return { service: new DemandService(prisma as never, {} as never), prisma };
}

describe('demand list filters and sorting', () => {
  it('keeps the default: soonest required first, undated last', async () => {
    const { service, prisma } = setup();
    await service.list('org', {});
    expect(prisma.manufacturingDemand.findMany.mock.calls[0][0].orderBy)
      .toEqual([{ requiredByDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]);
  });

  it('searches, filters unmapped, and sorts by a chosen column', async () => {
    const { service, prisma } = setup();
    await service.list('org', { search: 'KRT', mapped: false, priority: 'HIGH', sortBy: 'manufacturingQty', sortDir: 'desc' });
    const { where, orderBy } = prisma.manufacturingDemand.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ organizationId: 'org', priority: 'HIGH', productVariantId: null });
    expect(where.OR).toHaveLength(4);
    expect(orderBy).toEqual([{ manufacturingQty: 'desc' }, { id: 'desc' }]);
  });
});
