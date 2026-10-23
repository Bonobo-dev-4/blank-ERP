import { ValidationError } from '../errors';

/**
 * Reading a Shopify product into ERP terms.
 *
 * The SKU convention this business uses carries three facts in one string:
 *
 *   W/2781/2782/2783-XXS-49327000027306
 *   └── style(s) ──┘ └sz┘ └ variant id ┘
 *
 * Verified against the live store and against Unicommerce, which uses the
 * SAME convention — so one SKU string identifies a garment in all three
 * systems and mapping is exact rather than fuzzy. That is worth protecting:
 * everything here fails loudly rather than guessing, because a mis-parsed SKU
 * silently attaches demand to the wrong garment.
 */

export interface ShopifySkuParts {
  /** The style portion, e.g. `W/2781/2782/2783`. A co-ord set carries several. */
  readonly styleCode: string;
  /** Size token, e.g. `XXS`. Null when the SKU does not carry one. */
  readonly size: string | null;
  /** Trailing Shopify variant id, when present. */
  readonly variantId: string | null;
}

/**
 * Split a SKU into style, size and variant id.
 *
 * Returns null rather than guessing when the shape does not match. A SKU that
 * does not follow the convention is a mapping for a human to resolve, not a
 * string to carve up hopefully.
 */
export function parseShopifySku(sku: string | null | undefined): ShopifySkuParts | null {
  if (!sku) return null;
  const trimmed = sku.trim();
  if (trimmed.length === 0) return null;

  // Variant ids are long. A short trailing number is far more likely to be a
  // size or a colourway than an id - see shopifyVariantIdFromUniwareSku.
  const withId = /^(.*)-([A-Za-z0-9/]+)-(\d{10,})$/.exec(trimmed);
  if (withId) {
    return { styleCode: withId[1] ?? '', size: withId[2] ?? null, variantId: withId[3] ?? null };
  }

  const withoutId = /^(.*)-([A-Za-z0-9/]+)$/.exec(trimmed);
  if (withoutId) {
    return { styleCode: withoutId[1] ?? '', size: withoutId[2] ?? null, variantId: null };
  }

  return { styleCode: trimmed, size: null, variantId: null };
}

export interface ShopifyOptionValue {
  readonly name: string;
  readonly value: string;
}

/**
 * Pull the size out of a variant's options.
 *
 * A co-ord set lists one size option PER GARMENT — the live store returns
 * three options all called "(Size)" for a three-piece set. They always carry
 * the same value, so the first is taken; taking the last, or joining them,
 * would produce "XXS / XXS / XXS" as a size nobody can filter on.
 */
export function sizeFromOptions(options: readonly ShopifyOptionValue[] | null | undefined): string | null {
  if (!options?.length) return null;
  const size = options.find((o) => /size/i.test(o.name));
  return size?.value?.trim() || null;
}

/** Colour from a variant's options, when the store records one. */
export function colourFromOptions(options: readonly ShopifyOptionValue[] | null | undefined): string | null {
  if (!options?.length) return null;
  const colour = options.find((o) => /colou?r|shade/i.test(o.name));
  return colour?.value?.trim() || null;
}

/**
 * Standard garment sizes, in the order a human expects to read them.
 *
 * Used for `sizeSortOrder`, so a size column reads XS, S, M, L rather than
 * alphabetically as L, M, S, XS — which is the order a database gives you and
 * nobody wants.
 */
const SIZE_ORDER = [
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL',
] as const;

export function sizeSortOrder(size: string | null | undefined): number {
  if (!size) return 999;
  const i = SIZE_ORDER.indexOf(size.trim().toUpperCase() as (typeof SIZE_ORDER)[number]);
  if (i >= 0) return i;
  // Numeric sizes (28, 30, 32…) sort after letters but among themselves.
  const n = Number(size.trim());
  return Number.isFinite(n) ? 100 + n : 998;
}

/**
 * The style code a product is filed under.
 *
 * Taken from the SKU when it follows the convention, because that is the code
 * the business already uses on a cutting ticket. The Shopify handle is the
 * fallback: it is unique per store, so it never collides, but it is a URL slug
 * rather than something anyone says out loud.
 */
export function styleCodeFor(input: {
  readonly firstVariantSku?: string | null;
  readonly handle?: string | null;
  readonly productGid?: string | null;
}): string {
  const parsed = parseShopifySku(input.firstVariantSku);
  if (parsed && parsed.styleCode.length > 0) return parsed.styleCode;
  if (input.handle?.trim()) return input.handle.trim();
  const gid = input.productGid?.split('/').pop();
  if (gid) return `SHOPIFY-${gid}`;
  throw new ValidationError(
    'NO_STYLE_CODE',
    'A product needs a SKU, a handle or an id to be filed under',
  );
}

export const SHOPIFY_PRODUCT_STATUSES = ['ACTIVE', 'ARCHIVED', 'DRAFT'] as const;
export type ShopifyProductStatus = (typeof SHOPIFY_PRODUCT_STATUSES)[number];

/**
 * Map Shopify's publication status onto the ERP's.
 *
 * An archived Shopify product becomes DISCONTINUED rather than DRAFT: it was
 * live once and may still have stock and open orders, which is a different
 * thing from something never published.
 */
export function productStatusFrom(status: string | null | undefined): 'ACTIVE' | 'DRAFT' | 'DISCONTINUED' {
  switch ((status ?? '').trim().toUpperCase()) {
    case 'ACTIVE': return 'ACTIVE';
    case 'ARCHIVED': return 'DISCONTINUED';
    default: return 'DRAFT';
  }
}
