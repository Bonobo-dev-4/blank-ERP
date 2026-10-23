import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { DecimalSerializerInterceptor } from '../src/common/interceptors/decimal-serializer.interceptor';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Phase 2 end-to-end: BOM, MRP, reservation and manufacturing orders.
 *
 * Drives the real HTTP API against a real Postgres database, through the
 * planning path the specification describes:
 *
 *   BOM draft -> approval -> explosion -> manufacturing order -> MRP run
 *             -> reservation -> release (BOM snapshot frozen)
 *
 * The four roadmap exit criteria are asserted explicitly:
 *
 *   1. a BOM explodes to 262.5 m for 100 kurtas at 2.5 m + 5% wastage
 *   2. an MRP run reports 262.5 required / 180 available / 82.5 short
 *   3. releasing short of critical material requires
 *      `manufacturing.release_with_shortage` AND a written reason
 *   4. editing a BOM after release leaves the released order's snapshot
 *      unchanged
 *
 * Needs a database:
 *   DATABASE_URL=... pnpm --filter @dnd/api test:e2e
 */
const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('Phase 2: planning path (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let token: string;

  let orgId: string;
  let adminUserId: string;
  let productId: string;
  let variantMId: string;
  let variantXxlId: string;
  let fabricId: string;
  let buttonId: string;
  let tagId: string;
  let warehouseId: string;

  // Carried between tests: this suite is a single narrative, in order.
  let bomId: string;
  let bomVersionId: string;
  let moId: string;

  const key = () => randomUUID();
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters-long';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new DecimalSerializerInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const bcrypt = await import('bcryptjs');
    const admin = await prisma.user.findFirstOrThrow({
      where: { employeeCode: 'ADMIN' },
      select: { id: true, email: true, organizationId: true },
    });
    orgId = admin.organizationId;
    adminUserId = admin.id;
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash('e2e-test-password', 10) },
    });

    const login = await http
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'e2e-test-password' })
      .expect(200);
    token = login.body.accessToken as string;

    const [product, fabric, button, tag, warehouse] = await Promise.all([
      prisma.product.findFirstOrThrow({ where: { organizationId: orgId, styleCode: 'DD-KRT-001' } }),
      prisma.rawMaterial.findFirstOrThrow({ where: { organizationId: orgId, materialCode: 'FAB-001' } }),
      prisma.rawMaterial.findFirstOrThrow({ where: { organizationId: orgId, materialCode: 'BTN-001' } }),
      prisma.rawMaterial.findFirstOrThrow({ where: { organizationId: orgId, materialCode: 'TAG-001' } }),
      prisma.materialLocation.findFirstOrThrow({ where: { organizationId: orgId, code: 'RM-WH-FAB' } }),
    ]);
    productId = product.id;
    fabricId = fabric.id;
    buttonId = button.id;
    tagId = tag.id;
    warehouseId = warehouse.id;

    const variants = await prisma.productVariant.findMany({
      where: { organizationId: orgId, productId },
      orderBy: { sizeSortOrder: 'asc' },
    });
    variantMId = variants.find((v) => v.size === 'M')?.id ?? variants[0].id;
    variantXxlId = variants.find((v) => v.size === 'XXL')?.id ?? variants[variants.length - 1].id;

    // A clean slate for this suite only: phase 2 objects from an earlier run
    // would make version numbers and reservations unpredictable.
    await prisma.$transaction([
      prisma.moBomSnapshotLine.deleteMany({ where: { manufacturingOrder: { organizationId: orgId } } }),
      prisma.materialReservation.deleteMany({ where: { organizationId: orgId } }),
      prisma.materialRequirement.deleteMany({ where: { organizationId: orgId } }),
      prisma.manufacturingOrderItem.deleteMany({
        where: { manufacturingOrder: { organizationId: orgId } },
      }),
      prisma.manufacturingOrder.deleteMany({ where: { organizationId: orgId } }),
      prisma.mrpRun.deleteMany({ where: { organizationId: orgId } }),
      prisma.productVariant.updateMany({ where: { organizationId: orgId }, data: { activeBomVersionId: null } }),
      prisma.bomItem.deleteMany({ where: { bomVersion: { bom: { organizationId: orgId } } } }),
      prisma.bomVersion.deleteMany({ where: { bom: { organizationId: orgId } } }),
      prisma.bom.deleteMany({ where: { organizationId: orgId } }),
    ]);

    // Reset the supply picture for the three materials this suite reasons
    // about, so "180 m available, nothing incoming" means exactly that
    // regardless of what phase 1 left behind. Phase 1 ends with a part-received
    // purchase order still open, which would otherwise show up here as cover.
    await prisma.materialBalance.updateMany({
      where: { rawMaterialId: { in: [fabricId, buttonId, tagId] } },
      data: { reservedQty: new Prisma.Decimal(0) },
    });
    await prisma.rawMaterialPurchaseOrder.updateMany({
      where: {
        organizationId: orgId,
        status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
        items: { some: { rawMaterialId: { in: [fabricId, buttonId, tagId] } } },
      },
      data: { status: 'CLOSED', closeReason: 'Closed by the phase 2 suite setup' },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Put a known quantity of a material into the warehouse, as one lot. */
  const giveStock = async (rawMaterialId: string, quantity: string) => {
    await prisma.materialBalance.deleteMany({ where: { rawMaterialId } });
    const lot = await prisma.materialLot.findFirst({
      where: { rawMaterialId, organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    });
    const lotId =
      lot?.id ??
      (
        await prisma.materialLot.create({
          data: {
            organizationId: orgId,
            rawMaterialId,
            lotCode: `E2E-${randomUUID().slice(0, 8)}`,
            receivedAt: new Date(),
            unitCost: new Prisma.Decimal('250'),
          },
          select: { id: true },
        })
      ).id;

    await prisma.materialBalance.create({
      data: {
        organizationId: orgId,
        rawMaterialId,
        materialLotId: lotId,
        locationId: warehouseId,
        onHandQty: new Prisma.Decimal(quantity),
        reservedQty: new Prisma.Decimal(0),
      },
    });
    return lotId;
  };

  // ==========================================================================
  // BOM
  // ==========================================================================

  describe('bill of materials', () => {
    it('creates a BOM with its first draft version', async () => {
      const res = await http
        .post('/api/bom')
        .set(auth())
        .send({
          productId,
          name: 'Kurta — core',
          baseQuantity: '1',
          items: [
            {
              lineNo: 1,
              rawMaterialId: fabricId,
              consumptionQty: '2.5',
              uom: 'METER',
              wastageBasis: 'PERCENT_OF_CONSUMPTION',
              wastageValue: '5',
              unitCost: '250',
              isCritical: true,
              sizeOverrides: [{ size: 'XXL', consumptionQty: '2.85' }],
            },
            {
              lineNo: 2,
              rawMaterialId: buttonId,
              consumptionQty: '5',
              uom: 'PIECE',
              wastageBasis: 'FIXED_PER_UNIT',
              wastageValue: '0.2',
              unitCost: '2',
              isCritical: true,
            },
            {
              lineNo: 3,
              rawMaterialId: tagId,
              consumptionQty: '1',
              uom: 'PIECE',
              wastageBasis: 'NONE',
              wastageValue: '0',
              unitCost: '3',
              // A hang tag does not stop the cutting table.
              isCritical: false,
            },
          ],
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.version).toBe(1);
      expect(res.body.itemCount).toBe(3);
      expect(res.body.criticalItemCount).toBe(2);
      bomVersionId = res.body.id;
      bomId = res.body.bomId;
    });

    it('caches the per-unit gross quantity from the same code path the explosion uses', async () => {
      const res = await http.get(`/api/bom/versions/${bomVersionId}`).set(auth()).expect(200);
      const fabric = res.body.items.find((i: { rawMaterialId: string }) => i.rawMaterialId === fabricId);
      // 2.5 + 5% = 2.625 m per garment.
      expect(fabric.grossQtyPerUnit).toBe('2.6250');
      // 5 buttons + 0.2 fixed = 5.2 per garment.
      const button = res.body.items.find((i: { rawMaterialId: string }) => i.rawMaterialId === buttonId);
      expect(button.grossQtyPerUnit).toBe('5.2000');
    });

    it('refuses a second BOM for the same style', async () => {
      const res = await http
        .post('/api/bom')
        .set(auth())
        .send({
          productId,
          baseQuantity: '1',
          items: [{ lineNo: 1, rawMaterialId: fabricId, consumptionQty: '1', uom: 'METER' }],
        })
        .expect(409);
      expect(res.body.code).toBe('BOM_ALREADY_EXISTS');
    });

    it('refuses a line whose material does not exist', async () => {
      const res = await http
        .patch(`/api/bom/versions/${bomVersionId}`)
        .set(auth())
        .send({ items: [{ lineNo: 1, rawMaterialId: randomUUID(), consumptionQty: '1', uom: 'METER' }] })
        .expect(400);
      expect(res.body.code).toBe('RAW_MATERIAL_NOT_FOUND');
    });

    it('refuses two lines for the same material', async () => {
      const res = await http
        .patch(`/api/bom/versions/${bomVersionId}`)
        .set(auth())
        .send({
          items: [
            { lineNo: 1, rawMaterialId: fabricId, consumptionQty: '1', uom: 'METER' },
            { lineNo: 2, rawMaterialId: fabricId, consumptionQty: '2', uom: 'METER' },
          ],
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('refuses to explode a draft for production', async () => {
      // Only an APPROVED BOM may drive a real order.
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/explode`)
        .set(auth())
        .send({ demand: [{ quantity: '100' }] })
        .expect(422);
      expect(res.body.code).toBe('BOM_NOT_APPROVED');
    });

    it('explodes a draft as an explicit preview', async () => {
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/explode`)
        .set(auth())
        .send({ demand: [{ quantity: '100' }], allowUnapproved: true })
        .expect(201);
      expect(res.body.plannedQty).toBe('100.0000');
    });

    it('refuses approval of a version that was never submitted', async () => {
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/decision`)
        .set(auth())
        .send({ decision: 'APPROVE' })
        .expect(409);
      expect(res.body.code).toBe('BOM_NOT_PENDING_APPROVAL');
    });

    it('submits and approves the version', async () => {
      await http.post(`/api/bom/versions/${bomVersionId}/submit`).set(auth()).expect(201);
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/decision`)
        .set(auth())
        .send({ decision: 'APPROVE', setActive: true })
        .expect(201);

      expect(res.body.status).toBe('APPROVED');
      expect(res.body.isProducible).toBe(true);
      expect(res.body.isEditable).toBe(false);
      // 2.625 x 250 + 5.2 x 2 + 1 x 3 = 656.25 + 10.40 + 3.00
      expect(res.body.materialCostPerUnit).toBe('669.65');
    });

    it('refuses to edit an approved version', async () => {
      const res = await http
        .patch(`/api/bom/versions/${bomVersionId}`)
        .set(auth())
        .send({ items: [{ lineNo: 1, rawMaterialId: fabricId, consumptionQty: '9', uom: 'METER' }] })
        .expect(409);
      expect(res.body.code).toBe('BOM_VERSION_FROZEN');
    });

    // ---- EXIT CRITERION 1 --------------------------------------------------
    it('explodes to the specification figures: 100 kurtas -> 262.5 m', async () => {
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/explode`)
        .set(auth())
        .send({ demand: [{ quantity: '100' }] })
        .expect(201);

      const fabric = res.body.requirements.find(
        (r: { rawMaterialId: string }) => r.rawMaterialId === fabricId,
      );
      expect(fabric.netRequiredQty).toBe('250.0000');
      expect(fabric.wastageQty).toBe('12.5000');
      expect(fabric.grossRequiredQty).toBe('262.5000');
      expect(fabric.estimatedCost).toBe('65625.00');
    });

    it('applies size overrides before scaling', async () => {
      // 50 M at 2.5 m and 50 XXL at 2.85 m = 267.5 m net, not 250 m.
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/explode`)
        .set(auth())
        .send({
          demand: [
            { size: 'M', quantity: '50' },
            { size: 'XXL', quantity: '50' },
          ],
        })
        .expect(201);

      const fabric = res.body.requirements.find(
        (r: { rawMaterialId: string }) => r.rawMaterialId === fabricId,
      );
      expect(fabric.netRequiredQty).toBe('267.5000');
      expect(fabric.grossRequiredQty).toBe('280.8750');
    });

    it('charges a fixed-per-order allowance once, not per garment', async () => {
      const res = await http
        .post(`/api/bom/versions/${bomVersionId}/explode`)
        .set(auth())
        .send({ demand: [{ quantity: '100' }] })
        .expect(201);
      const tag = res.body.requirements.find((r: { rawMaterialId: string }) => r.rawMaterialId === tagId);
      // NONE basis: no allowance at all.
      expect(tag.wastageQty).toBe('0.0000');
      expect(tag.grossRequiredQty).toBe('100.0000');
    });

    it('starts a new draft version by cloning the approved one', async () => {
      const res = await http
        .post(`/api/bom/${bomId}/versions`)
        .set(auth())
        .send({ changeNote: 'Trial a heavier fabric allowance' })
        .expect(201);
      expect(res.body.version).toBe(2);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.itemCount).toBe(3);
    });

    it('refuses a second open draft', async () => {
      const res = await http.post(`/api/bom/${bomId}/versions`).set(auth()).send({}).expect(409);
      expect(res.body.code).toBe('BOM_DRAFT_ALREADY_OPEN');
    });

    it('diffs two versions', async () => {
      const bom = await http.get(`/api/bom/${bomId}`).set(auth()).expect(200);
      const draft = bom.body.versions.find((v: { status: string }) => v.status === 'DRAFT');

      await http
        .patch(`/api/bom/versions/${draft.id}`)
        .set(auth())
        .send({
          items: [
            {
              lineNo: 1, rawMaterialId: fabricId, consumptionQty: '2.7', uom: 'METER',
              wastageBasis: 'PERCENT_OF_CONSUMPTION', wastageValue: '5', unitCost: '250',
            },
            {
              lineNo: 2, rawMaterialId: buttonId, consumptionQty: '5', uom: 'PIECE',
              wastageBasis: 'FIXED_PER_UNIT', wastageValue: '0.2', unitCost: '2',
            },
          ],
        })
        .expect(200);

      const res = await http
        .get(`/api/bom/versions/${draft.id}/diff?against=${bomVersionId}`)
        .set(auth())
        .expect(200);

      const fabric = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === fabricId);
      expect(fabric.change).toBe('CHANGED');
      expect(fabric.fromGrossPerUnit).toBe('2.6250');
      expect(fabric.toGrossPerUnit).toBe('2.8350');

      const tag = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === tagId);
      expect(tag.change).toBe('REMOVED');
    });
  });

  // ==========================================================================
  // Manufacturing orders and MRP
  // ==========================================================================

  describe('manufacturing orders', () => {
    it('creates an order for 100 garments', async () => {
      const res = await http
        .post('/api/manufacturing/orders')
        .set(auth())
        .send({
          productId,
          priority: 'HIGH',
          items: [{ productVariantId: variantMId, orderedQty: '100' }],
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.rollup.orderedQty).toBe('100.0000');
      expect(res.body.moNo).toMatch(/^DD-MFG-\d{4}-\d{6}$/);
      moId = res.body.id;
    });

    it('refuses an order line for a SKU of a different style', async () => {
      const other = await prisma.productVariant.findFirstOrThrow({
        where: { organizationId: orgId, productId: { not: productId } },
      });
      const res = await http
        .post('/api/manufacturing/orders')
        .set(auth())
        .send({ productId, items: [{ productVariantId: other.id, orderedQty: '5' }] })
        .expect(400);
      expect(res.body.code).toBe('VARIANT_NOT_IN_PRODUCT');
    });

    // ---- EXIT CRITERION 2 --------------------------------------------------
    it('reports 262.5 required / 180 available / 82.5 short', async () => {
      await giveStock(fabricId, '180');
      await giveStock(buttonId, '10000');
      await giveStock(tagId, '1000');

      const res = await http
        .post('/api/mrp/runs')
        .set(auth())
        .send({ manufacturingOrderIds: [moId] })
        .expect(201);

      expect(res.body.status).toBe('COMPLETED');
      const fabric = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === fabricId);
      expect(fabric.grossRequiredQty).toBe('262.5000');
      expect(fabric.availableQty).toBe('180.0000');
      expect(fabric.shortageQty).toBe('82.5000');
      expect(fabric.readiness).toBe('SHORT');
      expect(res.body.isProductionReady).toBe(false);
    });

    it('does not count an open purchase order as stock', async () => {
      const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: orgId } });
      const po = await prisma.rawMaterialPurchaseOrder.create({
        data: {
          organizationId: orgId,
          poNo: `E2E-PO-${randomUUID().slice(0, 8)}`,
          supplierId: supplier.id,
          status: 'APPROVED',
          expectedDate: new Date(Date.now() + 7 * 86_400_000),
          items: {
            create: {
              lineNo: 1,
              rawMaterialId: fabricId,
              orderedQty: new Prisma.Decimal('500'),
              uom: 'METER',
              orderedBaseQty: new Prisma.Decimal('500'),
              rate: new Prisma.Decimal('250'),
            },
          },
        },
        select: { id: true },
      });

      const res = await http
        .post('/api/mrp/runs')
        .set(auth())
        .send({ manufacturingOrderIds: [moId] })
        .expect(201);

      const fabric = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === fabricId);
      // Fabric on a lorry cannot be cut: the shortage is unchanged...
      expect(fabric.availableQty).toBe('180.0000');
      expect(fabric.shortageQty).toBe('82.5000');
      // ...but the planner is told it is coming.
      expect(fabric.openPurchaseQty).toBe('500.0000');
      expect(fabric.uncoveredShortageQty).toBe('0.0000');
      expect(fabric.readiness).toBe('PARTIALLY_AVAILABLE');

      await prisma.rawMaterialPurchaseOrder.delete({ where: { id: po.id } });
    });

    it('runs ad-hoc planning without an order', async () => {
      const res = await http
        .post('/api/mrp/runs')
        .set(auth())
        .send({ adHoc: { productId, lines: [{ quantity: '40' }] } })
        .expect(201);
      const fabric = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === fabricId);
      expect(fabric.grossRequiredQty).toBe('105.0000');
      expect(res.body.isProductionReady).toBe(true);
    });

    it('rejects a run that names both scopes', async () => {
      await http
        .post('/api/mrp/runs')
        .set(auth())
        .send({
          manufacturingOrderIds: [moId],
          adHoc: { productId, lines: [{ quantity: '1' }] },
        })
        .expect(400);
    });

    it('shows live readiness, with how many garments stock actually covers', async () => {
      const res = await http.get(`/api/manufacturing/orders/${moId}/readiness`).set(auth()).expect(200);
      expect(res.body.isClear).toBe(false);
      expect(res.body.requiresShortageOverride).toBe(true);
      // 180 m / 2.625 m per garment = 68 whole garments.
      expect(res.body.maxProducibleQty).toBe('68.0000');
    });

    it('reserves what stock there is and reports the shortfall', async () => {
      const res = await http
        .post(`/api/manufacturing/orders/${moId}/reserve`)
        .set(auth())
        .send({ idempotencyKey: key() })
        .expect(201);

      expect(res.body.fullyReserved).toBe(false);
      expect(res.body.status).toBe('PENDING_MATERIAL');
      const fabric = res.body.materials.find((m: { rawMaterialId: string }) => m.rawMaterialId === fabricId);
      expect(fabric.newlyReservedQty).toBe('180.0000');
      expect(fabric.shortfallQty).toBe('82.5000');
    });

    it('records the reservation against the balance, not as a movement', async () => {
      // Reservation is a claim: owned quantity is unchanged, availability is not.
      const balance = await prisma.materialBalance.findFirstOrThrow({
        where: { rawMaterialId: fabricId, locationId: warehouseId },
      });
      expect(balance.onHandQty.toFixed(4)).toBe('180.0000');
      expect(balance.reservedQty.toFixed(4)).toBe('180.0000');
    });

    it('does not double-book when reservation is run again', async () => {
      const res = await http
        .post(`/api/manufacturing/orders/${moId}/reserve`)
        .set(auth())
        .send({ idempotencyKey: key() })
        .expect(201);

      const fabric = res.body.materials.find((m: { rawMaterialId: string }) => m.rawMaterialId === fabricId);
      expect(fabric.alreadyReservedQty).toBe('180.0000');
      expect(fabric.newlyReservedQty).toBe('0.0000');

      const balance = await prisma.materialBalance.findFirstOrThrow({
        where: { rawMaterialId: fabricId, locationId: warehouseId },
      });
      expect(balance.reservedQty.toFixed(4)).toBe('180.0000');
    });

    it('replays an identical reservation request instead of repeating it', async () => {
      const k = key();
      const first = await http
        .post(`/api/manufacturing/orders/${moId}/reserve`)
        .set(auth())
        .send({ idempotencyKey: k })
        .expect(201);
      const replay = await http
        .post(`/api/manufacturing/orders/${moId}/reserve`)
        .set(auth())
        .send({ idempotencyKey: k })
        .expect(201);
      expect(replay.body).toEqual(first.body);
    });
  });

  // ==========================================================================
  // Release
  // ==========================================================================

  describe('release', () => {
    // ---- EXIT CRITERION 3 --------------------------------------------------
    it('refuses a shortage release without a reason', async () => {
      const res = await http
        .post(`/api/manufacturing/orders/${moId}/release`)
        .set(auth())
        .send({ idempotencyKey: key() })
        .expect(400);

      expect(res.body.code).toBe('SHORTAGE_OVERRIDE_REASON_REQUIRED');
    });

    it('refuses a shortage release from a user without the permission', async () => {
      // A planner holds manufacturing.release but not release_with_shortage.
      const bcrypt = await import('bcryptjs');
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: orgId, code: 'PRODUCTION_PLANNER' },
      });
      const planner = await prisma.user.create({
        data: {
          organizationId: orgId,
          email: `planner-${randomUUID().slice(0, 8)}@dashanddot.local`,
          fullName: 'E2E Planner',
          passwordHash: await bcrypt.hash('e2e-test-password', 10),
          status: 'ACTIVE',
          userRoles: { create: { roleId: role.id } },
        },
        select: { id: true, email: true },
      });

      // Grant exactly manufacturing.release, and nothing more.
      const releasePerm = await prisma.permission.findFirstOrThrow({
        where: { code: 'manufacturing.release' },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: releasePerm.id } },
        update: {},
        create: { roleId: role.id, permissionId: releasePerm.id },
      });

      const login = await http
        .post('/api/auth/login')
        .send({ email: planner.email, password: 'e2e-test-password' })
        .expect(200);
      const plannerToken = login.body.accessToken as string;
      expect(login.body.user.permissions).toContain('manufacturing.release');
      expect(login.body.user.permissions).not.toContain('manufacturing.release_with_shortage');

      const res = await http
        .post(`/api/manufacturing/orders/${moId}/release`)
        .set({ Authorization: `Bearer ${plannerToken}` })
        .send({
          idempotencyKey: key(),
          shortageOverrideReason: 'Balance fabric arrives Tuesday, start on what is here.',
        })
        .expect(422);

      expect(res.body.code).toBe('SHORTAGE_OVERRIDE_REQUIRED');
      expect(res.body.details.requiredPermission).toBe('manufacturing.release_with_shortage');
      // The error carries the real numbers, so the planner can act on it.
      expect(res.body.details.maxProducibleQty).toBe('68');
      expect(res.body.details.shortages[0]).toMatchObject({
        requiredQty: '262.5000',
        availableQty: '180.0000',
        shortageQty: '82.5000',
      });

      await prisma.user.delete({ where: { id: planner.id } });
    });

    it('does not require an override for a non-critical shortage alone', async () => {
      // Take the hang tags away but leave fabric and buttons covered.
      await giveStock(fabricId, '10000');
      await giveStock(tagId, '0');

      const res = await http.get(`/api/manufacturing/orders/${moId}/readiness`).set(auth()).expect(200);
      const tag = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === tagId);
      expect(tag.shortageQty).toBe('100.0000');
      expect(tag.isCritical).toBe(false);
      // Short of hang tags is not short of fabric.
      expect(res.body.isClear).toBe(true);
      expect(res.body.requiresShortageOverride).toBe(false);
    });

    it('releases the order and freezes the BOM snapshot', async () => {
      const res = await http
        .post(`/api/manufacturing/orders/${moId}/release`)
        .set(auth())
        .send({ idempotencyKey: key() })
        .expect(201);

      expect(res.body.status).toBe('RELEASED');
      expect(res.body.releasedQty).toBe('100.0000');
      expect(res.body.snapshotLineCount).toBe(3);
      expect(res.body.releasedWithShortage).toBe(false);
      // 669.65 per garment x 100.
      expect(res.body.plannedMaterialCost).toBe('66965.00');
      expect(res.body.bomVersionId).toBe(bomVersionId);
    });

    it('writes the snapshot with per-unit figures, not just totals', async () => {
      const res = await http.get(`/api/manufacturing/orders/${moId}`).set(auth()).expect(200);
      const fabric = res.body.bomSnapshotLines.find(
        (l: { rawMaterialId: string }) => l.rawMaterialId === fabricId,
      );
      expect(fabric.consumptionQtyPerUnit).toBe('2.5000');
      expect(fabric.wastageQtyPerUnit).toBe('0.1250');
      expect(fabric.grossQtyPerUnit).toBe('2.6250');
      expect(fabric.plannedQty).toBe('262.5000');
      expect(fabric.unitCost).toBe('250.000000');
      expect(fabric.source).toBe('FROZEN_AT_RELEASE');
    });

    it('refuses to edit a released order', async () => {
      const res = await http
        .patch(`/api/manufacturing/orders/${moId}`)
        .set(auth())
        .send({ priority: 'LOW' })
        .expect(409);
      expect(res.body.code).toBe('MO_NOT_EDITABLE');
    });

    it('refuses to release the same order twice', async () => {
      const res = await http
        .post(`/api/manufacturing/orders/${moId}/release`)
        .set(auth())
        .send({ idempotencyKey: key() })
        .expect(422);
      expect(res.body.code).toBe('MO_ILLEGAL_TRANSITION');
    });

    // ---- EXIT CRITERION 4 --------------------------------------------------
    it('leaves the released order untouched when the BOM is revised', async () => {
      const before = await http.get(`/api/manufacturing/orders/${moId}`).set(auth()).expect(200);
      const beforeFabric = before.body.bomSnapshotLines.find(
        (l: { rawMaterialId: string }) => l.rawMaterialId === fabricId,
      );
      expect(beforeFabric.grossQtyPerUnit).toBe('2.6250');

      // Approve version 2, which uses 2.7 m of fabric instead of 2.5 m.
      const bom = await http.get(`/api/bom/${bomId}`).set(auth()).expect(200);
      const draft = bom.body.versions.find((v: { status: string }) => v.status === 'DRAFT');
      await http.post(`/api/bom/versions/${draft.id}/submit`).set(auth()).expect(201);
      const approved = await http
        .post(`/api/bom/versions/${draft.id}/decision`)
        .set(auth())
        .send({ decision: 'APPROVE', setActive: true })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');

      // The previous version is superseded, not deleted: the lineage survives.
      const v1 = await http.get(`/api/bom/versions/${bomVersionId}`).set(auth()).expect(200);
      expect(v1.body.status).toBe('SUPERSEDED');
      expect(v1.body.supersededById).toBe(draft.id);

      // THE ASSERTION: the released order still reads the recipe it was
      // released against. A BOM edit cannot rewrite work already on the floor.
      const after = await http.get(`/api/manufacturing/orders/${moId}`).set(auth()).expect(200);
      const afterFabric = after.body.bomSnapshotLines.find(
        (l: { rawMaterialId: string }) => l.rawMaterialId === fabricId,
      );
      expect(afterFabric.grossQtyPerUnit).toBe('2.6250');
      expect(afterFabric.plannedQty).toBe('262.5000');
      expect(after.body.bomVersionId).toBe(bomVersionId);
      expect(Number(after.body.plannedMaterialCost)).toBe(66965);
    });

    it('plans a released order against its snapshot, not the newer BOM', async () => {
      const res = await http
        .post('/api/mrp/runs')
        .set(auth())
        .send({ manufacturingOrderIds: [moId] })
        .expect(201);

      const fabric = res.body.lines.find((l: { rawMaterialId: string }) => l.rawMaterialId === fabricId);
      // 2.625 m per garment from the snapshot, not 2.835 m from version 2.
      expect(fabric.grossRequiredQty).toBe('262.5000');
    });
  });

  // ==========================================================================
  // Cancellation
  // ==========================================================================

  describe('cancellation', () => {
    let cancelMoId: string;

    it('creates and reserves a second order', async () => {
      // Every line must be coverable: MATERIAL_RESERVED means the whole BOM is
      // reserved, not just the critical part of it.
      await giveStock(fabricId, '1000');
      await giveStock(buttonId, '10000');
      await giveStock(tagId, '1000');

      const created = await http
        .post('/api/manufacturing/orders')
        .set(auth())
        .send({ productId, items: [{ productVariantId: variantXxlId, orderedQty: '10' }] })
        .expect(201);
      cancelMoId = created.body.id;

      const reserved = await http
        .post(`/api/manufacturing/orders/${cancelMoId}/reserve`)
        .set(auth())
        .send({ idempotencyKey: key() })
        .expect(201);
      expect(reserved.body.status).toBe('MATERIAL_RESERVED');
      expect(reserved.body.fullyReserved).toBe(true);
    });

    it('releases every reservation when the order is cancelled', async () => {
      const before = await prisma.materialBalance.findFirstOrThrow({
        where: { rawMaterialId: fabricId, locationId: warehouseId },
      });
      expect(before.reservedQty.greaterThan(0)).toBe(true);

      const res = await http
        .post(`/api/manufacturing/orders/${cancelMoId}/cancel`)
        .set(auth())
        .send({ reason: 'Customer withdrew the order' })
        .expect(201);

      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.reservationsReleased).toBeGreaterThan(0);

      // Material nobody will use must not stay promised.
      const after = await prisma.materialBalance.findFirstOrThrow({
        where: { rawMaterialId: fabricId, locationId: warehouseId },
      });
      expect(after.reservedQty.toFixed(4)).toBe('0.0000');
      expect(after.onHandQty.toFixed(4)).toBe(before.onHandQty.toFixed(4));
    });

    it('refuses to cancel an already cancelled order', async () => {
      const res = await http
        .post(`/api/manufacturing/orders/${cancelMoId}/cancel`)
        .set(auth())
        .send({ reason: 'again' })
        .expect(422);
      expect(res.body.code).toBe('MO_ILLEGAL_TRANSITION');
    });
  });

  // ==========================================================================
  // Audit
  // ==========================================================================

  it('records the release in the audit log with the frozen figures', async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, entityType: 'ManufacturingOrder', entityId: moId, action: 'RELEASE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry.actorUserId).toBe(adminUserId);
    const context = entry.context as Record<string, unknown>;
    expect(context.snapshotLineCount).toBe(3);
    expect(context.bomVersionId).toBe(bomVersionId);
    expect(context.releasedQty).toBe('100.0000');
  });
});
