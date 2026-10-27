import { describe, expect, it } from 'vitest';
import {
  legacyIdFromGid, safeHttpUrl, shopifyLineDetails, shopifyOrderDetails,
} from './shopify-order-details';

const amount = (a: string) => ({ shopMoney: { amount: a } });

describe('legacyIdFromGid', () => {
  it('takes the number from a GID', () => {
    expect(legacyIdFromGid('gid://shopify/ProductVariant/4455')).toBe('4455');
    expect(legacyIdFromGid('gid://shopify/Order/12?x=1')).toBe('12');
  });
  it('rejects anything else', () => {
    expect(legacyIdFromGid('4455')).toBeNull();
    expect(legacyIdFromGid(null)).toBeNull();
  });
});

describe('safeHttpUrl', () => {
  it('keeps http(s) links', () => {
    expect(safeHttpUrl('https://track.example/abc')).toBe('https://track.example/abc');
  });
  it('drops script and relative links', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('/orders/1')).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});

describe('shopifyOrderDetails', () => {
  it('reads an enriched payload', () => {
    const d = shopifyOrderDetails({
      id: 'gid://shopify/Order/9001',
      email: 'a@b.test',
      customer: { id: 'gid://shopify/Customer/7', firstName: 'Asha', lastName: 'R', numberOfOrders: '3' },
      shippingAddress: { firstName: 'Asha', lastName: 'R', city: 'Jaipur', zip: '302001', countryCodeV2: 'IN' },
      subtotalPriceSet: amount('1000.00'),
      totalDiscountsSet: amount('100.00'),
      currentTotalPriceSet: amount('950.00'),
      paymentGatewayNames: ['razorpay', ''],
      shippingLines: { edges: [{ node: { title: 'Express', originalPriceSet: amount('50.00') } }] },
      fulfillments: [{ status: 'SUCCESS', trackingInfo: [{ number: 'AWB1', url: 'javascript:void(0)' }] }],
      customAttributes: [{ key: 'Gift note', value: 'Happy birthday' }, { value: 'orphan' }],
    });
    expect(d.legacyId).toBe('9001');
    expect(d.customer).toMatchObject({ legacyId: '7', name: 'Asha R', numberOfOrders: '3' });
    expect(d.shippingAddress).toMatchObject({ name: 'Asha R', city: 'Jaipur', zip: '302001', countryCode: 'IN' });
    expect(d.money).toMatchObject({ subtotal: '1000.00', discounts: '100.00', total: '950.00', tax: null });
    expect(d.paymentGateways).toEqual(['razorpay']);
    expect(d.shippingLines).toEqual([{ title: 'Express', code: null, carrier: null, amount: '50.00' }]);
    expect(d.fulfillments[0]?.tracking[0]).toEqual({ company: null, number: 'AWB1', url: null });
    expect(d.attributes).toEqual([{ key: 'Gift note', value: 'Happy birthday' }]);
  });

  it('treats a payload from before the enrichment as absent, not broken', () => {
    const d = shopifyOrderDetails({ id: 'gid://shopify/Order/5', customer: { id: 'x', displayName: 'Walk-in' } });
    expect(d.shippingAddress).toBeNull();
    expect(d.customer?.name).toBe('Walk-in');
    expect(d.money.subtotal).toBeNull();
    expect(d.fulfillments).toEqual([]);
    expect(shopifyOrderDetails(null).orderId).toBeNull();
  });
});

describe('shopifyLineDetails', () => {
  it('reads product and variant identity', () => {
    const d = shopifyLineDetails({
      id: 'gid://shopify/LineItem/1',
      title: 'Kurta',
      sku: 'KUR-M',
      originalUnitPriceSet: amount('1499.00'),
      product: { id: 'gid://shopify/Product/11', title: 'Kurta', handle: 'kurta', vendor: 'DnD' },
      variant: {
        id: 'gid://shopify/ProductVariant/22', barcode: '8901', title: 'M / Indigo',
        selectedOptions: [{ name: 'Size', value: 'M' }, { name: 'Color', value: 'Indigo' }],
        image: { url: 'https://cdn.shopify.test/v.jpg' },
      },
    });
    expect(d).toMatchObject({
      productLegacyId: '11', variantLegacyId: '22', variantTitle: 'M / Indigo', barcode: '8901',
      vendor: 'DnD', unitPrice: '1499.00', imageUrl: 'https://cdn.shopify.test/v.jpg', sku: 'KUR-M',
    });
    expect(d.options).toEqual([{ name: 'Size', value: 'M' }, { name: 'Color', value: 'Indigo' }]);
  });

  it('survives a line whose product was deleted', () => {
    const d = shopifyLineDetails({ id: 'x', title: 'Old', product: null, variant: null });
    expect(d.productId).toBeNull();
    expect(d.options).toEqual([]);
    expect(d.name).toBe('Old');
  });
});
