import { Injectable, Logger } from '@nestjs/common';
import {
  colourFromOptions, parseShopifySku, productStatusFrom, sizeFromOptions,
  sizeSortOrder, styleCodeFor,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { ShopifyClient } from './shopify.client';

const PRODUCTS_QUERY = `
  query ImportProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id title handle status vendor productType tags updatedAt
          featuredImage { url }
          variants(first: 100) {
            edges {
              node {
                id sku title barcode price
                selectedOptions { name value }
                inventoryItem { id }
              }
            }
          }
        }
      }
    }
  }
`;

interface VariantNode {
  id: string; sku: string | null; title: string | null; barcode: string | null;
  price: string | null;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { id: string } | null;
}
interface ProductNode {
  id: string; title: string; handle: string; status: string;
  vendor: string | null; productType: string | null; tags: string[]; updatedAt: string;
  featuredImage: { url: string } | null;
  variants: { edges: { node: VariantNode }[] };
}
interface ProductsResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: ProductNode }[];
  };
}

/**
 * Pulling the catalogue from Shopify.
 *
 * Shopify is where a garment is created, so it is the source of truth for what
 * exists and what it is called. The ERP mirrors that rather than maintaining a
 * second catalogue someone has to keep in step by hand.
 *
 * Every variant gets an `ExternalProductMapping`, which is what makes an
 * imported ORDER line resolve to a real product. Without this import, order
 * lines arrive unmapped and their demand can never reach manufacturing — which
 * is exactly the state the system was in before this existed.
 */
@Injectable()
export class ShopifyProductService {
  private readonly logger = new Logger(ShopifyProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ShopifyClient,
    private readonly idempotency: IdempotencyService,
  ) {}

  async importProducts(
    organizationId: string,
    body: { idempotencyKey: string; limit?: number; activeOnly?: boolean },
  ) {
    return this.idempotency.execute(
      {
        organizationId, scope: 'shopify.products.import',
        key: body.idempotencyKey, payload: body, entityType: 'Product',
      },
      async () => {
        const pageSize = Math.min(100, Math.max(1, body.limit ?? 50));
        // Shopify's own search syntax; `status:active` is documented.
        const filter = body.activeOnly === false ? undefined : 'status:active';

        let after: string | null = null;
        let pages = 0;
        let productsSeen = 0;
        let productsCreated = 0;
        let productsUpdated = 0;
        let variantsCreated = 0;
        let variantsUpdated = 0;
        let mappingsWritten = 0;
        const skippedNoSku: string[] = [];
        const duplicateBarcodes: string[] = [];
        const failures: { title: string; handle: string; reason: string }[] = [];

        do {
          const data: ProductsResponse = await this.client.query<ProductsResponse>(
            PRODUCTS_QUERY,
            { first: pageSize, after, query: filter },
            // Products with 100 variants are expensive; pace accordingly.
            { estimatedCost: pageSize * 12 },
          );
          pages += 1;

          const nodes = data.products.edges.map((e) => e.node);
          productsSeen += nodes.length;
          try {
            const outcome = await this.upsertPage(organizationId, nodes, skippedNoSku, duplicateBarcodes);
            productsCreated += outcome.productsCreated;
            productsUpdated += outcome.productsUpdated;
            variantsCreated += outcome.variantsCreated;
            variantsUpdated += outcome.variantsUpdated;
            mappingsWritten += outcome.mappingsWritten;
          } catch (error) {
            // One unimportable page must not abort a catalogue of hundreds.
            // The work is idempotent, so re-running finishes what this missed.
            failures.push({
              title: `page ${pages}`,
              handle: nodes[0]?.handle ?? '',
              reason: errorText(error),
            });
          }

          after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
        } while (after);

        this.logger.log(
          `Shopify catalogue: ${productsSeen} products, ${variantsCreated + variantsUpdated} variants`,
        );

        return {
          result: {
            pages, productsSeen, productsCreated, productsUpdated,
            variantsCreated, variantsUpdated, mappingsWritten,
            // A variant with no SKU cannot be matched to an order line or to
            // Unicommerce, so it is reported rather than silently imported.
            skippedNoSku: skippedNoSku.slice(0, 50),
            skippedNoSkuCount: skippedNoSku.length,
            // Shopify allows two variants to share a barcode; this schema does
            // not. The variant is still imported, without the barcode, and
            // listed here - dropping the whole product over a duplicate
            // barcode would lose a garment to fix a label.
            duplicateBarcodes: duplicateBarcodes.slice(0, 50),
            duplicateBarcodeCount: duplicateBarcodes.length,
            failures: failures.slice(0, 20),
            failureCount: failures.length,
          },
          entityId: null,
        };
      },
    );
  }

  /**
   * Write one page of products.
   *
   * Deliberately NOT a transaction per product with three queries per variant.
   * That shape issued thousands of round trips for a real catalogue and took
   * the development database down twice — PGlite serves one connection at a
   * time, and sustained transaction churn wedges it.
   *
   * Everything here is an upsert keyed on a unique constraint, so the work is
   * idempotent and a half-finished page is completed by running again. That
   * makes a wrapping transaction unnecessary, and lets existing rows be loaded
   * in bulk: a page of fifty products costs about five queries instead of
   * several hundred.
   */
  private async upsertPage(
    organizationId: string,
    nodes: ProductNode[],
    skippedNoSku: string[],
    duplicateBarcodes: string[],
  ) {
    const prepared = nodes.map((node) => {
      const variants = node.variants.edges.map((e) => e.node);
      return {
        node,
        variants,
        styleCode: styleCodeFor({
          firstVariantSku: variants[0]?.sku ?? null,
          handle: node.handle,
          productGid: node.id,
        }),
      };
    });

    const allSkus = prepared.flatMap((p) =>
      p.variants.map((v) => v.sku?.trim()).filter((x): x is string => !!x));

    // Three bulk reads for the whole page.
    const [existingProducts, existingVariants, barcodeOwners] = await Promise.all([
      this.prisma.product.findMany({
        where: { organizationId, styleCode: { in: prepared.map((p) => p.styleCode) } },
        select: { id: true, styleCode: true },
      }),
      this.prisma.productVariant.findMany({
        where: { organizationId, sku: { in: allSkus } },
        select: { id: true, sku: true },
      }),
      this.prisma.productVariant.findMany({
        where: { organizationId, barcode: { not: null } },
        select: { sku: true, barcode: true },
      }),
    ]);

    const productByStyle = new Map(existingProducts.map((p) => [p.styleCode, p.id] as const));
    const variantBySku = new Map(existingVariants.map((v) => [v.sku, v.id] as const));
    const barcodeOwner = new Map(
      barcodeOwners.filter((v) => v.barcode).map((v) => [v.barcode as string, v.sku] as const),
    );

    let productsCreated = 0;
    let productsUpdated = 0;
    let variantsCreated = 0;
    let variantsUpdated = 0;
    let mappingsWritten = 0;

    for (const { node, variants, styleCode } of prepared) {
      const data = {
        name: node.title,
        category: node.productType || null,
        // Shopify's `vendor` is used by this store as a department
        // (Womenswear / Menswear), not as a supplier.
        collection: node.vendor || null,
        status: productStatusFrom(node.status),
        imageUrl: node.featuredImage?.url ?? null,
      };

      let productId = productByStyle.get(styleCode);
      if (productId) {
        await this.prisma.product.update({ where: { id: productId }, data });
        productsUpdated += 1;
      } else {
        const created = await this.prisma.product.create({
          data: { organizationId, styleCode, ...data },
          select: { id: true },
        });
        productId = created.id;
        productByStyle.set(styleCode, productId);
        productsCreated += 1;
      }

      for (const v of variants) {
        const sku = v.sku?.trim();
        if (!sku) {
          skippedNoSku.push(`${node.title} — ${v.title ?? v.id}`);
          continue;
        }

        const parsed = parseShopifySku(sku);
        const size = sizeFromOptions(v.selectedOptions) ?? parsed?.size ?? null;

        // The barcode column is unique per organisation, but Shopify lets two
        // variants carry the same one. Claim it only if free; otherwise import
        // the variant without it and report the clash - losing a garment to
        // fix a label would be the wrong trade.
        const wanted = (v.barcode || parsed?.variantId || '').trim() || null;
        let barcode: string | null = null;
        if (wanted) {
          const owner = barcodeOwner.get(wanted);
          if (owner && owner !== sku) {
            duplicateBarcodes.push(`${sku} wanted ${wanted}, already on ${owner}`);
          } else {
            barcode = wanted;
            barcodeOwner.set(wanted, sku);
          }
        }

        const variantData = {
          barcode,
          name: v.title && v.title !== 'Default Title' ? v.title : null,
          color: colourFromOptions(v.selectedOptions),
          size,
          sizeSortOrder: sizeSortOrder(size),
          status: productStatusFrom(node.status),
          imageUrl: node.featuredImage?.url ?? null,
        };

        const existingId = variantBySku.get(sku);
        let variantId: string;
        if (existingId) {
          await this.prisma.productVariant.update({
            where: { id: existingId },
            // productId is reassigned too: a garment moved between Shopify
            // products should follow, not keep pointing at the old style.
            data: { ...variantData, productId },
          });
          variantId = existingId;
          variantsUpdated += 1;
        } else {
          const createdVariant = await this.prisma.productVariant.create({
            data: { organizationId, productId, sku, ...variantData },
            select: { id: true },
          });
          variantId = createdVariant.id;
          variantBySku.set(sku, variantId);
          variantsCreated += 1;
        }

        // Keyed on the Shopify variant GID, which is stable even when a SKU is
        // edited. That is what lets an order line carrying only the GID resolve.
        await this.prisma.externalProductMapping.upsert({
          where: {
            organizationId_provider_identifierKind_externalId: {
              organizationId, provider: 'SHOPIFY',
              identifierKind: 'VARIANT_GID', externalId: v.id,
            },
          },
          create: {
            organizationId, productVariantId: variantId, provider: 'SHOPIFY',
            identifierKind: 'VARIANT_GID', externalId: v.id, externalSku: sku,
            isPrimary: true, syncedAt: new Date(),
          },
          update: { productVariantId: variantId, externalSku: sku, syncedAt: new Date() },
        });
        mappingsWritten += 1;
      }
    }

    return { productsCreated, productsUpdated, variantsCreated, variantsUpdated, mappingsWritten };
  }

  /**
   * Attach imported order lines to the products they refer to.
   *
   * Run after a catalogue import: lines imported before the catalogue existed
   * are sitting unmapped, and nothing else goes back to fix them. Matched on
   * SKU, since Shopify and Unicommerce share the convention.
   */
  async relinkOrderLines(organizationId: string) {
    const unmapped = await this.prisma.shopifyOrderLine.findMany({
      where: { organizationId, productVariantId: null, externalSku: { not: null } },
      select: { id: true, externalSku: true, orderedQty: true, cancelledQty: true, fulfilledQty: true },
      take: 5000,
    });
    if (unmapped.length === 0) return { scanned: 0, linked: 0, stillUnmapped: 0 };

    const skus = [...new Set(unmapped.map((l) => l.externalSku as string))];
    const variants = await this.prisma.productVariant.findMany({
      where: { organizationId, sku: { in: skus } },
      select: { id: true, sku: true },
    });
    const bySku = new Map(variants.map((v) => [v.sku, v.id] as const));

    let linked = 0;
    for (const line of unmapped) {
      const variantId = bySku.get(line.externalSku as string);
      if (!variantId) continue;
      await this.prisma.shopifyOrderLine.update({
        where: { id: line.id },
        data: { productVariantId: variantId },
      });
      linked += 1;
    }

    return { scanned: unmapped.length, linked, stillUnmapped: unmapped.length - linked };
  }
}

/** The message an API error actually carries, rather than "[object Object]". */
function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const r = (error as { response?: { message?: string; code?: string } }).response;
    if (r?.message) return `${r.code ?? 'ERROR'}: ${r.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
