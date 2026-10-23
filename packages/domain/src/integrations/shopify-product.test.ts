import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import {
  colourFromOptions, parseShopifySku, productStatusFrom, sizeFromOptions,
  sizeSortOrder, styleCodeFor,
} from './shopify-product';

describe('SKU parsing', () => {
  it('splits the convention this business actually uses', () => {
    // Taken verbatim from the live store.
    const p = parseShopifySku('W/2781/2782/2783-XXS-49327000027306');
    expect(p?.styleCode).toBe('W/2781/2782/2783');
    expect(p?.size).toBe('XXS');
    expect(p?.variantId).toBe('49327000027306');
  });

  it('parses a single-style SKU', () => {
    const p = parseShopifySku('W/2769-L-49295244427434');
    expect(p?.styleCode).toBe('W/2769');
    expect(p?.size).toBe('L');
    expect(p?.variantId).toBe('49295244427434');
  });

  it('handles a SKU with no trailing variant id', () => {
    const p = parseShopifySku('W/2769-L');
    expect(p?.styleCode).toBe('W/2769');
    expect(p?.size).toBe('L');
    expect(p?.variantId).toBeNull();
  });

  it('does not mistake a short trailing number for a variant id', () => {
    // 32 is a waist, not a Shopify id.
    const p = parseShopifySku('TROUSER-32');
    expect(p?.size).toBe('32');
    expect(p?.variantId).toBeNull();
  });

  it('returns the whole string when there is nothing to split on', () => {
    expect(parseShopifySku('PLAINSKU')?.styleCode).toBe('PLAINSKU');
    expect(parseShopifySku('PLAINSKU')?.size).toBeNull();
  });

  it('returns null rather than inventing structure', () => {
    expect(parseShopifySku(null)).toBeNull();
    expect(parseShopifySku('')).toBeNull();
    expect(parseShopifySku('   ')).toBeNull();
  });
});

describe('variant options', () => {
  it('takes one size from a co-ord set that lists three', () => {
    // The live store returns one size option PER GARMENT for a set. Joining
    // them would produce "XXS / XXS / XXS" as a size nobody can filter on.
    const size = sizeFromOptions([
      { name: 'EMBROIDERED BIB (Size)', value: 'XXS' },
      { name: 'SMOCKED BALLOON SLEEVE TOP (Size)', value: 'XXS' },
      { name: 'TEXTURED COWL DRAPE PANT (Size)', value: 'XXS' },
    ]);
    expect(size).toBe('XXS');
  });

  it('finds a plain size option', () => {
    expect(sizeFromOptions([{ name: 'Size', value: 'M' }])).toBe('M');
  });

  it('ignores options that are not sizes', () => {
    expect(sizeFromOptions([{ name: 'Material', value: 'Silk' }])).toBeNull();
  });

  it('finds a colour under either spelling', () => {
    expect(colourFromOptions([{ name: 'Color', value: 'Ivory' }])).toBe('Ivory');
    expect(colourFromOptions([{ name: 'Colour', value: 'Ivory' }])).toBe('Ivory');
  });

  it('returns null for no options at all', () => {
    expect(sizeFromOptions(null)).toBeNull();
    expect(colourFromOptions([])).toBeNull();
  });
});

describe('size ordering', () => {
  it('sorts garment sizes the way a human reads them', () => {
    const sizes = ['L', 'XS', 'XXL', 'M', 'S'];
    const sorted = [...sizes].sort((a, b) => sizeSortOrder(a) - sizeSortOrder(b));
    // Alphabetical would give L, M, S, XS, XXL - which is the order a database
    // gives you and nobody wants.
    expect(sorted).toEqual(['XS', 'S', 'M', 'L', 'XXL']);
  });

  it('keeps numeric sizes in numeric order, after the letters', () => {
    expect(sizeSortOrder('28')).toBeLessThan(sizeSortOrder('32'));
    expect(sizeSortOrder('28')).toBeGreaterThan(sizeSortOrder('XXL'));
  });

  it('sends an unknown size to the end rather than to the front', () => {
    expect(sizeSortOrder('ONE SIZE')).toBeGreaterThan(sizeSortOrder('5XL'));
    expect(sizeSortOrder(null)).toBeGreaterThan(sizeSortOrder('5XL'));
  });
});

describe('style code', () => {
  it('prefers the code the business already uses on a cutting ticket', () => {
    expect(styleCodeFor({ firstVariantSku: 'W/2769-L-49295244427434', handle: 'some-slug' }))
      .toBe('W/2769');
  });

  it('falls back to the handle, which is unique per store', () => {
    expect(styleCodeFor({ firstVariantSku: null, handle: 'ivory-silk-kurta' }))
      .toBe('ivory-silk-kurta');
  });

  it('falls back to the product id when there is no handle either', () => {
    expect(styleCodeFor({ productGid: 'gid://shopify/Product/12345' })).toBe('SHOPIFY-12345');
  });

  it('refuses when there is nothing to file it under', () => {
    expect(() => styleCodeFor({})).toThrow(ValidationError);
  });
});

describe('product status', () => {
  it('maps archived to discontinued, not draft', () => {
    // It was live once and may still have stock and open orders, which is a
    // different thing from something never published.
    expect(productStatusFrom('ARCHIVED')).toBe('DISCONTINUED');
    expect(productStatusFrom('ACTIVE')).toBe('ACTIVE');
    expect(productStatusFrom('DRAFT')).toBe('DRAFT');
    expect(productStatusFrom(null)).toBe('DRAFT');
  });
});
