import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateRawMaterialRequest, Paginated, UpsertUomConversionRequest,
} from '@dnd/contracts';
import {
  UomConverter, classifyStockLevel, computeStockPosition,
  type StockAlertLevel, type UomCode,
} from '@dnd/domain';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';
import type { materialListQuery } from '@dnd/contracts';

type MaterialListQuery = z.infer<typeof materialListQuery>;

const SORTABLE = ['materialCode', 'name', 'category', 'createdAt', 'updatedAt', 'averageCost'] as const;

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(organizationId: string, query: MaterialListQuery): Promise<Paginated<unknown>> {
    const where: Prisma.RawMaterialWhereInput = {
      organizationId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { defaultSupplierId: query.supplierId } : {}),
      ...(searchFilter(query.search, ['materialCode', 'name', 'color', 'fabricComposition']) ?? {}),
    };

    const args = pageArgs(query, SORTABLE, 'materialCode');
    const [rows, total] = await Promise.all([
      this.prisma.rawMaterial.findMany({
        where,
        ...args,
        include: {
          defaultSupplier: { select: { id: true, supplierCode: true, name: true } },
          defaultLocation: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.rawMaterial.count({ where }),
    ]);

    // Attach the live stock position so the list screen shows availability
    // without a second round trip per row.
    const positions = await this.stockPositions(
      organizationId,
      rows.map((r) => r.id),
    );

    let data = rows.map((r) => ({ ...r, stock: positions.get(r.id) ?? emptyPosition() }));

    if (query.belowReorderLevel) {
      data = data.filter((r) => r.stock.alertLevel !== 'OK');
    }

    return paginated(data, total, query);
  }

  async get(organizationId: string, id: string) {
    const material = await this.prisma.rawMaterial.findFirst({
      where: { id, organizationId },
      include: {
        defaultSupplier: { select: { id: true, supplierCode: true, name: true } },
        defaultLocation: { select: { id: true, code: true, name: true } },
        uomConversions: true,
        lots: {
          orderBy: { receivedAt: 'desc' },
          take: 50,
          include: { supplier: { select: { id: true, name: true } } },
        },
      },
    });
    if (!material) throw new NotFoundException({ code: 'MATERIAL_NOT_FOUND', message: 'Raw material not found' });

    const balances = await this.prisma.materialBalance.findMany({
      where: { rawMaterialId: id },
      include: { location: true, materialLot: { select: { id: true, lotCode: true, shade: true, width: true } } },
    });

    const position = computeStockPosition(
      balances.map((b) => ({
        rawMaterialId: b.rawMaterialId,
        materialLotId: b.materialLotId,
        location: { id: b.locationId, code: b.location.code, kind: b.location.kind as never, blocksIssue: b.location.blocksIssue },
        onHandQty: b.onHandQty.toFixed(),
        reservedQty: b.reservedQty.toFixed(),
      })),
    );

    return {
      ...material,
      stock: {
        onHandQty: position.onHandQty.toFixed(),
        issuableQty: position.issuableQty.toFixed(),
        reservedQty: position.reservedQty.toFixed(),
        availableQty: position.availableQty.toFixed(),
        qualityHoldQty: position.qualityHoldQty.toFixed(),
        blockedQty: position.blockedQty.toFixed(),
        withJobWorkerQty: position.withJobWorkerQty.toFixed(),
        inTransitQty: position.inTransitQty.toFixed(),
        issuedToProductionQty: position.issuedToProductionQty.toFixed(),
        alertLevel: classifyStockLevel({
          availableQty: position.availableQty,
          minimumStock: material.minimumStock.toFixed(),
          reorderLevel: material.reorderLevel.toFixed(),
        }),
      },
      balancesByLocation: balances
        .filter((b) => !b.onHandQty.isZero())
        .map((b) => ({
          locationId: b.locationId,
          locationCode: b.location.code,
          locationName: b.location.name,
          locationKind: b.location.kind,
          materialLotId: b.materialLotId,
          lotCode: b.materialLot.lotCode,
          shade: b.materialLot.shade,
          width: b.materialLot.width,
          onHandQty: b.onHandQty,
          reservedQty: b.reservedQty,
        })),
    };
  }

  async create(organizationId: string, actorUserId: string, body: CreateRawMaterialRequest) {
    const material = await this.prisma.inTransaction(async (tx) => {
      const created = await tx.rawMaterial.create({
        data: {
          ...(toMaterialData(body) as Prisma.RawMaterialUncheckedCreateInput),
          organizationId,
        },
      });

      // Every material gets an implicit GENERAL lot so the ledger shape stays
      // uniform: a movement always cites a lot, even for buttons nobody tracks
      // by batch. One partial unique index keeps it to exactly one per material.
      const lotCode = await this.numbering.next(tx, organizationId, DOC_SCOPES.MATERIAL_LOT);
      await tx.materialLot.create({
        data: {
          organizationId,
          rawMaterialId: created.id,
          lotCode: `${lotCode}-GENERAL`,
          isGeneral: true,
        },
      });

      await this.audit.record(
        {
          organizationId,
          actorUserId,
          action: 'CREATE',
          entityType: 'RawMaterial',
          entityId: created.id,
          diff: this.audit.diffOf(null, created as never),
        },
        tx,
      );
      return created;
    });
    return material;
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: Partial<CreateRawMaterialRequest>,
  ) {
    const before = await this.prisma.rawMaterial.findFirst({ where: { id, organizationId } });
    if (!before) throw new NotFoundException({ code: 'MATERIAL_NOT_FOUND', message: 'Raw material not found' });

    const after = await this.prisma.rawMaterial.update({
      where: { id },
      data: toMaterialData(body),
    });

    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'UPDATE',
      entityType: 'RawMaterial',
      entityId: id,
      diff: this.audit.diffOf(before as never, after as never),
    });
    return after;
  }

  /** Stock positions for many materials in one pass, for list screens. */
  async stockPositions(
    organizationId: string,
    materialIds: readonly string[],
  ): Promise<Map<string, StockPositionSummary>> {
    const map = new Map<string, StockPositionSummary>();
    if (materialIds.length === 0) return map;

    const [balances, materials] = await Promise.all([
      this.prisma.materialBalance.findMany({
        where: { organizationId, rawMaterialId: { in: [...materialIds] } },
        include: { location: { select: { id: true, code: true, kind: true, blocksIssue: true } } },
      }),
      this.prisma.rawMaterial.findMany({
        where: { organizationId, id: { in: [...materialIds] } },
        select: { id: true, minimumStock: true, reorderLevel: true },
      }),
    ]);

    const thresholds = new Map(materials.map((m) => [m.id, m]));
    const grouped = new Map<string, typeof balances>();
    for (const b of balances) {
      const list = grouped.get(b.rawMaterialId);
      if (list) list.push(b);
      else grouped.set(b.rawMaterialId, [b]);
    }

    for (const id of materialIds) {
      const rows = grouped.get(id) ?? [];
      const pos = computeStockPosition(
        rows.map((b) => ({
          rawMaterialId: b.rawMaterialId,
          materialLotId: b.materialLotId,
          location: { id: b.locationId, code: b.location.code, kind: b.location.kind as never, blocksIssue: b.location.blocksIssue },
          onHandQty: b.onHandQty.toFixed(),
          reservedQty: b.reservedQty.toFixed(),
        })),
      );
      const t = thresholds.get(id);
      map.set(id, {
        onHandQty: pos.onHandQty.toFixed(),
        issuableQty: pos.issuableQty.toFixed(),
        reservedQty: pos.reservedQty.toFixed(),
        availableQty: pos.availableQty.toFixed(),
        qualityHoldQty: pos.qualityHoldQty.toFixed(),
        blockedQty: pos.blockedQty.toFixed(),
        withJobWorkerQty: pos.withJobWorkerQty.toFixed(),
        inTransitQty: pos.inTransitQty.toFixed(),
        issuedToProductionQty: pos.issuedToProductionQty.toFixed(),
        alertLevel: classifyStockLevel({
          availableQty: pos.availableQty,
          minimumStock: t?.minimumStock.toFixed() ?? '0',
          reorderLevel: t?.reorderLevel.toFixed() ?? '0',
        }),
      });
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // units of measure
  // -------------------------------------------------------------------------

  async listConversions(organizationId: string, rawMaterialId?: string) {
    return this.prisma.uomConversion.findMany({
      where: {
        organizationId,
        ...(rawMaterialId ? { OR: [{ rawMaterialId }, { rawMaterialId: null }] } : {}),
      },
      include: { rawMaterial: { select: { id: true, materialCode: true, name: true } } },
      orderBy: [{ rawMaterialId: 'asc' }, { fromUom: 'asc' }],
    });
  }

  async upsertConversion(
    organizationId: string,
    actorUserId: string,
    body: UpsertUomConversionRequest,
  ) {
    // Prisma's compound-unique input cannot express a NULL member, and an
    // organisation-wide rule has rawMaterialId = NULL, so this is a find-then-
    // write rather than an upsert.
    const existing = await this.prisma.uomConversion.findFirst({
      where: {
        organizationId,
        rawMaterialId: body.rawMaterialId ?? null,
        fromUom: body.fromUom,
        toUom: body.toUom,
      },
      select: { id: true },
    });

    const row = existing
      ? await this.prisma.uomConversion.update({
          where: { id: existing.id },
          data: { factor: new Prisma.Decimal(body.factor), note: body.note ?? null },
        })
      : await this.prisma.uomConversion.create({
          data: {
            organizationId,
            rawMaterialId: body.rawMaterialId ?? null,
            fromUom: body.fromUom,
            toUom: body.toUom,
            factor: new Prisma.Decimal(body.factor),
            note: body.note ?? null,
          },
        });

    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'UPDATE',
      entityType: 'UomConversion',
      entityId: row.id,
      context: { fromUom: body.fromUom, toUom: body.toUom, factor: body.factor },
    });
    return row;
  }

  /**
   * Preview a conversion for the UI. Returns `convertible: false` rather than
   * throwing, so a form can grey out a unit the system cannot convert instead
   * of showing an error the user cannot act on.
   */
  async previewConversion(
    organizationId: string,
    input: { rawMaterialId?: string; fromUom: UomCode; toUom: UomCode; quantity: string },
  ) {
    const rules = await this.prisma.uomConversion.findMany({
      where: {
        organizationId,
        OR: [{ rawMaterialId: null }, ...(input.rawMaterialId ? [{ rawMaterialId: input.rawMaterialId }] : [])],
      },
    });
    const converter = new UomConverter(
      rules.map((r) => ({
        rawMaterialId: r.rawMaterialId,
        fromUom: r.fromUom as UomCode,
        toUom: r.toUom as UomCode,
        factor: r.factor.toFixed(),
      })),
    );
    if (!converter.canConvert(input.fromUom, input.toUom, input.rawMaterialId)) {
      return {
        convertible: false,
        reason: `No conversion from ${input.fromUom} to ${input.toUom} is configured${input.rawMaterialId ? ' for this material' : ''}`,
        convertedQty: null,
      };
    }
    return {
      convertible: true,
      reason: null,
      convertedQty: converter
        .convert(input.quantity, input.fromUom, input.toUom, input.rawMaterialId)
        .toFixed(),
    };
  }

  // -------------------------------------------------------------------------
  // lots
  // -------------------------------------------------------------------------

  async listLots(
    organizationId: string,
    query: { page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string; rawMaterialId?: string },
  ) {
    const where: Prisma.MaterialLotWhereInput = {
      organizationId,
      ...(query.rawMaterialId ? { rawMaterialId: query.rawMaterialId } : {}),
      ...(searchFilter(query.search, ['lotCode', 'supplierLotRef', 'shade']) ?? {}),
    };
    const args = pageArgs(query, ['lotCode', 'receivedAt', 'createdAt', 'shade'], 'receivedAt');
    const [rows, total] = await Promise.all([
      this.prisma.materialLot.findMany({
        where,
        ...args,
        include: {
          rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, category: true } },
          supplier: { select: { id: true, name: true } },
          balances: { select: { onHandQty: true, reservedQty: true, location: { select: { code: true, name: true, kind: true } } } },
          _count: { select: { fabricRolls: true } },
        },
      }),
      this.prisma.materialLot.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  /** Resolve the lot a movement should use, creating one when appropriate. */
  async resolveLotId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rawMaterialId: string,
    explicitLotId?: string | null,
  ): Promise<string> {
    if (explicitLotId) {
      const lot = await tx.materialLot.findFirst({
        where: { id: explicitLotId, organizationId, rawMaterialId },
        select: { id: true },
      });
      if (!lot) {
        throw new BadRequestException({
          code: 'LOT_NOT_FOUND',
          message: 'The specified material lot does not belong to this material',
          details: { materialLotId: explicitLotId, rawMaterialId },
        });
      }
      return lot.id;
    }

    const general = await tx.materialLot.findFirst({
      where: { organizationId, rawMaterialId, isGeneral: true },
      select: { id: true },
    });
    if (general) return general.id;

    const lotCode = await this.numbering.next(tx, organizationId, DOC_SCOPES.MATERIAL_LOT);
    const created = await tx.materialLot.create({
      data: { organizationId, rawMaterialId, lotCode: `${lotCode}-GENERAL`, isGeneral: true },
      select: { id: true },
    });
    return created.id;
  }
}

function toMaterialData(body: Partial<CreateRawMaterialRequest>): Prisma.RawMaterialUncheckedUpdateInput {
  const d: Record<string, unknown> = {};
  const copy = <K extends keyof CreateRawMaterialRequest>(k: K) => {
    if (body[k] !== undefined) d[k as string] = body[k];
  };
  (['materialCode', 'name', 'category', 'description', 'color', 'colorCode', 'fabricComposition',
    'widthUom', 'gsm', 'baseUom', 'purchaseUom', 'defaultSupplierId', 'leadTimeDays',
    'defaultLocationId', 'lotTracked', 'shadeTracked', 'status'] as const).forEach(copy);

  for (const k of ['width', 'purchaseRate', 'minimumStock', 'reorderLevel', 'reorderQty'] as const) {
    const v = body[k];
    if (v !== undefined) d[k] = v === null ? null : new Prisma.Decimal(v as string);
  }
  return d as Prisma.RawMaterialUncheckedUpdateInput;
}

interface StockPositionSummary {
  onHandQty: string;
  issuableQty: string;
  reservedQty: string;
  availableQty: string;
  qualityHoldQty: string;
  blockedQty: string;
  withJobWorkerQty: string;
  inTransitQty: string;
  issuedToProductionQty: string;
  alertLevel: StockAlertLevel;
}

/** A material with no balance rows yet has no stock, not unknown stock. */
function emptyPosition(): StockPositionSummary {
  return {
    onHandQty: '0', issuableQty: '0', reservedQty: '0', availableQty: '0',
    qualityHoldQty: '0', blockedQty: '0', withJobWorkerQty: '0', inTransitQty: '0',
    issuedToProductionQty: '0', alertLevel: 'OUT_OF_STOCK',
  };
}
