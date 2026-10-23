import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BundleComponentRequest, CreateProductRequest, CreateVariantRequest,
  GenerateVariantMatrixRequest, UpsertExternalMappingRequest,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';

/**
 * Product master.
 *
 * One canonical ProductVariant per SKU, with external identifiers held in
 * ExternalProductMapping rows. That is what stops the same SKU arriving from
 * Shopify and from Unicommerce creating two internal products: the SKU resolves
 * to one variant and each system's identifier is recorded against it.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listProducts(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      status?: string; collection?: string; category?: string;
    },
  ) {
    const where: Prisma.ProductWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.collection ? { collection: query.collection } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(searchFilter(query.search, ['styleCode', 'name', 'collection', 'category']) ?? {}),
    };
    const args = pageArgs(query, ['styleCode', 'name', 'createdAt', 'status'], 'styleCode');
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where, ...args,
        include: {
          _count: { select: { variants: true, boms: true } },
          defaultRoute: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async getProduct(organizationId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: {
        defaultRoute: true,
        variants: {
          orderBy: [{ color: 'asc' }, { sizeSortOrder: 'asc' }, { size: 'asc' }],
          include: {
            externalMappings: true,
            _count: { select: { bundleComponents: true } },
          },
        },
        boms: { include: { versions: { orderBy: { version: 'desc' }, take: 5 } } },
      },
    });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    return product;
  }

  async createProduct(organizationId: string, actorUserId: string, body: CreateProductRequest) {
    const created = await this.prisma.product.create({ data: { ...body, organizationId } });
    await this.audit.record({
      organizationId, actorUserId, action: 'CREATE',
      entityType: 'Product', entityId: created.id,
      diff: this.audit.diffOf(null, created as never),
    });
    return created;
  }

  async updateProduct(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: Partial<CreateProductRequest>,
  ) {
    const before = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!before) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    const after = await this.prisma.product.update({ where: { id }, data: body });
    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'Product', entityId: id,
      diff: this.audit.diffOf(before as never, after as never),
    });
    return after;
  }

  async listVariants(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      productId?: string; status?: string; unmappedProvider?: 'SHOPIFY' | 'UNICOMMERCE'; isBundle?: boolean;
    },
  ) {
    const where: Prisma.ProductVariantWhereInput = {
      organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.isBundle !== undefined ? { isBundle: query.isBundle } : {}),
      // The mapping-error dashboard: SKUs with no identifier for a provider
      // cannot take part in an order import or an inventory push.
      ...(query.unmappedProvider
        ? { externalMappings: { none: { provider: query.unmappedProvider } } }
        : {}),
      ...(searchFilter(query.search, ['sku', 'name', 'color', 'size', 'barcode']) ?? {}),
    };
    const args = pageArgs(query, ['sku', 'color', 'size', 'sizeSortOrder', 'createdAt'], 'sku');
    const [rows, total] = await Promise.all([
      this.prisma.productVariant.findMany({
        where, ...args,
        include: {
          product: { select: { id: true, styleCode: true, name: true, collection: true, productionType: true } },
          externalMappings: { select: { provider: true, identifierKind: true, externalId: true, externalSku: true, isPrimary: true } },
        },
      }),
      this.prisma.productVariant.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async createVariant(organizationId: string, actorUserId: string, body: CreateVariantRequest) {
    const product = await this.prisma.product.findFirst({
      where: { id: body.productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const created = await this.prisma.productVariant.create({
      data: { ...body, organizationId },
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'CREATE',
      entityType: 'ProductVariant', entityId: created.id,
      diff: this.audit.diffOf(null, created as never),
    });
    return created;
  }

  async updateVariant(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: Partial<Omit<CreateVariantRequest, 'productId'>>,
  ) {
    const before = await this.prisma.productVariant.findFirst({ where: { id, organizationId } });
    if (!before) throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Product variant not found' });
    const after = await this.prisma.productVariant.update({ where: { id }, data: body });
    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'ProductVariant', entityId: id,
      diff: this.audit.diffOf(before as never, after as never),
    });
    return after;
  }

  /**
   * Generate the colour x size SKU matrix for a style.
   *
   * A 6-size, 4-colour style is 24 SKUs; typing them one at a time is how
   * typos get into SKUs that then fail to map to Shopify. Existing SKUs are
   * skipped rather than erroring, so the call can be re-run after adding a
   * colour.
   */
  async generateMatrix(
    organizationId: string,
    actorUserId: string,
    body: GenerateVariantMatrixRequest,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: body.productId, organizationId },
      select: { id: true, styleCode: true, name: true },
    });
    if (!product) throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const existing = await this.prisma.productVariant.findMany({
      where: { productId: body.productId },
      select: { sku: true },
    });
    const existingSkus = new Set(existing.map((v) => v.sku));

    const created: { sku: string; color: string; size: string }[] = [];
    const skipped: string[] = [];

    await this.prisma.inTransaction(async (tx) => {
      for (const color of body.colors) {
        for (let s = 0; s < body.sizes.length; s += 1) {
          const size = body.sizes[s]!;
          const sku = body.skuPattern
            .replace('{STYLE}', product.styleCode)
            .replace('{COLOR}', slug(color))
            .replace('{SIZE}', slug(size))
            .toUpperCase();

          if (existingSkus.has(sku)) { skipped.push(sku); continue; }

          await tx.productVariant.create({
            data: {
              organizationId,
              productId: body.productId,
              sku,
              name: `${product.name} - ${color} / ${size}`,
              color,
              size,
              sizeSortOrder: s,
              status: body.status,
            },
          });
          existingSkus.add(sku);
          created.push({ sku, color, size });
        }
      }

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE',
          entityType: 'ProductVariant', entityId: body.productId,
          context: { styleCode: product.styleCode, createdCount: created.length, skippedCount: skipped.length },
        },
        tx,
      );
    });

    return { createdCount: created.length, created, skippedCount: skipped.length, skipped };
  }

  /** Record a Shopify or Unicommerce identifier against a canonical SKU. */
  async upsertMapping(
    organizationId: string,
    actorUserId: string,
    body: UpsertExternalMappingRequest,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: body.productVariantId, organizationId },
      select: { id: true, sku: true },
    });
    if (!variant) throw new BadRequestException({ code: 'VARIANT_NOT_FOUND', message: 'Product variant not found' });

    const row = await this.prisma.inTransaction(async (tx) => {
      if (body.isPrimary) {
        // At most one primary identifier per provider; enforced by a partial
        // unique index, so clear the old one first.
        await tx.externalProductMapping.updateMany({
          where: { productVariantId: body.productVariantId, provider: body.provider, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.externalProductMapping.upsert({
        where: {
          organizationId_provider_identifierKind_externalId: {
            organizationId,
            provider: body.provider,
            identifierKind: body.identifierKind,
            externalId: body.externalId,
          },
        },
        create: {
          organizationId,
          productVariantId: body.productVariantId,
          provider: body.provider,
          identifierKind: body.identifierKind,
          externalId: body.externalId,
          externalSku: body.externalSku ?? null,
          isPrimary: body.isPrimary,
        },
        update: {
          productVariantId: body.productVariantId,
          externalSku: body.externalSku ?? null,
          isPrimary: body.isPrimary,
          syncedAt: new Date(),
        },
      });
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'ExternalProductMapping', entityId: row.id,
      context: { sku: variant.sku, provider: body.provider, identifierKind: body.identifierKind, externalId: body.externalId },
    });
    return row;
  }

  /** Mapping gaps: SKUs that cannot take part in an import or a push. */
  async mappingIssues(organizationId: string) {
    const [unmappedShopify, unmappedUnicommerce, duplicateExternalIds, openSyncIssues] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { organizationId, status: 'ACTIVE', externalMappings: { none: { provider: 'SHOPIFY' } } },
        select: { id: true, sku: true, color: true, size: true, product: { select: { styleCode: true, name: true } } },
        take: 200,
      }),
      this.prisma.productVariant.findMany({
        where: { organizationId, status: 'ACTIVE', externalMappings: { none: { provider: 'UNICOMMERCE' } } },
        select: { id: true, sku: true, color: true, size: true, product: { select: { styleCode: true, name: true } } },
        take: 200,
      }),
      this.prisma.externalProductMapping.groupBy({
        by: ['provider', 'externalSku'],
        where: { organizationId, externalSku: { not: null } },
        having: { externalSku: { _count: { gt: 1 } } },
        _count: { externalSku: true },
      }),
      this.prisma.productSyncIssue.findMany({
        where: { organizationId, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        unmappedShopify: unmappedShopify.length,
        unmappedUnicommerce: unmappedUnicommerce.length,
        duplicateExternalSkus: duplicateExternalIds.length,
        openSyncIssues: openSyncIssues.length,
      },
      unmappedShopify,
      unmappedUnicommerce,
      duplicateExternalSkus: duplicateExternalIds,
      openSyncIssues,
    };
  }

  /** Define the component SKUs of a bundle (Set = Kurta + Pant + Dupatta). */
  async setBundleComponents(
    organizationId: string,
    actorUserId: string,
    body: BundleComponentRequest,
  ) {
    const bundle = await this.prisma.productVariant.findFirst({
      where: { id: body.bundleVariantId, organizationId },
      select: { id: true, sku: true },
    });
    if (!bundle) throw new BadRequestException({ code: 'VARIANT_NOT_FOUND', message: 'Bundle variant not found' });

    if (body.components.some((c) => c.componentVariantId === body.bundleVariantId)) {
      throw new BadRequestException({
        code: 'BUNDLE_SELF_REFERENCE',
        message: 'A bundle cannot contain itself',
      });
    }

    const components = await this.prisma.productVariant.findMany({
      where: { organizationId, id: { in: body.components.map((c) => c.componentVariantId) } },
      select: { id: true },
    });
    if (components.length !== body.components.length) {
      throw new BadRequestException({
        code: 'COMPONENT_NOT_FOUND',
        message: 'One or more component SKUs do not exist in this organisation',
      });
    }

    const rows = await this.prisma.inTransaction(async (tx) => {
      await tx.productBundleComponent.deleteMany({ where: { bundleVariantId: body.bundleVariantId } });
      await tx.productVariant.update({ where: { id: body.bundleVariantId }, data: { isBundle: true } });
      return Promise.all(
        body.components.map((c, idx) =>
          tx.productBundleComponent.create({
            data: {
              organizationId,
              bundleVariantId: body.bundleVariantId,
              componentVariantId: c.componentVariantId,
              qtyPerBundle: new Prisma.Decimal(c.qtyPerBundle),
              role: c.role,
              sequence: idx + 1,
              requiresManufacturing: c.requiresManufacturing,
            },
          }),
        ),
      );
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'ProductVariant', entityId: body.bundleVariantId,
      context: { sku: bundle.sku, componentCount: rows.length },
    });
    return rows;
  }
}

function slug(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
