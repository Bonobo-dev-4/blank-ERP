import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@dnd/contracts';
import { PERMISSIONS_KEY } from '../../common/auth/guards';
import { ShopifyService } from '../integrations/shopify.service';
import { verifyShopifyHmac } from '../integrations/shopify-webhook.controller';
import { createHmac } from 'node:crypto';
import { OrderCrmController } from './order-crm.controller';
import { OrderCrmService } from './order-crm.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORDER = '44444444-4444-4444-8444-444444444444';
const OTHER_ORDER = '55555555-5555-4555-8555-555555555555';
const user: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222', organizationId: ORG, email: 'crm@example.test',
  fullName: 'CRM', employeeCode: null, roles: ['CRM_EXECUTIVE'], permissions: ['demand.read', 'demand.manage_crm'],
};

/** An in-memory slice of the database: two orders sharing one demand. */
function setup(over: Record<string, unknown> = {}) {
  const orders: Record<string, Record<string, unknown>> = {
    [ORDER]: {
      id: ORDER, organizationId: ORG, status: 'OPEN', externalShipmentStatus: null,
      expectedDispatchDate: null, dispatchDateSource: 'UNASSIGNED', dispatchDateLocked: false,
      dispatchDateUpdatedById: null, dispatchDateUpdatedAt: null, dispatchDateOriginalValue: null,
      dispatchDateChangeReason: null, shopifyDispatchDate: null, shopifyDispatchSource: null,
      shopifyDispatchText: null, shopifyDispatchIssue: null, orderPriority: 'NORMAL', prioritySource: 'DEFAULT',
      priorityUpdatedById: null, priorityUpdatedAt: null, priorityReason: null, crmRemarks: null,
      crmRemarksUpdatedById: null, crmRemarksUpdatedAt: null, ...over,
    },
    [OTHER_ORDER]: { id: OTHER_ORDER, expectedDispatchDate: new Date('2026-11-20T00:00:00Z') },
  };
  const changes: Record<string, unknown>[] = [];
  const demandUpdates: { id: string; requiredByDate: Date | null }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    shopifyOrder: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => (orders[where.id] ? { ...orders[where.id] } : null)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(orders[where.id]!, data)),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => orders[id]).filter((o) => o?.expectedDispatchDate)
          .sort((a, b) => (a!.expectedDispatchDate as Date).getTime() - (b!.expectedDispatchDate as Date).getTime())
          .slice(0, 1)),
    },
    orderCrmChange: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { changes.push(data); }),
      findMany: jest.fn(async () => changes.map((c, i) => ({ ...c, id: String(i), changedAt: new Date() }))),
    },
    demandSourceMapping: {
      findMany: jest.fn(async ({ where }: { where: { sourceDocId?: string; manufacturingDemandId?: string } }) =>
        where.sourceDocId ? [{ manufacturingDemandId: 'd1' }] : [{ sourceDocId: ORDER }, { sourceDocId: OTHER_ORDER }]),
    },
    manufacturingDemand: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { requiredByDate: Date | null } }) => {
        demandUpdates.push({ id: where.id, requiredByDate: data.requiredByDate });
      }),
    },
    user: { findMany: jest.fn(async () => [{ id: user.id, fullName: 'CRM' }]) },
    inTransaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(db)),
  };
  const audit = { record: jest.fn() };
  const shopify = new ShopifyService(db as never, { describe: () => ({ shopDomain: '' }) } as never, audit as never);
  const service = new OrderCrmService(db as never, audit as never, shopify, {} as never);
  return { service, orders, changes, demandUpdates, audit };
}

describe('CRM dispatch date', () => {
  it('lets the CRM set a first date without a reason, locks it, and records it', async () => {
    const s = setup();
    const r = await s.service.setDispatchDate(user, ORDER, { date: '2026-11-05' });
    expect(r.crm).toMatchObject({ expectedDispatchDate: '2026-11-05', dispatchDateSource: 'CRM_MANUAL', dispatchDateLocked: true, dispatchDateUpdatedBy: 'CRM' });
    expect(s.changes).toEqual([expect.objectContaining({ field: 'EXPECTED_DISPATCH_DATE', previousValue: null, newValue: '2026-11-05', source: 'CRM_MANUAL', changedById: user.id })]);
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'ShopifyOrder', entityId: ORDER }), expect.anything());
  });

  it('needs a reason to change or clear an existing date', async () => {
    const s = setup({ expectedDispatchDate: new Date('2026-11-05T00:00:00Z'), dispatchDateSource: 'CRM_MANUAL', dispatchDateLocked: true });
    await expect(s.service.setDispatchDate(user, ORDER, { date: '2026-11-08' })).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    await expect(s.service.setDispatchDate(user, ORDER, { date: null })).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    const r = await s.service.setDispatchDate(user, ORDER, { date: '2026-11-08', reason: 'Fabric delayed' });
    expect(r.crm.expectedDispatchDate).toBe('2026-11-08');
    expect(s.changes[0]).toMatchObject({ previousValue: '2026-11-05', newValue: '2026-11-08', reason: 'Fabric delayed' });
    const cleared = await s.service.setDispatchDate(user, ORDER, { date: null, reason: 'Customer will call' });
    expect(cleared.crm).toMatchObject({ expectedDispatchDate: null, dispatchDateSource: 'UNASSIGNED', dispatchDateLocked: true });
  });

  it('keeps where an overridden Shopify date came from', async () => {
    const s = setup({
      expectedDispatchDate: new Date('2026-11-05T00:00:00Z'), dispatchDateSource: 'SHOPIFY_NOTE',
      shopifyDispatchDate: new Date('2026-11-05T00:00:00Z'), shopifyDispatchSource: 'SHOPIFY_NOTE', shopifyDispatchText: 'Dispatch by 5th Nov',
    });
    const r = await s.service.setDispatchDate(user, ORDER, { date: '2026-11-09', reason: 'Embroidery needs 4 more days' });
    expect(r.crm.dispatchDateOriginalValue).toBe('2026-11-05 from Shopify note: Dispatch by 5th Nov');
    // Shopify still says the 5th: shown as a conflict, not resolved.
    expect(r.crm.conflict).toBe(true);
    expect(r.crm.shopify.date).toBe('2026-11-05');
  });

  it("returns the date to Shopify's on request, unlocking it", async () => {
    const s = setup({
      expectedDispatchDate: new Date('2026-11-09T00:00:00Z'), dispatchDateSource: 'CRM_MANUAL', dispatchDateLocked: true,
      shopifyDispatchDate: new Date('2026-11-05T00:00:00Z'), shopifyDispatchSource: 'SHOPIFY_NOTE',
    });
    const r = await s.service.useShopifyDate(user, ORDER, 'Customer agreed to the original');
    expect(r.crm).toMatchObject({ expectedDispatchDate: '2026-11-05', dispatchDateSource: 'SHOPIFY_NOTE', dispatchDateLocked: false });
  });

  it('refuses impossible dates', async () => {
    const s = setup();
    await expect(s.service.setDispatchDate(user, ORDER, { date: '2026-02-30' })).rejects.toMatchObject({ response: { code: 'INVALID_DISPATCH_DATE' } });
    await expect(s.service.setDispatchDate(user, ORDER, { date: '2019-12-31' })).rejects.toMatchObject({ response: { code: 'INVALID_DISPATCH_DATE' } });
  });

  it('moves linked demand to the earliest promise among its orders', async () => {
    const s = setup();
    await s.service.setDispatchDate(user, ORDER, { date: '2026-11-05' });
    expect(s.demandUpdates).toEqual([{ id: 'd1', requiredByDate: new Date('2026-11-05T00:00:00Z') }]);
  });
});

describe('CRM priority', () => {
  it.each(['VIP', 'HIGH', 'MEDIUM', 'NORMAL'] as const)('saves %s', async (priority) => {
    const s = setup({ orderPriority: priority === 'NORMAL' ? 'HIGH' : 'NORMAL' });
    const r = await s.service.setPriority(user, ORDER, { priority, reason: 'Called the customer' });
    expect(r.crm).toMatchObject({ priority, prioritySource: 'CRM_MANUAL', priorityUpdatedBy: 'CRM', priorityReason: 'Called the customer' });
    expect(s.changes[0]).toMatchObject({ field: 'PRIORITY', newValue: priority, source: 'CRM_MANUAL' });
  });

  it('records remarks and keeps the full history', async () => {
    const s = setup();
    await s.service.setPriority(user, ORDER, { priority: 'VIP' });
    await s.service.setRemarks(user, ORDER, 'Wedding on the 12th');
    await s.service.setDispatchDate(user, ORDER, { date: '2026-11-05' });
    const history = await s.service.history(ORG, ORDER);
    expect(history.map((h) => h.field)).toEqual(['PRIORITY', 'CRM_REMARKS', 'EXPECTED_DISPATCH_DATE']);
    expect(history.every((h) => h.changedBy === 'CRM')).toBe(true);
  });
});

describe('who may change it', () => {
  const required = (method: keyof OrderCrmController) =>
    new Reflector().get<string[]>(PERMISSIONS_KEY, OrderCrmController.prototype[method] as never);
  it('needs demand.manage_crm for every change, and only demand.read for history', () => {
    for (const m of ['setDispatchDate', 'useShopify', 'setPriority', 'setRemarks', 'rescan'] as const) {
      expect(required(m)).toEqual(['demand.manage_crm']);
    }
    expect(required('history')).toEqual(['demand.read']);
  });
});

describe('Shopify webhook signature', () => {
  const body = Buffer.from('{"admin_graphql_api_id":"gid://shopify/Order/1"}');
  const sign = (secret: string) => createHmac('sha256', secret).update(body).digest('base64');
  it('accepts only the exact bytes signed with the shared secret', () => {
    expect(verifyShopifyHmac(body, sign('s3cret'), 's3cret')).toBe(true);
    expect(verifyShopifyHmac(body, sign('other'), 's3cret')).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(`${body} `), sign('s3cret'), 's3cret')).toBe(false);
    expect(verifyShopifyHmac(body, sign('s3cret'), '')).toBe(false);
    expect(verifyShopifyHmac(undefined, sign('s3cret'), 's3cret')).toBe(false);
  });
});
