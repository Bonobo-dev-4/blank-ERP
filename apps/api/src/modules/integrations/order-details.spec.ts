import { shopifyOrderListQuery } from '@dnd/contracts';
import { Prisma } from '@prisma/client';
import { ShopifyService } from './shopify.service';

const ORDER_ID = '7d0c2a8e-0f3c-4c39-9a51-8a1d1f0d9b11';
const amount = (a: string) => ({ shopMoney: { amount: a } });

const rawOrder = {
  id: 'gid://shopify/Order/9001',
  legacyResourceId: '9001',
  email: 'buyer@example.test',
  phone: '+919800000000',
  statusPageUrl: 'https://shop.example.test/status/abc',
  customer: { id: 'gid://shopify/Customer/7', displayName: 'Asha R', numberOfOrders: '2' },
  shippingAddress: { name: 'Asha R', address1: '1 MG Road', city: 'Jaipur', zip: '302001', countryCodeV2: 'IN' },
  subtotalPriceSet: amount('2000.00'),
  currentTotalPriceSet: amount('1900.00'),
  totalDiscountsSet: amount('100.00'),
  fulfillments: [{ status: 'SUCCESS', trackingInfo: [{ company: 'Delhivery', number: 'AWB1', url: 'https://t.test/AWB1' }] }],
};

const rawLine = {
  id: 'gid://shopify/LineItem/1',
  product: { id: 'gid://shopify/Product/11', legacyResourceId: '11', title: 'Kurta' },
  variant: { id: 'gid://shopify/ProductVariant/22', legacyResourceId: '22', barcode: '8901', selectedOptions: [{ name: 'Size', value: 'M' }] },
  originalUnitPriceSet: amount('1000.00'),
};

function setup() {
  const dbOrder = {
    id: ORDER_ID, organizationId: 'org', externalId: rawOrder.id, orderNumber: '9001', orderName: '#9001',
    channel: 'ONLINE', channelBasis: 'DEFAULT', isCustomised: false, posLocationName: null, status: 'OPEN',
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED', currency: 'INR',
    totalAmount: new Prisma.Decimal('1900'), customerRef: 'Asha R', note: null, tags: [],
    orderedAt: new Date('2026-10-20T10:00:00Z'), cancelledAt: null, importedAt: new Date('2026-10-20T10:05:00Z'),
    externalShipmentStatus: null, externalStatusSyncedAt: null, rawPayload: rawOrder,
    lines: [{
      id: 'line-1', externalLineId: rawLine.id, productVariantId: null, externalSku: 'KUR-M',
      externalVariantId: rawLine.variant.id, title: 'Kurta', size: null, color: null,
      orderedQty: new Prisma.Decimal(2), cancelledQty: new Prisma.Decimal(0), fulfilledQty: new Prisma.Decimal(2),
      manufacturingQty: new Prisma.Decimal(0), availabilityStatus: 'PENDING_CHECK', rawPayload: rawLine,
    }],
  };
  const prisma = {
    shopifyOrder: {
      findFirst: jest.fn().mockResolvedValue(dbOrder),
      findMany: jest.fn().mockResolvedValue([{
        ...dbOrder, rawPayload: undefined, email: 'buyer@example.test', phone: '+919800000000',
        customerExternalId: 'gid://shopify/Customer/7', shippingCity: 'Jaipur', shippingProvince: 'Rajasthan',
        shippingZip: '302001', shippingCountry: 'IN',
        lines: [{ id: 'line-1', productVariantId: null, manufacturingQty: new Prisma.Decimal(0) }],
      }]),
      count: jest.fn().mockResolvedValue(1),
    },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    demandSourceMapping: { findMany: jest.fn().mockResolvedValue([]) },
    unicommerceOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const client = { describe: () => ({ shopDomain: 'dash-and-dot.myshopify.com' }) };
  const service = new ShopifyService(prisma as never, client as never, {} as never);
  return { service, prisma };
}

describe('order detail from Shopify', () => {
  it('gives every reader the Shopify ids, prices and tracking', async () => {
    const { service } = setup();
    const o = await service.getOrder('org', ORDER_ID);
    expect(o.shopify).toMatchObject({
      legacyId: '9001', adminUrl: 'https://admin.shopify.com/store/dash-and-dot/orders/9001',
    });
    expect(o.money).toMatchObject({ subtotal: '2000.00', discounts: '100.00', total: '1900.00' });
    expect(o.fulfillments[0]?.tracking[0]).toMatchObject({ number: 'AWB1', url: 'https://t.test/AWB1' });
    expect(o.lines[0]?.shopify).toMatchObject({
      productLegacyId: '11', variantLegacyId: '22', barcode: '8901', unitPrice: '1000.00',
      adminUrl: 'https://admin.shopify.com/store/dash-and-dot/products/11/variants/22',
    });
  });

  it('withholds the customer, contact and addresses without demand.view_customer', async () => {
    const { service } = setup();
    const o = await service.getOrder('org', ORDER_ID, { canSeeCustomer: false });
    expect(o.customerHidden).toBe(true);
    expect(o.customer).toBeNull();
    expect(o.contact).toBeNull();
    expect(o.shippingAddress).toBeNull();
    expect(o.billingAddress).toBeNull();
    expect(o.statusPageUrl).toBeNull();
    expect(JSON.stringify(o)).not.toContain('buyer@example.test');
    expect(JSON.stringify(o)).not.toContain('1 MG Road');
  });

  it('shows them to a reader who holds it', async () => {
    const { service } = setup();
    const o = await service.getOrder('org', ORDER_ID, { canSeeCustomer: true });
    expect(o.customerHidden).toBe(false);
    expect(o.customer).toMatchObject({ name: 'Asha R', legacyId: '7', numberOfOrders: '2' });
    expect(o.contact).toEqual({ email: 'buyer@example.test', phone: '+919800000000' });
    expect(o.shippingAddress).toMatchObject({ city: 'Jaipur', zip: '302001' });
  });
});

describe('order list and personal data', () => {
  it('never loads the raw payload, and drops contact fields for an ordinary reader', async () => {
    const { service, prisma } = setup();
    const page = await service.listOrders('org', shopifyOrderListQuery.parse({ search: '9800' }));
    const args = prisma.shopifyOrder.findMany.mock.calls[0][0];
    expect(args.omit).toEqual({ rawPayload: true });
    // Searching contact fields would confirm data the reader cannot see.
    expect(args.where.OR).toHaveLength(3);
    const row = page.data[0] as Record<string, unknown>;
    for (const k of ['email', 'phone', 'customerExternalId', 'shippingCity', 'shippingZip']) {
      expect(row).not.toHaveProperty(k);
    }
  });

  it('searches and returns ship-to for a reader with demand.view_customer', async () => {
    const { service, prisma } = setup();
    const page = await service.listOrders('org', shopifyOrderListQuery.parse({ search: '302001' }), { canSeeCustomer: true });
    expect(prisma.shopifyOrder.findMany.mock.calls[0][0].where.OR).toHaveLength(7);
    expect(page.data[0]).toMatchObject({ shippingCity: 'Jaipur', shippingZip: '302001' });
    expect(page.data[0]).not.toHaveProperty('customerExternalId');
  });
});

describe('refreshing orders by id', () => {
  function refreshSetup(nodes: unknown[]) {
    const client = { query: jest.fn().mockResolvedValue({ nodes }), describe: () => ({ shopDomain: '' }) };
    const audit = { record: jest.fn() };
    const service = new ShopifyService({} as never, client as never, audit as never);
    const upsert = jest.spyOn(service as never as { upsertOrder: () => Promise<string> }, 'upsertOrder')
      .mockResolvedValue('IMPORTED');
    return { service, client, audit, upsert };
  }

  it('asks Shopify for exactly the orders named, and counts the ones it no longer has', async () => {
    const { service, client, upsert } = refreshSetup([{ id: 'gid://shopify/Order/1' }, null]);
    const r = await service.refreshOrders('org', 'user', [
      'gid://shopify/Order/1', 'gid://shopify/Order/2', 'gid://shopify/Order/1', 'not-a-gid',
    ]);
    expect(client.query.mock.calls[0][1]).toEqual({ ids: ['gid://shopify/Order/1', 'gid://shopify/Order/2'] });
    expect(client.query.mock.calls[0][0]).toContain('nodes(ids: $ids)');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ requested: 2, refreshed: 1, skippedStale: 0, missing: 1 });
  });

  it('batches long lists to stay under the query cost ceiling', async () => {
    const { service, client } = refreshSetup([]);
    const ids = Array.from({ length: 120 }, (_, i) => `gid://shopify/Order/${i + 1}`);
    await service.refreshOrders('org', 'user', ids);
    expect(client.query.mock.calls.map((c) => c[1].ids.length)).toEqual([50, 50, 20]);
  });
});
