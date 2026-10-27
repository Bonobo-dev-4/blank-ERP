import { Prisma } from '@prisma/client';
import { ImportsService } from './imports.service';

const dec = (v: string) => new Prisma.Decimal(v);
const M1 = '11111111-1111-4111-8111-111111111111';
const LOT1 = '22222222-2222-4222-8222-222222222222';
const LOC1 = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444';


function setup(over: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    rawMaterial: { findMany: jest.fn().mockResolvedValue([]) },
    supplier: { findMany: jest.fn().mockResolvedValue([]) },
    materialLocation: { findMany: jest.fn().mockResolvedValue([]) },
    materialLot: { findMany: jest.fn().mockResolvedValue([]) },
    materialBalance: { findMany: jest.fn().mockResolvedValue([]) },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    externalProductMapping: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
  const materials = { create: jest.fn().mockResolvedValue({ id: 'm-new' }), update: jest.fn().mockResolvedValue({}) };
  const inventory = { adjust: jest.fn().mockResolvedValue({}) };
  const products = { upsertMapping: jest.fn().mockResolvedValue({}) };
  const shopifyProducts = { relinkOrderLines: jest.fn().mockResolvedValue({ linked: 3 }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ImportsService(
    prisma as never, audit as never, materials as never, {} as never, {} as never,
    products as never, inventory as never, shopifyProducts as never,
  );
  return { service, prisma, materials, inventory, products, shopifyProducts, audit };
}

const existingMaterial = {
  id: M1, materialCode: 'FAB-001', name: 'Chanderi', category: 'FABRIC', baseUom: 'METER',
  minimumStock: dec('10'), reorderLevel: dec('20'), leadTimeDays: 7, status: 'ACTIVE',
};

describe('ImportsService — raw materials', () => {
  it('matches headers loosely and classifies create, update, unchanged and error rows', async () => {
    const { service } = setup({ rawMaterial: { findMany: jest.fn().mockResolvedValue([existingMaterial]) } });
    const r = await service.preview('org', 'raw-materials', [
      { 'Material code': 'FAB-002', Name: 'Linen', category: 'fabric', 'base unit': 'meter' },
      { material_code: 'FAB-001', 'Reorder level': '25' },
      { materialCode: 'FAB-001x', name: 'X' },
      { materialCode: 'fab-001', minimumStock: '10.0000' },
    ]);
    expect(r.rows.map((x) => x.action)).toEqual(['create', 'update', 'error', 'error']);
    expect(r.rows[1]!.changes).toEqual(['Reorder level']);
    expect(r.rows[2]!.errors[0]).toMatch(/New record needs: Category, Base unit/);
    // Same code again (case-insensitive) is a duplicate, not a second update.
    expect(r.rows[3]!.errors.join()).toMatch(/Duplicate of row 3/);
  });

  it('reports an unchanged row when nothing it provides differs', async () => {
    const { service } = setup({ rawMaterial: { findMany: jest.fn().mockResolvedValue([existingMaterial]) } });
    const r = await service.preview('org', 'raw-materials', [{ materialCode: 'FAB-001', minimumStock: '10.0000', status: 'active' }]);
    expect(r.rows[0]!.action).toBe('unchanged');
  });

  it('never lets a schema default overwrite a field the row did not provide', async () => {
    const { service, materials } = setup({ rawMaterial: { findMany: jest.fn().mockResolvedValue([existingMaterial]) } });
    await service.commit('org', 'u', 'raw-materials', [{ materialCode: 'FAB-001', reorderLevel: '30' }], 'key-12345');
    expect(materials.update).toHaveBeenCalledWith('org', 'u', M1, { reorderLevel: '30' });
  });

  it('reports a missing required column on every row', async () => {
    const { service } = setup();
    const r = await service.preview('org', 'raw-materials', [{ name: 'Linen' }]);
    expect(r.missingColumns).toEqual(['Material code']);
    expect(r.counts.error).toBe(1);
  });

  it('writes nothing at all when any row has an error', async () => {
    const { service, materials, audit } = setup();
    const r = await service.commit('org', 'u', 'raw-materials', [
      { materialCode: 'FAB-009', name: 'Ok', category: 'FABRIC', baseUom: 'METER' },
      { materialCode: 'FAB-010', name: 'Bad unit', category: 'FABRIC', baseUom: 'LITRE' },
    ], 'key-12345');
    expect(r.committed).toBe(false);
    expect(materials.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ImportsService — stock adjustments', () => {
  const stocked = () => setup({
    rawMaterial: { findMany: jest.fn().mockResolvedValue([{ id: M1, materialCode: 'FAB-001' }]) },
    materialLocation: { findMany: jest.fn().mockResolvedValue([{ id: LOC1, code: 'WH-A' }]) },
    materialLot: { findMany: jest.fn().mockResolvedValue([{ id: LOT1, lotCode: 'L-1', rawMaterialId: M1 }]) },
    materialBalance: { findMany: jest.fn().mockResolvedValue([{ materialLotId: LOT1, locationId: LOC1, onHandQty: dec('5') }]) },
  });
  const row = (qty: string) => ({ materialCode: 'FAB-001', lotCode: 'L-1', locationCode: 'WH-A', adjustmentQty: qty, uom: 'METER', reason: 'Count' });

  it('refuses to take stock below zero, counting earlier rows in the file', async () => {
    const { service } = stocked();
    const r = await service.preview('org', 'stock-adjustments', [row('-3'), row('-3')]);
    expect(r.rows.map((x) => x.action)).toEqual(['adjust', 'error']);
    expect(r.rows[1]!.errors[0]).toMatch(/below zero/);
  });

  it('posts through the ledger with a key per row, so a resubmit cannot double-adjust', async () => {
    const { service, inventory } = stocked();
    await service.commit('org', 'u', 'stock-adjustments', [row('2')], 'imp-abcdef12');
    expect(inventory.adjust).toHaveBeenCalledWith('org', 'u', expect.objectContaining({
      idempotencyKey: 'imp-abcdef12:r2', adjustmentQty: '2', materialLotId: LOT1, locationId: LOC1,
    }));
  });
});

describe('ImportsService — product mappings', () => {
  it('resolves the ERP SKU, links, then relinks order lines', async () => {
    const { service, products, shopifyProducts } = setup({
      productVariant: { findMany: jest.fn().mockResolvedValue([{ id: V1, sku: 'DD-KRT-M' }]) },
    });
    const r = await service.commit('org', 'u', 'product-mappings', [
      { provider: 'shopify', identifierKind: 'variant sku', externalId: 'KRT-M-OLD', variantSku: 'dd-krt-m' },
    ], 'key-12345');
    expect(r.committed).toBe(true);
    expect(products.upsertMapping).toHaveBeenCalledWith('org', 'u', expect.objectContaining({
      provider: 'SHOPIFY', identifierKind: 'VARIANT_SKU', externalId: 'KRT-M-OLD', productVariantId: V1,
    }));
    expect(shopifyProducts.relinkOrderLines).toHaveBeenCalled();
  });
});
