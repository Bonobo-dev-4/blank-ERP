import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal, amount, diffBomVersions, explodeBom, qty, rate,
  type BomItemInput, type BomVersionInput, type ProductionDemandLine, type UomCode,
} from '@dnd/domain';
import type {
  CreateBomRequest, CreateBomVersionRequest, DecideBomVersionRequest,
  ExplodeBomRequest, UpdateBomVersionRequest,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';

/** Everything the domain explosion needs, loaded in one query. */
const VERSION_INCLUDE = {
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, purchaseRate: true, averageCost: true } },
      productionStage: { select: { id: true, code: true, name: true } },
      sizeOverrides: { orderBy: { size: 'asc' } },
      alternatives: {
        orderBy: { preferenceOrder: 'asc' },
        include: { rawMaterial: { select: { id: true, materialCode: true, name: true } } },
      },
    },
  },
} satisfies Prisma.BomVersionInclude;

type LoadedVersion = Prisma.BomVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

/**
 * Bills of material.
 *
 * The rule that shapes this whole service: **an approved BOM version is
 * immutable.** Editing one would silently rewrite the recipe of every order
 * already costed against it. A change is therefore always a new version, and
 * approving it supersedes its predecessor rather than replacing it, so the
 * history of what each order was actually built to stays readable.
 *
 * Released manufacturing orders do not even read this table — they read their
 * own frozen `MoBomSnapshotLine` rows. See `ManufacturingService.release`.
 */
@Injectable()
export class BomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async list(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string;
      search?: string; productId?: string; status?: string; rawMaterialId?: string;
    },
  ) {
    const where: Prisma.BomWhereInput = {
      organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { versions: { some: { status: query.status as never } } } : {}),
      ...(query.rawMaterialId
        ? { versions: { some: { items: { some: { rawMaterialId: query.rawMaterialId } } } } }
        : {}),
      ...(searchFilter(query.search, ['bomCode', 'name']) ?? {}),
    };

    const args = pageArgs(query, ['bomCode', 'createdAt'], 'bomCode');
    const [rows, total] = await Promise.all([
      this.prisma.bom.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: args.orderBy,
        include: {
          product: { select: { id: true, styleCode: true, name: true, category: true } },
          productVariant: { select: { id: true, sku: true, size: true, color: true } },
          versions: {
            orderBy: { version: 'desc' },
            select: {
              id: true, version: true, status: true, baseQuantity: true,
              plannedUnitCost: true, approvedAt: true, createdAt: true,
              _count: { select: { items: true } },
            },
          },
        },
      }),
      this.prisma.bom.count({ where }),
    ]);

    // The question a BOM list has to answer is "can this style be produced?",
    // which is about the approved version, not about the newest draft.
    const data = rows.map((bom) => ({
      ...bom,
      approvedVersion: bom.versions.find((v) => v.status === 'APPROVED') ?? null,
      latestVersion: bom.versions[0] ?? null,
      versionCount: bom.versions.length,
    }));

    return paginated(data, total, query);
  }

  /** Every version across every BOM — the revision history screen. */
  async listVersions(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string;
      search?: string; bomId?: string; status?: string;
    },
  ) {
    const where: Prisma.BomVersionWhereInput = {
      organizationId,
      ...(query.bomId ? { bomId: query.bomId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            bom: {
              OR: [
                { bomCode: { contains: query.search, mode: 'insensitive' } },
                { product: { styleCode: { contains: query.search, mode: 'insensitive' } } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bomVersion.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          bom: {
            select: {
              id: true, bomCode: true, name: true,
              product: { select: { id: true, styleCode: true, name: true } },
              productVariant: { select: { id: true, sku: true } },
            },
          },
          supersededBy: { select: { id: true, version: true } },
          _count: { select: { items: true, manufacturingOrders: true } },
        },
      }),
      this.prisma.bomVersion.count({ where }),
    ]);

    return paginated(rows, total, query);
  }

  async get(organizationId: string, id: string) {
    const bom = await this.prisma.bom.findFirst({
      where: { id, organizationId },
      include: {
        product: { select: { id: true, styleCode: true, name: true, category: true } },
        productVariant: { select: { id: true, sku: true, size: true, color: true } },
        versions: { orderBy: { version: 'desc' }, include: VERSION_INCLUDE },
      },
    });
    if (!bom) throw new NotFoundException({ code: 'BOM_NOT_FOUND', message: 'BOM not found' });

    return {
      ...bom,
      versions: bom.versions.map((v) => this.decorateVersion(v)),
      approvedVersionId: bom.versions.find((v) => v.status === 'APPROVED')?.id ?? null,
    };
  }

  async getVersion(organizationId: string, versionId: string) {
    const version = await this.loadVersion(organizationId, versionId);
    return this.decorateVersion(version);
  }

  /**
   * Compare two versions.
   *
   * Shown before approving a revision, because the question a BOM approver
   * actually has is "what changed?", and answering it by reading forty lines
   * twice is how a wrong consumption figure gets approved.
   */
  async diff(organizationId: string, fromVersionId: string, toVersionId: string) {
    const [from, to] = await Promise.all([
      this.loadVersion(organizationId, fromVersionId),
      this.loadVersion(organizationId, toVersionId),
    ]);
    if (from.bomId !== to.bomId) {
      throw new BadRequestException({
        code: 'BOM_DIFF_ACROSS_BOMS',
        message: 'Both versions must belong to the same BOM',
        details: { fromBomId: from.bomId, toBomId: to.bomId },
      });
    }

    const names = new Map<string, { materialCode: string; materialName: string }>();
    for (const v of [from, to]) {
      for (const i of v.items) {
        names.set(i.rawMaterialId, { materialCode: i.rawMaterial.materialCode, materialName: i.rawMaterial.name });
      }
    }

    const lines = diffBomVersions(this.toDomain(from), this.toDomain(to)).map((d) => ({
      ...names.get(d.rawMaterialId),
      rawMaterialId: d.rawMaterialId,
      change: d.change,
      fromConsumptionQty: d.fromConsumptionQty?.toFixed(4) ?? null,
      toConsumptionQty: d.toConsumptionQty?.toFixed(4) ?? null,
      fromGrossPerUnit: d.fromGrossPerUnit?.toFixed(4) ?? null,
      toGrossPerUnit: d.toGrossPerUnit?.toFixed(4) ?? null,
    }));

    return {
      from: { id: from.id, version: from.version, status: from.status },
      to: { id: to.id, version: to.version, status: to.status },
      lines,
      changedCount: lines.filter((l) => l.change !== 'UNCHANGED').length,
    };
  }

  /**
   * Explode a version against a size-wise demand.
   *
   * Read-only: this is the preview a planner uses before committing to an
   * order. The figures a released order is costed against come from the
   * snapshot written at release, not from here.
   */
  async explode(organizationId: string, versionId: string, body: ExplodeBomRequest) {
    const version = await this.loadVersion(organizationId, versionId);

    const demand: ProductionDemandLine[] = body.demand.map((d) => ({
      productVariantId: d.productVariantId ?? undefined,
      size: d.size ?? null,
      quantity: d.quantity,
    }));

    const result = explodeBom(this.toDomain(version), demand, {
      requireApproved: !body.allowUnapproved,
    });

    return {
      bomVersionId: result.bomVersionId,
      bomVersion: result.bomVersion,
      status: version.status,
      plannedQty: result.plannedQty.toFixed(4),
      totalMaterialCost: result.totalMaterialCost.toFixed(2),
      costPerUnit: result.costPerUnit.toFixed(6),
      requirements: result.requirements.map((r) => ({
        rawMaterialId: r.rawMaterialId,
        materialCode: r.materialCode,
        materialName: r.materialName,
        uom: r.uom,
        productionStageCode: r.productionStageCode,
        netRequiredQty: r.netRequiredQty.toFixed(4),
        wastageQty: r.wastageQty.toFixed(4),
        grossRequiredQty: r.grossRequiredQty.toFixed(4),
        unitCost: r.unitCost.toFixed(6),
        estimatedCost: r.estimatedCost.toFixed(2),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // writes
  // -------------------------------------------------------------------------

  async create(organizationId: string, actorUserId: string, body: CreateBomRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: body.productId, organizationId },
        select: { id: true, styleCode: true },
      });
      if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

      if (body.productVariantId) {
        const variant = await tx.productVariant.findFirst({
          where: { id: body.productVariantId, organizationId, productId: body.productId },
          select: { id: true },
        });
        if (!variant) {
          throw new BadRequestException({
            code: 'VARIANT_NOT_IN_PRODUCT',
            message: 'That SKU does not belong to this product',
            details: { productId: body.productId, productVariantId: body.productVariantId },
          });
        }
      }

      // The schema allows at most one BOM per (product, variant) scope, so a
      // duplicate is a conflict with a real explanation rather than a raw
      // unique-constraint error.
      const clash = await tx.bom.findFirst({
        where: { organizationId, productId: body.productId, productVariantId: body.productVariantId ?? null },
        select: { id: true, bomCode: true },
      });
      if (clash) {
        throw new ConflictException({
          code: 'BOM_ALREADY_EXISTS',
          message: body.productVariantId
            ? 'This SKU already has a BOM; add a version to it instead'
            : 'This style already has a style-level BOM; add a version to it instead',
          details: { bomId: clash.id, bomCode: clash.bomCode },
        });
      }

      await this.assertMaterialsExist(tx, organizationId, body.items.map((i) => i.rawMaterialId));
      await this.assertAlternativesExist(tx, organizationId, body.items);

      const bomCode = body.bomCode ?? (await this.numbering.next(tx, organizationId, DOC_SCOPES.BOM));

      const bom = await tx.bom.create({
        data: {
          organizationId,
          bomCode,
          name: body.name ?? `${product.styleCode} bill of materials`,
          productId: body.productId,
          productVariantId: body.productVariantId ?? null,
          notes: body.notes ?? null,
        },
      });

      const version = await this.writeVersion(tx, {
        organizationId,
        bomId: bom.id,
        version: 1,
        baseQuantity: body.baseQuantity,
        items: body.items,
        createdByUserId: actorUserId,
        changeNote: 'Initial version',
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE', entityType: 'Bom', entityId: bom.id,
          context: { bomCode, productId: body.productId, lineCount: body.items.length },
        },
        tx,
      );

      return this.decorateVersion(
        await tx.bomVersion.findUniqueOrThrow({ where: { id: version.id }, include: VERSION_INCLUDE }),
      );
    });
  }

  /** Start a new draft version, cloning an existing one unless lines are given. */
  async createVersion(
    organizationId: string,
    actorUserId: string,
    bomId: string,
    body: CreateBomVersionRequest,
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const bom = await tx.bom.findFirst({
        where: { id: bomId, organizationId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true } } },
      });
      if (!bom) throw new NotFoundException({ code: 'BOM_NOT_FOUND', message: 'BOM not found' });

      // Only one draft at a time. Two concurrent drafts of the same BOM is a
      // merge problem nobody wants to resolve by hand at approval time.
      const openDraft = await tx.bomVersion.findFirst({
        where: { bomId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
        select: { id: true, version: true, status: true },
      });
      if (openDraft) {
        throw new ConflictException({
          code: 'BOM_DRAFT_ALREADY_OPEN',
          message: `Version ${openDraft.version} is still ${openDraft.status}; finish or reject it first`,
          details: { bomVersionId: openDraft.id, version: openDraft.version, status: openDraft.status },
        });
      }

      const sourceId = body.basedOnVersionId ?? bom.versions[0]?.id ?? null;
      const source = sourceId ? await this.loadVersion(organizationId, sourceId, tx) : null;
      if (sourceId && !source) {
        throw new NotFoundException({ code: 'BOM_VERSION_NOT_FOUND', message: 'Source version not found' });
      }

      const items = body.items ?? (source ? this.cloneItems(source) : null);
      if (!items || items.length === 0) {
        throw new BadRequestException({
          code: 'BOM_EMPTY',
          message: 'Provide material lines, or base the version on one that has them',
        });
      }
      await this.assertMaterialsExist(tx, organizationId, items.map((i) => i.rawMaterialId));
      await this.assertAlternativesExist(tx, organizationId, items);

      const nextVersion = (bom.versions[0]?.version ?? 0) + 1;
      const created = await this.writeVersion(tx, {
        organizationId,
        bomId,
        version: nextVersion,
        baseQuantity: body.baseQuantity ?? (source ? source.baseQuantity.toFixed() : '1'),
        items,
        createdByUserId: actorUserId,
        changeNote: body.changeNote ?? null,
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE', entityType: 'BomVersion', entityId: created.id,
          context: { bomId, version: nextVersion, basedOn: sourceId, lineCount: items.length },
        },
        tx,
      );

      return this.decorateVersion(
        await tx.bomVersion.findUniqueOrThrow({ where: { id: created.id }, include: VERSION_INCLUDE }),
      );
    });
  }

  async updateVersion(
    organizationId: string,
    actorUserId: string,
    versionId: string,
    body: UpdateBomVersionRequest,
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const version = await tx.bomVersion.findFirst({
        where: { id: versionId, bom: { organizationId } },
        select: { id: true, bomId: true, version: true, status: true, baseQuantity: true },
      });
      if (!version) throw new NotFoundException({ code: 'BOM_VERSION_NOT_FOUND', message: 'BOM version not found' });

      if (version.status !== 'DRAFT') {
        throw new ConflictException({
          code: 'BOM_VERSION_FROZEN',
          message: `Version ${version.version} is ${version.status} and can no longer be edited. Create a new version instead.`,
          details: { status: version.status, version: version.version },
        });
      }

      await this.assertMaterialsExist(tx, organizationId, body.items.map((i) => i.rawMaterialId));
      await this.assertAlternativesExist(tx, organizationId, body.items);

      // Lines are replaced wholesale rather than patched. A BOM editor sends
      // the whole table, and reconciling partial line edits against an older
      // client view is a source of silent loss.
      await tx.bomItem.deleteMany({ where: { bomVersionId: versionId } });
      await this.writeItems(tx, versionId, body.items);

      const totals = await this.recomputeVersionCost(tx, versionId);
      await tx.bomVersion.update({
        where: { id: versionId },
        data: {
          baseQuantity: new Prisma.Decimal(body.baseQuantity ?? version.baseQuantity.toFixed()),
          changeNote: body.changeNote ?? undefined,
          plannedUnitCost: new Prisma.Decimal(totals.unitCost),
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'UPDATE', entityType: 'BomVersion', entityId: versionId,
          context: { version: version.version, lineCount: body.items.length },
        },
        tx,
      );

      return this.decorateVersion(
        await tx.bomVersion.findUniqueOrThrow({ where: { id: versionId }, include: VERSION_INCLUDE }),
      );
    });
  }

  async submitVersion(organizationId: string, actorUserId: string, versionId: string) {
    return this.prisma.inTransaction(async (tx) => {
      const version = await tx.bomVersion.findFirst({
        where: { id: versionId, bom: { organizationId } },
        select: { id: true, status: true, version: true, _count: { select: { items: true } } },
      });
      if (!version) throw new NotFoundException({ code: 'BOM_VERSION_NOT_FOUND', message: 'BOM version not found' });
      if (version.status !== 'DRAFT') {
        throw new ConflictException({
          code: 'BOM_NOT_DRAFT',
          message: `Version ${version.version} is ${version.status}`,
          details: { status: version.status },
        });
      }
      if (version._count.items === 0) {
        throw new BadRequestException({ code: 'BOM_EMPTY', message: 'A BOM with no material lines cannot be approved' });
      }

      await tx.bomVersion.update({ where: { id: versionId }, data: { status: 'PENDING_APPROVAL' } });
      await this.audit.record(
        {
          organizationId, actorUserId, action: 'SUBMIT', entityType: 'BomVersion', entityId: versionId,
          context: { version: version.version },
        },
        tx,
      );

      return this.decorateVersion(
        await tx.bomVersion.findUniqueOrThrow({ where: { id: versionId }, include: VERSION_INCLUDE }),
      );
    });
  }

  /**
   * Approve or reject a pending version.
   *
   * Approval supersedes the previously approved version rather than deleting
   * it: orders released against the old one keep a readable lineage, and the
   * `supersededById` chain is what the BOM history screen walks.
   */
  async decideVersion(
    organizationId: string,
    actorUserId: string,
    versionId: string,
    body: DecideBomVersionRequest,
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const version = await tx.bomVersion.findFirst({
        where: { id: versionId, bom: { organizationId } },
        include: { bom: { select: { id: true, productId: true, productVariantId: true } } },
      });
      if (!version) throw new NotFoundException({ code: 'BOM_VERSION_NOT_FOUND', message: 'BOM version not found' });
      if (version.status !== 'PENDING_APPROVAL') {
        throw new ConflictException({
          code: 'BOM_NOT_PENDING_APPROVAL',
          message: `Version ${version.version} is ${version.status} and is not awaiting approval`,
          details: { status: version.status },
        });
      }

      if (body.decision === 'REJECT') {
        await tx.bomVersion.update({
          where: { id: versionId },
          data: { status: 'DRAFT', changeNote: body.note ?? version.changeNote },
        });
        await this.audit.record(
          {
            organizationId, actorUserId, action: 'REJECT', entityType: 'BomVersion', entityId: versionId,
            context: { version: version.version, note: body.note ?? null },
          },
          tx,
        );
        return this.decorateVersion(
          await tx.bomVersion.findUniqueOrThrow({ where: { id: versionId }, include: VERSION_INCLUDE }),
        );
      }

      const previous = await tx.bomVersion.findFirst({
        where: { bomId: version.bomId, status: 'APPROVED' },
        select: { id: true, version: true },
      });

      if (previous) {
        await tx.bomVersion.update({
          where: { id: previous.id },
          data: { status: 'SUPERSEDED', supersededById: versionId, effectiveTo: new Date() },
        });
      }

      const totals = await this.recomputeVersionCost(tx, versionId);
      await tx.bomVersion.update({
        where: { id: versionId },
        data: {
          status: 'APPROVED',
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
          effectiveFrom: new Date(),
          plannedUnitCost: new Prisma.Decimal(totals.unitCost),
        },
      });

      if (body.setActive) {
        // Point the covered variants at this version. A variant-scoped BOM
        // covers one SKU; a style-level BOM covers every variant that does not
        // have its own.
        const variantWhere: Prisma.ProductVariantWhereInput = version.bom.productVariantId
          ? { id: version.bom.productVariantId }
          : {
              productId: version.bom.productId,
              organizationId,
              // Leave SKUs that have their own BOM alone: a SKU-specific
              // recipe is more specific than the style default and must win.
              boms: { none: {} },
            };
        await tx.productVariant.updateMany({
          where: variantWhere,
          data: { activeBomVersionId: versionId },
        });
      }

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'APPROVE', entityType: 'BomVersion', entityId: versionId,
          context: {
            version: version.version,
            supersededVersion: previous?.version ?? null,
            setActive: body.setActive,
            plannedUnitCost: totals.unitCost,
          },
        },
        tx,
      );

      return this.decorateVersion(
        await tx.bomVersion.findUniqueOrThrow({ where: { id: versionId }, include: VERSION_INCLUDE }),
      );
    });
  }

  // -------------------------------------------------------------------------
  // helpers shared with the manufacturing module
  // -------------------------------------------------------------------------

  /**
   * The BOM version that should drive production of a variant.
   *
   * Resolution order is most-specific-first: the SKU's own active version, then
   * the SKU's own approved BOM, then the style-level approved BOM. Returning
   * null rather than throwing lets the caller report *which* SKU has no recipe,
   * which is the only actionable form of that error.
   */
  async resolveBomVersionId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productId: string,
    productVariantId: string,
  ): Promise<string | null> {
    const variant = await tx.productVariant.findFirst({
      where: { id: productVariantId, organizationId },
      select: { activeBomVersionId: true, activeBomVersion: { select: { status: true } } },
    });
    if (variant?.activeBomVersionId && variant.activeBomVersion?.status === 'APPROVED') {
      return variant.activeBomVersionId;
    }

    const scoped = await tx.bomVersion.findFirst({
      where: { status: 'APPROVED', bom: { organizationId, productId, productVariantId } },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (scoped) return scoped.id;

    const styleLevel = await tx.bomVersion.findFirst({
      where: { status: 'APPROVED', bom: { organizationId, productId, productVariantId: null } },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    return styleLevel?.id ?? null;
  }

  /** Load a version in the shape `explodeBom` expects. */
  async loadForExplosion(
    tx: Prisma.TransactionClient,
    organizationId: string,
    versionId: string,
  ): Promise<{ domain: BomVersionInput; criticality: Record<string, boolean> }> {
    const version = await tx.bomVersion.findFirst({
      where: { id: versionId, bom: { organizationId } },
      include: VERSION_INCLUDE,
    });
    if (!version) {
      throw new NotFoundException({ code: 'BOM_VERSION_NOT_FOUND', message: 'BOM version not found' });
    }
    return {
      domain: this.toDomain(version),
      criticality: Object.fromEntries(version.items.map((i) => [i.rawMaterialId, i.isCritical])),
    };
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  /**
   * Load a version, optionally on a caller's transaction.
   *
   * The `client` parameter is not a convenience. Reading from the pool while a
   * transaction is open takes a SECOND connection, which deadlocks against its
   * own transaction on a single-connection pool — and even on a large pool it
   * reads outside the transaction's snapshot, so it cannot see the rows that
   * transaction has just written.
   */
  private async loadVersion(
    organizationId: string,
    versionId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<LoadedVersion> {
    const version = await client.bomVersion.findFirst({
      where: { id: versionId, bom: { organizationId } },
      include: VERSION_INCLUDE,
    });
    if (!version) throw new NotFoundException({ code: 'BOM_VERSION_NOT_FOUND', message: 'BOM version not found' });
    return version;
  }

  /** Map a persisted version into the framework-free shape the domain uses. */
  private toDomain(version: LoadedVersion): BomVersionInput {
    return {
      id: version.id,
      version: version.version,
      status: version.status,
      baseQuantity: version.baseQuantity.toFixed(),
      items: version.items.map<BomItemInput>((i) => ({
        id: i.id,
        lineNo: i.lineNo,
        rawMaterialId: i.rawMaterialId,
        materialCode: i.rawMaterial.materialCode,
        materialName: i.rawMaterial.name,
        consumptionQty: i.consumptionQty.toFixed(),
        uom: i.uom as UomCode,
        wastageBasis: i.wastageBasis,
        wastageValue: i.wastageValue.toFixed(),
        // Fall back to the material's standard cost so a BOM without explicit
        // rates still produces a cost, rather than silently costing zero.
        unitCost: (i.unitCost ?? i.rawMaterial.purchaseRate ?? i.rawMaterial.averageCost)?.toFixed() ?? null,
        productionStageId: i.productionStageId,
        productionStageCode: i.productionStage?.code ?? null,
        sizeOverrides: Object.fromEntries(i.sizeOverrides.map((s) => [s.size, s.consumptionQty.toFixed()])),
      })),
    };
  }

  /** Add the computed figures the UI needs without recomputing them client-side. */
  private decorateVersion(version: LoadedVersion) {
    const base = qty(version.baseQuantity.toFixed());
    let totalPerUnit = new Decimal(0);

    const items = version.items.map((i) => {
      const unitCost = rate((i.unitCost ?? i.rawMaterial.purchaseRate ?? i.rawMaterial.averageCost)?.toFixed() ?? '0');
      const grossPerUnit = qty(i.grossQtyPerUnit.toFixed());
      const lineCost = amount(grossPerUnit.times(unitCost));
      totalPerUnit = totalPerUnit.plus(lineCost);
      return {
        ...i,
        grossQtyPerUnit: grossPerUnit.toFixed(4),
        effectiveUnitCost: unitCost.toFixed(6),
        lineCostPerUnit: lineCost.toFixed(2),
        hasSizeOverrides: i.sizeOverrides.length > 0,
      };
    });

    return {
      ...version,
      baseQuantity: base.toFixed(4),
      items,
      itemCount: items.length,
      criticalItemCount: version.items.filter((i) => i.isCritical).length,
      materialCostPerUnit: amount(totalPerUnit).toFixed(2),
      isEditable: version.status === 'DRAFT',
      isProducible: version.status === 'APPROVED',
    };
  }

  /** Create a version row plus its lines, and cache the derived costs. */
  private async writeVersion(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string; bomId: string; version: number; baseQuantity: string;
      items: readonly BomLineShape[]; createdByUserId: string; changeNote: string | null;
    },
  ) {
    const version = await tx.bomVersion.create({
      data: {
        organizationId: input.organizationId,
        bomId: input.bomId,
        version: input.version,
        status: 'DRAFT',
        baseQuantity: new Prisma.Decimal(input.baseQuantity),
        createdByUserId: input.createdByUserId,
        changeNote: input.changeNote,
      },
      select: { id: true },
    });

    await this.writeItems(tx, version.id, input.items);
    const totals = await this.recomputeVersionCost(tx, version.id);
    await tx.bomVersion.update({
      where: { id: version.id },
      data: { plannedUnitCost: new Prisma.Decimal(totals.unitCost) },
    });
    return version;
  }

  private async writeItems(
    tx: Prisma.TransactionClient,
    bomVersionId: string,
    items: readonly BomLineShape[],
  ): Promise<void> {
    for (const item of items) {
      const created = await tx.bomItem.create({
        data: {
          bomVersionId,
          lineNo: item.lineNo,
          rawMaterialId: item.rawMaterialId,
          consumptionQty: new Prisma.Decimal(item.consumptionQty),
          uom: item.uom,
          wastageBasis: item.wastageBasis,
          wastageValue: new Prisma.Decimal(item.wastageValue),
          productionStageId: item.productionStageId ?? null,
          unitCost: item.unitCost != null ? new Prisma.Decimal(item.unitCost) : null,
          isCritical: item.isCritical,
          notes: item.notes ?? null,
        },
        select: { id: true },
      });

      if (item.sizeOverrides.length > 0) {
        await tx.bomItemSizeOverride.createMany({
          data: item.sizeOverrides.map((s) => ({
            bomItemId: created.id,
            size: s.size,
            consumptionQty: new Prisma.Decimal(s.consumptionQty),
          })),
        });
      }
      if (item.alternatives.length > 0) {
        await tx.bomItemAlternative.createMany({
          data: item.alternatives.map((a) => ({
            bomItemId: created.id,
            rawMaterialId: a.rawMaterialId,
            preferenceOrder: a.preferenceOrder,
            conversionFactor: new Prisma.Decimal(a.conversionFactor),
            notes: a.notes ?? null,
          })),
        });
      }
    }
  }

  /**
   * Recompute the cached per-unit gross quantity and line cost.
   *
   * These columns are a cache for display and for costing snapshots. They are
   * always derived here from the authoritative consumption and wastage values
   * by the same domain function the explosion uses, so the cache cannot drift
   * into saying something the explosion would not.
   */
  private async recomputeVersionCost(
    tx: Prisma.TransactionClient,
    versionId: string,
  ): Promise<{ unitCost: string }> {
    const version = await tx.bomVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: VERSION_INCLUDE,
    });

    // Explode one garment: the per-unit figures fall straight out, and they
    // come from the same code path a real order will use.
    const explosion = explodeBom(this.toDomain(version), [{ quantity: '1' }], { requireApproved: false });

    for (const req of explosion.requirements) {
      const item = version.items.find((i) => i.rawMaterialId === req.rawMaterialId);
      if (!item) continue;
      await tx.bomItem.update({
        where: { id: item.id },
        data: {
          grossQtyPerUnit: new Prisma.Decimal(req.grossRequiredQty.toFixed(4)),
          lineCost: new Prisma.Decimal(req.estimatedCost.toFixed(6)),
        },
      });
    }

    return { unitCost: explosion.totalMaterialCost.toFixed(6) };
  }

  private cloneItems(source: LoadedVersion): BomLineShape[] {
    return source.items.map((i) => ({
      lineNo: i.lineNo,
      rawMaterialId: i.rawMaterialId,
      consumptionQty: i.consumptionQty.toFixed(),
      uom: i.uom,
      wastageBasis: i.wastageBasis,
      wastageValue: i.wastageValue.toFixed(),
      productionStageId: i.productionStageId,
      unitCost: i.unitCost?.toFixed() ?? null,
      isCritical: i.isCritical,
      notes: i.notes,
      alternatives: i.alternatives.map((a) => ({
        rawMaterialId: a.rawMaterialId,
        preferenceOrder: a.preferenceOrder,
        conversionFactor: a.conversionFactor.toFixed(),
        notes: a.notes,
      })),
      sizeOverrides: i.sizeOverrides.map((s) => ({ size: s.size, consumptionQty: s.consumptionQty.toFixed() })),
    }));
  }

  private async assertMaterialsExist(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(ids)];
    const found = await tx.rawMaterial.findMany({
      where: { id: { in: unique }, organizationId },
      select: { id: true },
    });
    if (found.length === unique.length) return;
    const known = new Set(found.map((m) => m.id));
    throw new BadRequestException({
      code: 'RAW_MATERIAL_NOT_FOUND',
      message: 'One or more BOM lines reference a material that does not exist',
      details: { missingIds: unique.filter((id) => !known.has(id)) },
    });
  }

  private async assertAlternativesExist(
    tx: Prisma.TransactionClient,
    organizationId: string,
    items: readonly BomLineShape[],
  ): Promise<void> {
    const ids = items.flatMap((i) => i.alternatives.map((a) => a.rawMaterialId));
    if (ids.length === 0) return;
    await this.assertMaterialsExist(tx, organizationId, ids);
  }
}

/** The line shape both the contract and the clone path produce. */
interface BomLineShape {
  lineNo: number;
  rawMaterialId: string;
  consumptionQty: string;
  uom: UomCode;
  wastageBasis: 'PERCENT_OF_CONSUMPTION' | 'FIXED_PER_UNIT' | 'FIXED_PER_ORDER' | 'NONE';
  wastageValue: string;
  productionStageId?: string | null;
  unitCost?: string | null;
  isCritical: boolean;
  notes?: string | null;
  alternatives: readonly {
    rawMaterialId: string;
    preferenceOrder: number;
    conversionFactor: string;
    notes?: string | null;
  }[];
  sizeOverrides: readonly { size: string; consumptionQty: string }[];
}
