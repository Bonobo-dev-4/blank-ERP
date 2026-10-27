/**
 * Reading the detail out of a stored Shopify order payload.
 *
 * The import keeps each order verbatim, so these functions are the one place
 * that knows the payload's shape. They never throw: a payload imported before
 * a field was requested simply reports it as absent, which is what lets old
 * orders render next to new ones without a migration of their JSON.
 */

export interface ShopifyAddress {
  readonly name: string | null;
  readonly company: string | null;
  readonly address1: string | null;
  readonly address2: string | null;
  readonly city: string | null;
  readonly province: string | null;
  readonly provinceCode: string | null;
  readonly zip: string | null;
  readonly country: string | null;
  readonly countryCode: string | null;
  readonly phone: string | null;
}

export interface ShopifyCustomer {
  readonly id: string | null;
  readonly legacyId: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly numberOfOrders: string | null;
}

export interface ShopifyKeyValue {
  readonly key: string;
  readonly value: string | null;
}

export interface ShopifyOrderDetails {
  readonly orderId: string | null;
  readonly legacyId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly confirmationNumber: string | null;
  readonly statusPageUrl: string | null;
  readonly sourceName: string | null;
  readonly customer: ShopifyCustomer | null;
  readonly shippingAddress: ShopifyAddress | null;
  readonly billingAddress: ShopifyAddress | null;
  readonly money: {
    readonly subtotal: string | null;
    readonly discounts: string | null;
    readonly shipping: string | null;
    readonly tax: string | null;
    readonly total: string | null;
    readonly refunded: string | null;
  };
  readonly paymentGateways: readonly string[];
  readonly discountCodes: readonly string[];
  readonly taxLines: readonly { title: string | null; rate: number | null; amount: string | null }[];
  readonly shippingLines: readonly {
    title: string | null; code: string | null; carrier: string | null; amount: string | null;
  }[];
  readonly fulfillments: readonly {
    status: string | null;
    createdAt: string | null;
    tracking: readonly { company: string | null; number: string | null; url: string | null }[];
  }[];
  readonly attributes: readonly ShopifyKeyValue[];
  readonly cancelReason: string | null;
  readonly closedAt: string | null;
}

export interface ShopifyLineDetails {
  readonly lineId: string | null;
  readonly name: string | null;
  readonly productId: string | null;
  readonly productLegacyId: string | null;
  readonly productTitle: string | null;
  readonly productHandle: string | null;
  readonly productType: string | null;
  readonly vendor: string | null;
  readonly variantId: string | null;
  readonly variantLegacyId: string | null;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly inventoryItemId: string | null;
  readonly options: readonly { name: string; value: string | null }[];
  readonly unitPrice: string | null;
  readonly discountedUnitPrice: string | null;
  readonly totalDiscount: string | null;
  readonly requiresShipping: boolean | null;
  readonly taxable: boolean | null;
  readonly imageUrl: string | null;
  readonly attributes: readonly ShopifyKeyValue[];
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

/** `{ shopMoney: { amount } }` to the amount, as Shopify's decimal string. */
const money = (v: unknown): string | null => str(obj(obj(v)?.shopMoney)?.amount);

/** Connection edges or a plain list, whichever the field returns. */
const nodes = (v: unknown): Obj[] => {
  const edges = obj(v)?.edges;
  const list = Array.isArray(edges) ? edges.map((e) => obj(e)?.node) : arr(v);
  return list.map(obj).filter((n): n is Obj => n !== null);
};

/**
 * The numeric id at the end of a Shopify GID — what the Shopify admin shows
 * and what its URLs use. `gid://shopify/ProductVariant/123` gives `123`.
 */
export function legacyIdFromGid(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = /^gid:\/\/shopify\/[A-Za-z]+\/(\d+)(?:\?.*)?$/.exec(gid);
  return m?.[1] ?? null;
}

/**
 * Only absolute http(s) links survive. Tracking and status URLs come from
 * outside and end up in an `href`, where `javascript:` would execute.
 */
export function safeHttpUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function address(v: unknown): ShopifyAddress | null {
  const a = obj(v);
  if (!a) return null;
  const first = str(a.firstName);
  const last = str(a.lastName);
  return {
    name: str(a.name) ?? ([first, last].filter(Boolean).join(' ') || null),
    company: str(a.company),
    address1: str(a.address1),
    address2: str(a.address2),
    city: str(a.city),
    province: str(a.province),
    provinceCode: str(a.provinceCode),
    zip: str(a.zip),
    country: str(a.country),
    countryCode: str(a.countryCodeV2) ?? str(a.countryCode),
    phone: str(a.phone),
  };
}

function keyValues(v: unknown): ShopifyKeyValue[] {
  return arr(v)
    .map(obj)
    .filter((kv): kv is Obj => kv !== null && str(kv.key) !== null)
    .map((kv) => ({ key: str(kv.key) as string, value: str(kv.value) }));
}

const strings = (v: unknown): string[] =>
  arr(v).map(str).filter((s): s is string => s !== null);

export function shopifyOrderDetails(raw: unknown): ShopifyOrderDetails {
  const o = obj(raw) ?? {};
  const c = obj(o.customer);
  const customerName = c
    ? str(c.displayName) ?? ([str(c.firstName), str(c.lastName)].filter(Boolean).join(' ') || null)
    : null;
  const id = str(o.id);

  return {
    orderId: id,
    legacyId: str(o.legacyResourceId) ?? legacyIdFromGid(id),
    email: str(o.email),
    phone: str(o.phone),
    confirmationNumber: str(o.confirmationNumber),
    statusPageUrl: safeHttpUrl(o.statusPageUrl),
    sourceName: str(o.sourceName),
    customer: c
      ? {
          id: str(c.id),
          legacyId: str(c.legacyResourceId) ?? legacyIdFromGid(str(c.id)),
          name: customerName,
          email: str(c.email),
          phone: str(c.phone),
          numberOfOrders: str(c.numberOfOrders),
        }
      : null,
    shippingAddress: address(o.shippingAddress),
    billingAddress: address(o.billingAddress),
    money: {
      subtotal: money(o.subtotalPriceSet),
      discounts: money(o.totalDiscountsSet),
      shipping: money(o.totalShippingPriceSet),
      tax: money(o.totalTaxSet),
      total: money(o.currentTotalPriceSet),
      refunded: money(o.totalRefundedSet),
    },
    paymentGateways: strings(o.paymentGatewayNames),
    discountCodes: strings(o.discountCodes),
    taxLines: arr(o.taxLines).map(obj).filter((t): t is Obj => t !== null).map((t) => ({
      title: str(t.title), rate: num(t.rate), amount: money(t.priceSet),
    })),
    shippingLines: nodes(o.shippingLines).map((s) => ({
      title: str(s.title),
      code: str(s.code),
      carrier: str(s.carrierIdentifier),
      amount: money(s.originalPriceSet),
    })),
    fulfillments: nodes(o.fulfillments).map((f) => ({
      status: str(f.status),
      createdAt: str(f.createdAt),
      tracking: arr(f.trackingInfo).map(obj).filter((t): t is Obj => t !== null).map((t) => ({
        company: str(t.company), number: str(t.number), url: safeHttpUrl(t.url),
      })),
    })),
    attributes: keyValues(o.customAttributes),
    cancelReason: str(o.cancelReason),
    closedAt: str(o.closedAt),
  };
}

export function shopifyLineDetails(raw: unknown): ShopifyLineDetails {
  const l = obj(raw) ?? {};
  const p = obj(l.product);
  const v = obj(l.variant);
  const productId = str(p?.id);
  const variantId = str(v?.id);
  return {
    lineId: str(l.id),
    name: str(l.name) ?? str(l.title),
    productId,
    productLegacyId: str(p?.legacyResourceId) ?? legacyIdFromGid(productId),
    productTitle: str(p?.title),
    productHandle: str(p?.handle),
    productType: str(p?.productType),
    vendor: str(l.vendor) ?? str(p?.vendor),
    variantId,
    variantLegacyId: str(v?.legacyResourceId) ?? legacyIdFromGid(variantId),
    variantTitle: str(l.variantTitle) ?? str(v?.title),
    sku: str(l.sku) ?? str(v?.sku),
    barcode: str(v?.barcode),
    inventoryItemId: str(obj(v?.inventoryItem)?.id),
    options: arr(v?.selectedOptions)
      .map(obj)
      .filter((o): o is Obj => o !== null && str(o.name) !== null)
      .map((o) => ({ name: str(o.name) as string, value: str(o.value) })),
    unitPrice: money(l.originalUnitPriceSet),
    discountedUnitPrice: money(l.discountedUnitPriceSet),
    totalDiscount: money(l.totalDiscountSet),
    requiresShipping: bool(l.requiresShipping),
    taxable: bool(l.taxable),
    imageUrl: safeHttpUrl(obj(l.image)?.url) ?? safeHttpUrl(obj(v?.image)?.url),
    attributes: keyValues(l.customAttributes),
  };
}
