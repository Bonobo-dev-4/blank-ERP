import { Injectable } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import {
  IMPORT_SPECS, createLocationRequest, createProductRequest, createRawMaterialRequest,
  createSupplierRequest, normaliseHeader, stockAdjustmentRequest, updateLocationRequest,
  updateProductRequest, updateRawMaterialRequest, updateSupplierRequest, upsertExternalMappingRequest,
  type ImportAction, type ImportResult, type ImportRowResult, type ImportSpec, type ImportType,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { MaterialsService } from '../materials/materials.service';
import { SuppliersService } from '../materials/suppliers.service';
import { LocationsService } from '../materials/locations.service';
import { ProductsService } from '../products/products.service';
import { InventoryService } from '../inventory/inventory.service';
import { ShopifyProductService } from '../integrations/shopify-product.service';

type Row = { line: number; data: Record<string, string> };
type Prepared = ImportRowResult & { apply?: (ctx: ApplyCtx) => Promise<string> };
type ApplyCtx = { organizationId: string; userId: string; importKey: string; createdIds: Map<string, string> };

/* ----------------------------------------------------------------- values */

const BOOL_TRUE = new Set(['true', 'yes', 'y', '1']);
const BOOL_FALSE = new Set(['false', 'no', 'n', '0']);
const ENUM_FIELDS = new Set([
  'category', 'baseUom', 'purchaseUom', 'uom', 'status', 'kind', 'storageLevel', 'productionType', 'provider',
]);
const BOOL_FIELDS = new Set(['lotTracked', 'shadeTracked', 'blocksIssue', 'isPrimary']);

/**
 * Turn the cells a person typed into the values the schemas expect. Empty
 * cells mean "not given" — on an update, that leaves the field as it is.
 */
function typed(data: Record<string, string>, skip: string[] = []): { body: Record<string, unknown>; errors: string[] } {
  const body: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [k, raw] of Object.entries(data)) {
    if (skip.includes(k)) continue;
    const v = raw.trim();
    if (v === '') continue;
    if (BOOL_FIELDS.has(k)) {
      const lv = v.toLowerCase();
      if (BOOL_TRUE.has(lv)) body[k] = true;
      else if (BOOL_FALSE.has(lv)) body[k] = false;
      else errors.push(`${k}: use true or false`);
      continue;
    }
    body[k] = ENUM_FIELDS.has(k) ? v.toUpperCase().replace(/[\s-]+/g, '_') : v;
  }
  return { body, errors };
}

function zodErrors(spec: ImportSpec, issues: { path: (string | number)[]; message: string }[]): string[] {
  const label = (k: string | number) => spec.columns.find((c) => c.key === k)?.label ?? String(k);
  return issues.map((i) => (i.path.length ? `${label(i.path[0]!)}: ${i.message}` : i.message));
}

/** Same value for the purpose of "did anything change?" — numbers by value. */
function same(a: unknown, b: unknown): boolean {
  if (a === undefined) return true;
  if (b === null || b === undefined) return a === null || a === '';
  if (typeof b === 'object' && b !== null && 'toFixed' in b) return Number(a) === Number((b as { toFixed(): string }).toFixed());
  if (typeof b === 'number') return Number(a) === b;
  if (typeof b === 'boolean') return a === b;
  return String(a) === String(b);
}

/* ---------------------------------------------------------------- service */

/**
 * CSV import.
 *
 * Rows come in already parsed; this matches headers, turns cells into typed
 * values, resolves codes to records, validates with the same schemas as the
 * screens, and classifies every row before anything is written.
 *
 * Commit re-runs the whole preview — a preview is never trusted — and writes
 * nothing if any row has an error. Valid rows then go through the real
 * services one at a time, so numbering, audit and the stock ledger behave
 * exactly as they do on screen. Upserts are naturally safe to re-run; each
 * stock adjustment carries a key derived from the import, so re-submitting
 * the same import never adjusts twice.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly materials: MaterialsService,
    private readonly suppliers: SuppliersService,
    private readonly locations: LocationsService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
    private readonly shopifyProducts: ShopifyProductService,
  ) {}

  /** Map headers to column keys; report what was ignored and what is missing. */
  private normalise(spec: ImportSpec, raw: Record<string, string>[]) {
    const byHeader = new Map<string, string>();
    for (const c of spec.columns) {
      byHeader.set(normaliseHeader(c.key), c.key);
      byHeader.set(normaliseHeader(c.label), c.key);
    }
    const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
    const unknownColumns = headers.filter((h) => !byHeader.has(normaliseHeader(h)));
    const present = new Set(headers.map((h) => byHeader.get(normaliseHeader(h))).filter(Boolean) as string[]);
    const missingColumns = spec.columns.filter((c) => c.required === 'always' && !present.has(c.key)).map((c) => c.label);
    const rows: Row[] = raw.map((r, i) => {
      const data: Record<string, string> = {};
      for (const [h, v] of Object.entries(r)) {
        const key = byHeader.get(normaliseHeader(h));
        if (key) data[key] = (v ?? '').toString();
      }
      return { line: i + 2, data };
    });
    return { rows, unknownColumns, missingColumns };
  }

  async preview(organizationId: string, type: ImportType, raw: Record<string, string>[]): Promise<ImportResult & { prepared: Prepared[] }> {
    const spec = IMPORT_SPECS[type];
    const { rows, unknownColumns, missingColumns } = this.normalise(spec, raw);
    const keyOf = (r: Row) => spec.keyColumns.map((k) => (r.data[k] ?? '').trim().toUpperCase()).join(' · ');

    let prepared: Prepared[];
    if (missingColumns.length > 0) {
      prepared = rows.map((r) => ({
        row: r.line, key: keyOf(r), action: 'error', changes: [],
        errors: [`Missing column${missingColumns.length > 1 ? 's' : ''}: ${missingColumns.join(', ')}`],
      }));
    } else {
      prepared = await this.prepare(organizationId, type, spec, rows);
      // The same record twice in one file is ambiguous — which row wins?
      if (spec.keyColumns.length > 0) {
        const seen = new Map<string, number>();
        for (const p of prepared) {
          if (!p.key) continue;
          const first = seen.get(p.key);
          if (first !== undefined) {
            (p.errors as string[]).push(`Duplicate of row ${first} — each record may appear once`);
            (p as { action: ImportAction }).action = 'error';
          } else seen.set(p.key, p.row);
        }
      }
    }

    const counts = { create: 0, update: 0, unchanged: 0, adjust: 0, error: 0 } as Record<ImportAction, number>;
    for (const p of prepared) counts[p.action] += 1;
    return {
      type, committed: false, unknownColumns, missingColumns, counts,
      rows: prepared.map(({ apply: _apply, ...r }) => r),
      prepared,
    };
  }

  async commit(organizationId: string, userId: string, type: ImportType, raw: Record<string, string>[], importKey: string): Promise<ImportResult> {
    const result = await this.preview(organizationId, type, raw);
    const { prepared, ...summary } = result;
    if (summary.counts.error > 0 || summary.missingColumns.length > 0) return summary;

    const ctx: ApplyCtx = { organizationId, userId, importKey, createdIds: new Map() };
    const rows: ImportRowResult[] = [];
    for (const p of prepared) {
      const { apply, ...r } = p;
      if (p.action === 'unchanged' || !apply) {
        rows.push({ ...r, outcome: 'unchanged' });
        continue;
      }
      try {
        const message = await apply(ctx);
        rows.push({
          ...r,
          outcome: p.action === 'create' ? 'created' : p.action === 'adjust' ? 'adjusted' : 'updated',
          message,
        });
      } catch (e) {
        const resp = (e as { response?: { message?: string } }).response;
        rows.push({ ...r, outcome: 'failed', message: resp?.message ?? (e instanceof Error ? e.message : String(e)) });
      }
    }

    let note: string | undefined;
    if (type === 'product-mappings') {
      // New links are only useful once order lines use them.
      const relinked = await this.shopifyProducts.relinkOrderLines(organizationId);
      note = `${relinked.linked} order lines linked to a product by these mappings`;
    }

    const outcome = (o: string) => rows.filter((x) => x.outcome === o).length;
    await this.audit.record({
      organizationId, actorUserId: userId, action: 'RUN', entityType: 'Import', entityId: null,
      context: {
        type, idempotencyKey: importKey, rows: rows.length,
        created: outcome('created'), updated: outcome('updated'), adjusted: outcome('adjusted'),
        unchanged: outcome('unchanged'), failed: outcome('failed'),
      },
    });

    return { ...summary, committed: true, rows: note ? rows.map((x, i) => (i === 0 ? { ...x, message: [x.message, note].filter(Boolean).join(' · ') } : x)) : rows };
  }

  /* ----------------------------------------------------------- per type */

  private async prepare(organizationId: string, type: ImportType, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    switch (type) {
      case 'raw-materials': return this.prepareMaterials(organizationId, spec, rows);
      case 'suppliers': return this.prepareSuppliers(organizationId, spec, rows);
      case 'locations': return this.prepareLocations(organizationId, spec, rows);
      case 'products': return this.prepareProducts(organizationId, spec, rows);
      case 'product-mappings': return this.prepareMappings(organizationId, spec, rows);
      case 'stock-adjustments': return this.prepareAdjustments(organizationId, spec, rows);
    }
  }

  /**
   * The shared create-or-update path: validate with the create schema for a
   * new record and the update schema for an existing one, then list exactly
   * which fields would change.
   */
  private upsertRow(
    spec: ImportSpec, row: Row, key: string,
    existing: ({ id: string } & Record<string, unknown>) | undefined,
    body: Record<string, unknown>, errors: string[],
    schemas: { create: ZodTypeAny; update: ZodTypeAny },
    write: { create: (b: Record<string, unknown>, ctx: ApplyCtx) => Promise<{ id: string } | unknown>; update: (id: string, b: Record<string, unknown>, ctx: ApplyCtx) => Promise<unknown> },
  ): Prepared {
    const base = { row: row.line, key, changes: [] as string[], errors };
    if (errors.length > 0) return { ...base, action: 'error' };

    if (!existing) {
      const missing = spec.columns.filter((c) => c.required === 'create' && body[c.key] === undefined && !(`${c.key}Id` in body));
      if (missing.length) return { ...base, action: 'error', errors: [`New record needs: ${missing.map((c) => c.label).join(', ')}`] };
      const parsed = schemas.create.safeParse(body);
      if (!parsed.success) return { ...base, action: 'error', errors: zodErrors(spec, parsed.error.issues) };
      return {
        ...base, action: 'create',
        apply: async (ctx) => {
          const created = await write.create(parsed.data, ctx);
          const id = (created as { id?: string })?.id;
          if (id) ctx.createdIds.set(key, id);
          return 'Created';
        },
      };
    }

    const parsed = schemas.update.safeParse(body);
    if (!parsed.success) return { ...base, action: 'error', errors: zodErrors(spec, parsed.error.issues) };
    const data = parsed.data as Record<string, unknown>;
    // Only fields the row actually provided count — defaults from the schema
    // must never overwrite a value nobody typed.
    const provided = Object.fromEntries(Object.entries(data).filter(([k]) => k in body));
    const changes = Object.keys(provided).filter((k) => !same(provided[k], existing[k]));
    if (changes.length === 0) return { ...base, action: 'unchanged' };
    const label = (k: string) => spec.columns.find((c) => c.key === k || `${c.key.replace(/Code$/, '')}Id` === k)?.label ?? k;
    return {
      ...base, action: 'update', changes: changes.map(label),
      apply: async (ctx) => {
        await write.update(existing.id, Object.fromEntries(changes.map((k) => [k, provided[k]])), ctx);
        return `Updated ${changes.map(label).join(', ')}`;
      },
    };
  }

  private async prepareMaterials(organizationId: string, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    const codes = rows.map((r) => r.data.materialCode?.trim()).filter(Boolean) as string[];
    const supplierCodes = rows.map((r) => r.data.defaultSupplierCode?.trim()).filter(Boolean) as string[];
    const locationCodes = rows.map((r) => r.data.defaultLocationCode?.trim()).filter(Boolean) as string[];
    const [existing, suppliers, locations] = await Promise.all([
      this.prisma.rawMaterial.findMany({ where: { organizationId, materialCode: { in: codes } } }),
      this.prisma.supplier.findMany({ where: { organizationId, supplierCode: { in: supplierCodes } }, select: { id: true, supplierCode: true } }),
      this.prisma.materialLocation.findMany({ where: { organizationId, code: { in: locationCodes } }, select: { id: true, code: true } }),
    ]);
    const byCode = new Map(existing.map((m) => [m.materialCode.toUpperCase(), m]));
    const supplierId = new Map(suppliers.map((s) => [s.supplierCode.toUpperCase(), s.id]));
    const locationId = new Map(locations.map((l) => [l.code.toUpperCase(), l.id]));

    return rows.map((row) => {
      const key = (row.data.materialCode ?? '').trim().toUpperCase();
      const { body, errors } = typed(row.data, ['defaultSupplierCode', 'defaultLocationCode']);
      const sc = row.data.defaultSupplierCode?.trim();
      if (sc) {
        const id = supplierId.get(sc.toUpperCase());
        if (id) body.defaultSupplierId = id; else errors.push(`Default supplier code: no supplier ${sc}`);
      }
      const lc = row.data.defaultLocationCode?.trim();
      if (lc) {
        const id = locationId.get(lc.toUpperCase());
        if (id) body.defaultLocationId = id; else errors.push(`Default location code: no location ${lc}`);
      }
      if (!key) errors.push('Material code is required');
      return this.upsertRow(spec, row, key, byCode.get(key) as never, body, errors,
        { create: createRawMaterialRequest, update: updateRawMaterialRequest },
        {
          create: (b, ctx) => this.materials.create(ctx.organizationId, ctx.userId, b as never),
          update: (id, b, ctx) => this.materials.update(ctx.organizationId, ctx.userId, id, b as never),
        });
    });
  }

  private async prepareSuppliers(organizationId: string, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    const codes = rows.map((r) => r.data.supplierCode?.trim()).filter(Boolean) as string[];
    const existing = await this.prisma.supplier.findMany({ where: { organizationId, supplierCode: { in: codes } } });
    const byCode = new Map(existing.map((s) => [s.supplierCode.toUpperCase(), s]));
    return rows.map((row) => {
      const key = (row.data.supplierCode ?? '').trim().toUpperCase();
      const { body, errors } = typed(row.data);
      if (!key) errors.push('Supplier code is required');
      return this.upsertRow(spec, row, key, byCode.get(key) as never, body, errors,
        { create: createSupplierRequest, update: updateSupplierRequest },
        {
          create: (b, ctx) => this.suppliers.create(ctx.organizationId, ctx.userId, b as never),
          update: (id, b, ctx) => this.suppliers.update(ctx.organizationId, ctx.userId, id, b as never),
        });
    });
  }

  private async prepareLocations(organizationId: string, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    const codes = [
      ...rows.map((r) => r.data.code?.trim()),
      ...rows.map((r) => r.data.parentCode?.trim()),
    ].filter(Boolean) as string[];
    const existing = await this.prisma.materialLocation.findMany({ where: { organizationId, code: { in: codes } } });
    const byCode = new Map(existing.map((l) => [l.code.toUpperCase(), l]));
    const newInFile = new Set<string>();

    return rows.map((row) => {
      const key = (row.data.code ?? '').trim().toUpperCase();
      const { body, errors } = typed(row.data, ['parentCode']);
      const current = byCode.get(key);
      if (current?.isSystem) errors.push('System locations cannot be changed by import');
      if (current && body.kind !== undefined && body.kind !== current.kind) {
        errors.push(`Kind: cannot change ${current.kind} to ${String(body.kind)} once created`);
      }
      if (current) delete body.kind;
      const parent = row.data.parentCode?.trim().toUpperCase();
      let parentFromFile: string | null = null;
      if (parent) {
        if (parent === key) errors.push('Parent location code: a location cannot sit inside itself');
        else if (byCode.has(parent)) body.parentId = byCode.get(parent)!.id;
        else if (newInFile.has(parent)) parentFromFile = parent;
        else errors.push(`Parent location code: no location ${parent} (a new parent must appear earlier in the file)`);
      }
      if (!key) errors.push('Location code is required');
      if (!current && key) newInFile.add(key);

      // A parent created earlier in this same import is only known once it
      // exists, so its id is filled in at write time.
      const withParent = (b: Record<string, unknown>, ctx: ApplyCtx) =>
        parentFromFile ? { ...b, parentId: ctx.createdIds.get(parentFromFile) } : b;
      if (parentFromFile) body.parentId = '00000000-0000-4000-8000-000000000000';

      return this.upsertRow(spec, row, key, current as never, body, errors,
        { create: createLocationRequest, update: updateLocationRequest },
        {
          create: (b, ctx) => this.locations.create(ctx.organizationId, ctx.userId, withParent(b, ctx) as never),
          update: (id, b, ctx) => this.locations.update(ctx.organizationId, ctx.userId, id, withParent(b, ctx) as never),
        });
    });
  }

  private async prepareProducts(organizationId: string, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    const codes = rows.map((r) => r.data.styleCode?.trim()).filter(Boolean) as string[];
    const existing = await this.prisma.product.findMany({ where: { organizationId, styleCode: { in: codes } } });
    const byCode = new Map(existing.map((p) => [p.styleCode.toUpperCase(), p]));
    return rows.map((row) => {
      const key = (row.data.styleCode ?? '').trim().toUpperCase();
      const { body, errors } = typed(row.data);
      if (!key) errors.push('Style code is required');
      return this.upsertRow(spec, row, key, byCode.get(key) as never, body, errors,
        { create: createProductRequest, update: updateProductRequest },
        {
          create: (b, ctx) => this.products.createProduct(ctx.organizationId, ctx.userId, b as never),
          update: (id, b, ctx) => this.products.updateProduct(ctx.organizationId, ctx.userId, id, b as never),
        });
    });
  }

  private async prepareMappings(organizationId: string, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    const skus = rows.map((r) => r.data.variantSku?.trim()).filter(Boolean) as string[];
    const externalIds = rows.map((r) => r.data.externalId?.trim()).filter(Boolean) as string[];
    const [variants, existing] = await Promise.all([
      this.prisma.productVariant.findMany({ where: { organizationId, sku: { in: skus } }, select: { id: true, sku: true } }),
      this.prisma.externalProductMapping.findMany({ where: { organizationId, externalId: { in: externalIds } } }),
    ]);
    const variantId = new Map(variants.map((v) => [v.sku.toUpperCase(), v.id]));
    const byKey = new Map(existing.map((m) => [`${m.provider} · ${m.identifierKind.toUpperCase()} · ${m.externalId.toUpperCase()}`, m]));

    return rows.map((row) => {
      const { body, errors } = typed(row.data, ['variantSku']);
      if (typeof body.identifierKind === 'string') body.identifierKind = body.identifierKind.toUpperCase().replace(/[\s-]+/g, '_');
      const key = `${String(body.provider ?? '')} · ${String(body.identifierKind ?? '')} · ${(row.data.externalId ?? '').trim().toUpperCase()}`;
      const sku = row.data.variantSku?.trim();
      if (!sku) errors.push('ERP variant SKU is required');
      else {
        const id = variantId.get(sku.toUpperCase());
        if (id) body.productVariantId = id; else errors.push(`ERP variant SKU: no variant ${sku}`);
      }
      const base = { row: row.line, key, changes: [] as string[], errors };
      if (errors.length) return { ...base, action: 'error' as const };
      const parsed = upsertExternalMappingRequest.safeParse(body);
      if (!parsed.success) return { ...base, action: 'error' as const, errors: zodErrors(spec, parsed.error.issues) };

      const current = byKey.get(key);
      const changes: string[] = [];
      if (current) {
        if (current.productVariantId !== parsed.data.productVariantId) changes.push('ERP variant SKU');
        if ((current.externalSku ?? null) !== (parsed.data.externalSku ?? current.externalSku ?? null)) changes.push('External SKU');
        if ('isPrimary' in body && current.isPrimary !== parsed.data.isPrimary) changes.push('Primary');
        if (changes.length === 0) return { ...base, action: 'unchanged' as const };
      }
      return {
        ...base,
        action: current ? ('update' as const) : ('create' as const),
        changes,
        apply: async (ctx: ApplyCtx) => {
          await this.products.upsertMapping(ctx.organizationId, ctx.userId, parsed.data);
          return current ? `Updated ${changes.join(', ')}` : 'Linked';
        },
      };
    });
  }

  private async prepareAdjustments(organizationId: string, spec: ImportSpec, rows: Row[]): Promise<Prepared[]> {
    const materialCodes = rows.map((r) => r.data.materialCode?.trim()).filter(Boolean) as string[];
    const locationCodes = rows.map((r) => r.data.locationCode?.trim()).filter(Boolean) as string[];
    const [materials, locations] = await Promise.all([
      this.prisma.rawMaterial.findMany({ where: { organizationId, materialCode: { in: materialCodes } }, select: { id: true, materialCode: true } }),
      this.prisma.materialLocation.findMany({ where: { organizationId, code: { in: locationCodes } }, select: { id: true, code: true } }),
    ]);
    const materialId = new Map(materials.map((m) => [m.materialCode.toUpperCase(), m.id]));
    const locationId = new Map(locations.map((l) => [l.code.toUpperCase(), l.id]));
    const lots = await this.prisma.materialLot.findMany({
      where: { organizationId, rawMaterialId: { in: [...materialId.values()] } },
      select: { id: true, lotCode: true, rawMaterialId: true },
    });
    const lotId = new Map(lots.map((l) => [`${l.rawMaterialId}:${l.lotCode.toUpperCase()}`, l.id]));
    const balances = await this.prisma.materialBalance.findMany({
      where: { organizationId, materialLotId: { in: lots.map((l) => l.id) } },
      select: { materialLotId: true, locationId: true, onHandQty: true },
    });
    // Running on-hand per lot and place, so a file cannot take stock below
    // zero across several rows either.
    const onHand = new Map(balances.map((b) => [`${b.materialLotId}:${b.locationId}`, Number(b.onHandQty.toFixed())]));

    return rows.map((row) => {
      const errors: string[] = [];
      const d = row.data;
      const mId = materialId.get((d.materialCode ?? '').trim().toUpperCase());
      if (!mId) errors.push(`Material code: no material ${d.materialCode ?? ''}`);
      const lId = mId ? lotId.get(`${mId}:${(d.lotCode ?? '').trim().toUpperCase()}`) : undefined;
      if (mId && !lId) errors.push(`Lot code: no lot ${d.lotCode ?? ''} for ${d.materialCode}`);
      const locId = locationId.get((d.locationCode ?? '').trim().toUpperCase());
      if (!locId) errors.push(`Location code: no location ${d.locationCode ?? ''}`);
      const key = `${(d.materialCode ?? '').trim()} · ${(d.lotCode ?? '').trim()} @ ${(d.locationCode ?? '').trim()}`;
      const base = { row: row.line, key, changes: [] as string[], errors };
      if (errors.length) return { ...base, action: 'error' as const };

      const body = {
        idempotencyKey: 'import-preview',
        rawMaterialId: mId!, materialLotId: lId!, locationId: locId!,
        adjustmentQty: (d.adjustmentQty ?? '').trim(),
        uom: (d.uom ?? '').trim().toUpperCase(),
        reason: (d.reason ?? '').trim(),
        remarks: d.remarks?.trim() || undefined,
      };
      const parsed = stockAdjustmentRequest.safeParse(body);
      if (!parsed.success) return { ...base, action: 'error' as const, errors: zodErrors(spec, parsed.error.issues) };

      const slot = `${lId}:${locId}`;
      const after = (onHand.get(slot) ?? 0) + Number(parsed.data.adjustmentQty);
      if (after < 0) {
        return { ...base, action: 'error' as const, errors: [`Would take stock below zero here (on hand ${onHand.get(slot) ?? 0})`] };
      }
      onHand.set(slot, after);
      return {
        ...base, action: 'adjust' as const, changes: [`${Number(parsed.data.adjustmentQty) > 0 ? '+' : ''}${parsed.data.adjustmentQty} ${parsed.data.uom}`],
        apply: async (ctx: ApplyCtx) => {
          await this.inventory.adjust(ctx.organizationId, ctx.userId, { ...parsed.data, idempotencyKey: `${ctx.importKey}:r${row.line}` });
          return 'Posted to the ledger';
        },
      };
    });
  }

  /* ------------------------------------------------------- current data */

  /** Current records in import columns, so editing is: download, change, re-import. */
  async exportRows(organizationId: string, type: ImportType): Promise<Record<string, string>[]> {
    const s = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'toFixed' in (v as object) ? (v as { toFixed(): string }).toFixed() : String(v));
    switch (type) {
      case 'raw-materials': {
        const rows = await this.prisma.rawMaterial.findMany({
          where: { organizationId }, orderBy: { materialCode: 'asc' },
          include: { defaultSupplier: { select: { supplierCode: true } }, defaultLocation: { select: { code: true } } },
        });
        return rows.map((m) => ({
          materialCode: m.materialCode, name: m.name, category: m.category, baseUom: m.baseUom, purchaseUom: s(m.purchaseUom),
          description: s(m.description), color: s(m.color), colorCode: s(m.colorCode), fabricComposition: s(m.fabricComposition),
          width: s(m.width), widthUom: s(m.widthUom), gsm: s(m.gsm), defaultSupplierCode: s(m.defaultSupplier?.supplierCode),
          purchaseRate: s(m.purchaseRate), minimumStock: s(m.minimumStock), reorderLevel: s(m.reorderLevel), reorderQty: s(m.reorderQty),
          leadTimeDays: s(m.leadTimeDays), defaultLocationCode: s(m.defaultLocation?.code), lotTracked: s(m.lotTracked),
          shadeTracked: s(m.shadeTracked), status: m.status,
        }));
      }
      case 'suppliers': {
        const rows = await this.prisma.supplier.findMany({ where: { organizationId }, orderBy: { supplierCode: 'asc' } });
        return rows.map((x) => ({
          supplierCode: x.supplierCode, name: x.name, contactPerson: s(x.contactPerson), email: s(x.email), phone: s(x.phone),
          addressLine1: s(x.addressLine1), addressLine2: s(x.addressLine2), city: s(x.city), state: s(x.state), pincode: s(x.pincode),
          gstin: s(x.gstin), paymentTerms: s(x.paymentTerms), leadTimeDays: s(x.leadTimeDays), rating: s(x.rating),
          status: x.status, notes: s(x.notes),
        }));
      }
      case 'locations': {
        const rows = await this.prisma.materialLocation.findMany({
          where: { organizationId, isSystem: false }, orderBy: { code: 'asc' },
          include: { parent: { select: { code: true } } },
        });
        return rows.map((l) => ({
          code: l.code, name: l.name, kind: l.kind, storageLevel: s(l.storageLevel), parentCode: s(l.parent?.code),
          blocksIssue: s(l.blocksIssue), status: l.status,
        }));
      }
      case 'products': {
        const rows = await this.prisma.product.findMany({ where: { organizationId }, orderBy: { styleCode: 'asc' } });
        return rows.map((p) => ({
          styleCode: p.styleCode, name: p.name, collection: s(p.collection), category: s(p.category), sizeSet: s(p.sizeSet),
          fabricDescription: s(p.fabricDescription), productionType: p.productionType,
          standardManufacturingDays: s(p.standardManufacturingDays), status: p.status, notes: s(p.notes),
        }));
      }
      case 'product-mappings': {
        // The work list: SKUs on orders that nothing links to yet.
        const lines = await this.prisma.shopifyOrderLine.findMany({
          where: { organizationId, productVariantId: null, OR: [{ externalSku: { not: null } }, { externalVariantId: { not: null } }] },
          select: { externalSku: true, externalVariantId: true },
          distinct: ['externalSku', 'externalVariantId'],
          take: 10_000,
        });
        return lines.map((l) => ({
          provider: 'SHOPIFY',
          identifierKind: l.externalVariantId ? 'VARIANT_GID' : 'VARIANT_SKU',
          externalId: l.externalVariantId ?? l.externalSku ?? '',
          externalSku: s(l.externalSku),
          variantSku: '',
          isPrimary: '',
        }));
      }
      case 'stock-adjustments':
        return [];
    }
  }
}
