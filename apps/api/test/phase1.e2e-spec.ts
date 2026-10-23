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
 * Phase 1 end-to-end.
 *
 * Drives the real HTTP API against a real Postgres database, through the whole
 * raw-material path the specification describes:
 *
 *   sign in -> purchase order -> approval -> supplier delivery (GRN)
 *           -> incoming inspection -> stock available -> issue to cutting
 *           -> consumption -> ledger integrity
 *
 * Needs a database. Point TEST_DATABASE_URL (or DATABASE_URL) at one, with the
 * migrations applied and the seed run:
 *
 *   pnpm infra:up
 *   DATABASE_URL=... pnpm --filter @dnd/api prisma:deploy
 *   DATABASE_URL=... pnpm --filter @dnd/api seed
 *   DATABASE_URL=... pnpm --filter @dnd/api test:e2e
 */
const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('Phase 1: raw material path (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let token: string;

  // Resolved from the seeded master data.
  let orgId: string;
  let fabricId: string;
  let buttonId: string;
  let supplierId: string;
  let warehouseId: string;
  let cuttingDeptId: string;

  const key = () => randomUUID();

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

    // The e2e run needs a known password; the seed generates a random one, so
    // set a test password on the seeded admin here.
    const bcrypt = await import('bcryptjs');
    const admin = await prisma.user.findFirstOrThrow({
      where: { employeeCode: 'ADMIN' },
      select: { id: true, email: true, organizationId: true },
    });
    orgId = admin.organizationId;
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash('e2e-test-password', 10) },
    });

    const login = await http
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'e2e-test-password' })
      .expect(200);
    token = login.body.accessToken as string;

    const [fabric, button, supplier, warehouse, cutting] = await Promise.all([
      prisma.rawMaterial.findFirstOrThrow({ where: { organizationId: orgId, materialCode: 'FAB-001' } }),
      prisma.rawMaterial.findFirstOrThrow({ where: { organizationId: orgId, materialCode: 'BTN-001' } }),
      prisma.supplier.findFirstOrThrow({ where: { organizationId: orgId } }),
      prisma.materialLocation.findFirstOrThrow({ where: { organizationId: orgId, code: 'RM-WH-FAB' } }),
      prisma.materialLocation.findFirstOrThrow({ where: { organizationId: orgId, code: 'DEPT-CUT' } }),
    ]);
    fabricId = fabric.id;
    buttonId = button.id;
    supplierId = supplier.id;
    warehouseId = warehouse.id;
    cuttingDeptId = cutting.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // -------------------------------------------------------------------------

  it('refuses an unauthenticated request', async () => {
    await http.get('/api/materials').expect(401);
  });

  it('returns the signed-in user with resolved permissions', async () => {
    const res = await http.get('/api/auth/me').set(auth()).expect(200);
    expect(res.body.roles).toContain('SUPER_ADMIN');
    expect(res.body.permissions).toContain('inventory.adjust');
    expect(res.body.organizationId).toBe(orgId);
  });

  it('lists seeded raw materials with a zero stock position', async () => {
    const res = await http.get('/api/materials?pageSize=50').set(auth()).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(10);
    const fab = res.body.data.find((m: { materialCode: string }) => m.materialCode === 'FAB-001');
    expect(fab).toBeDefined();
    // The seed creates no stock, so this is genuinely zero rather than unknown.
    expect(fab.stock.onHandQty).toBe('0');
    expect(fab.stock.alertLevel).toBe('OUT_OF_STOCK');
  });

  it('serialises quantities as decimal strings, never as JSON numbers', async () => {
    const res = await http.get('/api/materials?pageSize=1').set(auth()).expect(200);
    const row = res.body.data[0];
    expect(typeof row.minimumStock).toBe('string');
    expect(typeof row.averageCost).toBe('string');
  });

  it('refuses a unit conversion that was never configured', async () => {
    // KILOGRAM to METER needs GSM and width; the system must not guess.
    const res = await http
      .get(`/api/materials/uom-conversions/preview?rawMaterialId=${fabricId}&fromUom=KILOGRAM&toUom=METER&quantity=10`)
      .set(auth())
      .expect(200);
    expect(res.body.convertible).toBe(false);
    expect(res.body.convertedQty).toBeNull();
  });

  it('applies the per-material roll conversion the seed configured', async () => {
    // FAB-001 is seeded as 100 m per roll.
    const res = await http
      .get(`/api/materials/uom-conversions/preview?rawMaterialId=${fabricId}&fromUom=ROLL&toUom=METER&quantity=2.5`)
      .set(auth())
      .expect(200);
    expect(res.body.convertible).toBe(true);
    expect(res.body.convertedQty).toBe('250');
  });

  // --- purchasing ---------------------------------------------------------

  let poId: string;
  let fabricPoItemId: string;
  let buttonPoItemId: string;

  it('creates a purchase order for 500 m of fabric and 10000 buttons', async () => {
    const res = await http
      .post('/api/purchasing/orders')
      .set(auth())
      .send({
        supplierId,
        expectedDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        overReceiptTolerancePct: '2',
        underReceiptTolerancePct: '1',
        freightAmount: '5000',
        currency: 'INR',
        items: [
          { rawMaterialId: fabricId, orderedQty: '500', uom: 'METER', rate: '245.50', discountPct: '0', taxPct: '5' },
          { rawMaterialId: buttonId, orderedQty: '10000', uom: 'PIECE', rate: '3.25', discountPct: '0', taxPct: '12' },
        ],
      })
      .expect(201);

    poId = res.body.id;
    expect(res.body.status).toBe('PENDING_APPROVAL');
    expect(res.body.items).toHaveLength(2);

    const fab = res.body.items.find((i: { rawMaterialId: string }) => i.rawMaterialId === fabricId);
    const btn = res.body.items.find((i: { rawMaterialId: string }) => i.rawMaterialId === buttonId);
    fabricPoItemId = fab.id;
    buttonPoItemId = btn.id;

    // 500 x 245.50 = 122,750 ; 10000 x 3.25 = 32,500 ; subtotal 155,250
    // Money crosses the wire as a canonical decimal string with no trailing
    // zeros, so 155250.00 is serialised as "155250".
    expect(res.body.subtotalAmount).toBe('155250');
    // tax: 122750 x 5% = 6137.50 ; 32500 x 12% = 3900 => 10037.50
    expect(res.body.taxAmount).toBe('10037.5');
    expect(res.body.totalAmount).toBe('170287.5');
  });

  it('will not accept a delivery against an unapproved purchase order', async () => {
    await http
      .post('/api/purchasing/receipts')
      .set(auth())
      .send({
        idempotencyKey: key(),
        purchaseOrderId: poId,
        supplierId,
        targetLocationId: warehouseId,
        lines: [{ purchaseItemId: fabricPoItemId, rawMaterialId: fabricId, receivedQty: '100', uom: 'METER' }],
      })
      .expect(400);
  });

  it('approves the purchase order', async () => {
    const res = await http
      .post(`/api/purchasing/orders/${poId}/decision`)
      .set(auth())
      .send({ decision: 'APPROVE' })
      .expect(201);
    expect(res.body.status).toBe('APPROVED');
  });

  // --- partial delivery ---------------------------------------------------

  let firstReceiptId: string;

  it('receives a partial delivery of 300 m with three fabric rolls', async () => {
    const res = await http
      .post('/api/purchasing/receipts')
      .set(auth())
      .send({
        idempotencyKey: key(),
        purchaseOrderId: poId,
        supplierId,
        targetLocationId: warehouseId,
        supplierInvoiceNo: 'INV-E2E-001',
        freightAmount: '3000',
        lines: [
          {
            purchaseItemId: fabricPoItemId,
            rawMaterialId: fabricId,
            receivedQty: '300',
            uom: 'METER',
            rate: '245.50',
            shade: 'IND-BLUE-A',
            width: '58',
            rolls: [{ length: '100' }, { length: '100' }, { length: '100' }],
          },
        ],
      })
      .expect(201);

    firstReceiptId = res.body.result.id;
    expect(res.body.result.status).toBe('PENDING_INSPECTION');
    expect(res.body.result.lines[0].rolls).toHaveLength(3);
    expect(res.body.result.barcode).toMatch(/^GRN-/);
    expect(res.body.replayed).toBe(false);
  });

  it('leaves 200 m outstanding and does not close the purchase order', async () => {
    const res = await http.get(`/api/purchasing/orders/${poId}`).set(auth()).expect(200);
    expect(res.body.status).toBe('PARTIALLY_RECEIVED');
    expect(res.body.closure.canAutoClose).toBe(false);
    const fab = res.body.items.find((i: { id: string }) => i.id === fabricPoItemId);
    expect(fab.receivedBaseQty).toBe('300');
    expect(fab.pendingBaseQty).toBe('200');
  });

  it('holds the received fabric in QC hold, not in the warehouse', async () => {
    const res = await http
      .get(`/api/inventory/balances?rawMaterialId=${fabricId}&pageSize=50`)
      .set(auth())
      .expect(200);

    const qcHold = res.body.data.filter((b: { location: { kind: string } }) => b.location.kind === 'QUALITY_HOLD');
    const inWarehouse = res.body.data.filter((b: { locationId: string }) => b.locationId === warehouseId);
    expect(qcHold).toHaveLength(1);
    expect(qcHold[0].onHandQty).toBe('300');
    // Not issuable until inspection releases it.
    expect(inWarehouse).toHaveLength(0);
  });

  it('reports the QC-hold quantity separately from available stock', async () => {
    const res = await http.get(`/api/materials/${fabricId}`).set(auth()).expect(200);
    expect(res.body.stock.qualityHoldQty).toBe('300');
    expect(res.body.stock.availableQty).toBe('0');
    expect(res.body.stock.onHandQty).toBe('300');
  });

  it('replays an identical receipt submission instead of receiving twice', async () => {
    const replayKey = key();
    const payload = {
      idempotencyKey: replayKey,
      purchaseOrderId: poId,
      supplierId,
      targetLocationId: warehouseId,
      lines: [
        { purchaseItemId: buttonPoItemId, rawMaterialId: buttonId, receivedQty: '4000', uom: 'PIECE', rate: '3.25' },
      ],
    };

    const first = await http.post('/api/purchasing/receipts').set(auth()).send(payload).expect(201);
    expect(first.body.replayed).toBe(false);

    const second = await http.post('/api/purchasing/receipts').set(auth()).send(payload).expect(201);
    expect(second.body.replayed).toBe(true);
    expect(second.body.result.grnNo).toBe(first.body.result.grnNo);

    // The decisive check: buttons were received ONCE.
    const po = await http.get(`/api/purchasing/orders/${poId}`).set(auth()).expect(200);
    const btn = po.body.items.find((i: { id: string }) => i.id === buttonPoItemId);
    expect(btn.receivedBaseQty).toBe('4000');
  });

  // --- inspection ---------------------------------------------------------

  it('refuses an inspection split that does not account for the whole receipt', async () => {
    const receipt = await http.get(`/api/purchasing/receipts/${firstReceiptId}`).set(auth()).expect(200);
    const lineId = receipt.body.lines[0].id;

    const res = await http
      .post(`/api/purchasing/receipts/${firstReceiptId}/inspect`)
      .set(auth())
      .send({
        idempotencyKey: key(),
        lines: [{ receiptLineId: lineId, acceptedQty: '280', rejectedQty: '10' }],
      })
      .expect(409);
    expect(res.body.code).toBe('INSPECTION_SPLIT_MISMATCH');
    expect(res.body.details.receivedBaseQty).toBe('300');
  });

  it('refuses a partial rejection that is not attributed to a roll', async () => {
    const receipt = await http.get(`/api/purchasing/receipts/${firstReceiptId}`).set(auth()).expect(200);
    const lineId = receipt.body.lines[0].id;

    const res = await http
      .post(`/api/purchasing/receipts/${firstReceiptId}/inspect`)
      .set(auth())
      .send({
        idempotencyKey: key(),
        lines: [{ receiptLineId: lineId, acceptedQty: '290', rejectedQty: '10' }],
      })
      .expect(400);
    expect(res.body.code).toBe('ROLL_REJECTION_NOT_ALLOCATED');
  });

  it('inspects the delivery: 290 m accepted, 10 m rejected off one roll', async () => {
    const receipt = await http.get(`/api/purchasing/receipts/${firstReceiptId}`).set(auth()).expect(200);
    const lineId = receipt.body.lines[0].id;

    const res = await http
      .post(`/api/purchasing/receipts/${firstReceiptId}/inspect`)
      .set(auth())
      .send({
        idempotencyKey: key(),
        lines: [
          {
            receiptLineId: lineId,
            acceptedQty: '290',
            rejectedQty: '10',
            rejectionReason: 'Shade variation at the start of one roll',
            // The rejected length has to be attributed to a specific roll,
            // otherwise roll lengths and the ledger would diverge.
            rollDecisions: [{ fabricRollId: receipt.body.lines[0].lots[0].fabricRolls[0].id, rejectedLength: '10' }],
          },
        ],
      })
      .expect(201);

    expect(res.body.result.status).toBe('POSTED');
    expect(res.body.result.lines[0].result).toBe('HOLD');
    expect(res.body.result.lines[0].acceptedQty).toBe('290');
  });

  it('releases 290 m to the warehouse and quarantines the 10 m', async () => {
    const res = await http.get(`/api/materials/${fabricId}`).set(auth()).expect(200);
    expect(res.body.stock.availableQty).toBe('290');
    expect(res.body.stock.blockedQty).toBe('10');
    expect(res.body.stock.qualityHoldQty).toBe('0');
    // 290 usable + 10 blocked: the organisation still owns all 300.
    expect(res.body.stock.onHandQty).toBe('300');
  });

  it('records a weighted average cost including apportioned freight', async () => {
    const material = await prisma.rawMaterial.findUniqueOrThrow({
      where: { id: fabricId },
      select: { averageCost: true },
    });
    // Line rate 245.50 plus the whole 3000 freight over 300 m (it is the only
    // line on that receipt) = 10/m, so the lot cost is 255.50 - and because the
    // average is derived from lot costs, the whole 300 m values at 255.50 even
    // while 10 m is still sitting in the rejected area.
    expect(material.averageCost.toFixed(2)).toBe('255.50');
  });

  it('splits the rejected roll rather than moving it whole', async () => {
    const res = await http
      .get(`/api/fabric-rolls?rawMaterialId=${fabricId}&pageSize=50`)
      .set(auth())
      .expect(200);

    // Three rolls arrived; one was cut, so there are now four roll records.
    expect(res.body.total).toBe(4);

    const available = res.body.data.filter((r: { status: string }) => r.status === 'AVAILABLE');
    const blocked = res.body.data.filter((r: { status: string }) => r.status === 'BLOCKED');

    expect(available.map((r: { currentLength: string }) => r.currentLength).sort())
      .toEqual(['100', '100', '90']);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].currentLength).toBe('10');
    expect(blocked[0].rollNo).toMatch(/-REJ$/);

    // Every roll, accepted or rejected, carries its own scannable barcode.
    for (const roll of res.body.data) {
      expect(roll.barcode.code).toMatch(/^ROL-/);
    }
    // 100 + 100 + 90 + 10 = 300, exactly what the supplier delivered.
    const total = res.body.data.reduce(
      (acc: number, r: { currentLength: string }) => acc + Number(r.currentLength),
      0,
    );
    expect(total).toBe(300);
  });

  // --- issue to production ------------------------------------------------

  it('suggests which rolls to open for 262.5 m', async () => {
    const res = await http
      .get(`/api/fabric-rolls/suggest?rawMaterialId=${fabricId}&requiredLength=262.5`)
      .set(auth())
      .expect(200);
    expect(res.body.selectedLength).toBe('262.5');
    expect(res.body.shortfallLength).toBe('0');
    expect(res.body.rolls).toHaveLength(3);
    expect(res.body.requiresShadeApproval).toBe(false);
  });

  it('issues 100 m off one roll to the cutting department', async () => {
    const rolls = await http
      .get(`/api/fabric-rolls?rawMaterialId=${fabricId}&status=AVAILABLE&pageSize=50`)
      .set(auth())
      .expect(200);
    const roll = rolls.body.data.find((r: { currentLength: string }) => r.currentLength === '100');
    expect(roll).toBeDefined();

    const res = await http
      .post('/api/fabric-rolls/issue')
      .set(auth())
      .send({
        idempotencyKey: key(),
        fabricRollId: roll.id,
        quantity: '100',
        destinationLocationId: cuttingDeptId,
        remarks: 'e2e cutting issue',
      })
      .expect(201);

    expect(res.body.result.issuedLength).toBe('100');
    expect(res.body.result.remainingLength).toBe('0');
    expect(res.body.result.status).toBe('EXHAUSTED');
  });

  it('issuing moved the fabric without consuming it', async () => {
    const res = await http.get(`/api/materials/${fabricId}`).set(auth()).expect(200);
    // 290 accepted: 190 still in the warehouse, 100 now on the cutting floor.
    // Owned quantity is unchanged - this is the invariant that stops fabric
    // being deducted again at every stage it passes through.
    expect(res.body.stock.onHandQty).toBe('300');
    // The 100 m on the cutting floor is owned but no longer available to a
    // second order.
    expect(res.body.stock.availableQty).toBe('190');
    expect(res.body.stock.issuedToProductionQty).toBe('100');
    const atCutting = res.body.balancesByLocation.find(
      (b: { locationId: string }) => b.locationId === cuttingDeptId,
    );
    expect(atCutting.onHandQty).toBe('100');
  });

  it('refuses to issue more off an exhausted roll', async () => {
    const rolls = await http
      .get(`/api/fabric-rolls?rawMaterialId=${fabricId}&status=EXHAUSTED`)
      .set(auth())
      .expect(200);
    const exhausted = rolls.body.data[0];

    const res = await http
      .post('/api/fabric-rolls/issue')
      .set(auth())
      .send({
        idempotencyKey: key(),
        fabricRollId: exhausted.id,
        quantity: '1',
        destinationLocationId: cuttingDeptId,
      })
      .expect(422);
    expect(res.body.code).toBe('ROLL_NOT_ISSUABLE');
  });

  // --- ledger integrity ---------------------------------------------------

  it('keeps the material ledger balanced to exactly zero', async () => {
    // The defining invariant: across every location including the virtual
    // counter-accounts, the signed balances for a material sum to zero.
    for (const materialId of [fabricId, buttonId]) {
      const balances = await prisma.materialBalance.findMany({
        where: { rawMaterialId: materialId },
        select: { onHandQty: true },
      });
      expect(balances.length).toBeGreaterThan(0);
      const total = balances.reduce<Prisma.Decimal>(
        (acc, b) => acc.plus(b.onHandQty),
        new Prisma.Decimal(0),
      );
      expect(total.toFixed()).toBe('0');
    }
  });

  it('reconciles fabric roll lengths against the ledger', async () => {
    const res = await http.get('/api/fabric-rolls/reconciliation').set(auth()).expect(200);
    expect(res.body.isReconciled).toBe(true);
    expect(res.body.variances).toHaveLength(0);
  });

  it('recorded every stock change as a ledger movement', async () => {
    const res = await http
      .get(`/api/inventory/movements?rawMaterialId=${fabricId}&pageSize=50`)
      .set(auth())
      .expect(200);

    const types = res.body.data.map((m: { movementType: string }) => m.movementType).sort();
    expect(types).toContain('PURCHASE_INWARD');
    expect(types).toContain('QC_RELEASE');
    expect(types).toContain('QC_REJECT');
    expect(types).toContain('ISSUE_TO_PRODUCTION');

    for (const m of res.body.data) {
      expect(Number(m.baseQty)).toBeGreaterThan(0);
      expect(m.sourceLocationId).not.toBe(m.destinationLocationId);
      expect(m.movementNo).toMatch(/^MOV-/);
    }
  });

  it('audited the elevated actions', async () => {
    const res = await http
      .get('/api/admin/audit?pageSize=100&entityType=RawMaterialPurchaseOrder')
      .set(auth())
      .expect(200);
    const actions = res.body.data.map((a: { action: string }) => a.action);
    expect(actions).toContain('APPROVE');
    expect(actions).toContain('CREATE');
  });

  it('surfaces live stock alerts from the ledger', async () => {
    const res = await http.get('/api/inventory/alerts').set(auth()).expect(200);
    expect(res.body.alerts.length).toBeGreaterThan(0);
    // FAB-001 has 190 m available against a 400 m reorder level and a 200 m
    // minimum, so it is below minimum.
    const fab = res.body.alerts.find((a: { materialCode: string }) => a.materialCode === 'FAB-001');
    expect(fab.alertLevel).toBe('BELOW_MINIMUM');
    expect(fab.availableQty).toBe('190');
  });

  it('reports real figures on the dashboard, and flags unbuilt modules honestly', async () => {
    const res = await http.get('/api/dashboard/summary').set(auth()).expect(200);
    expect(res.body.inventory.available).toBe(true);
    expect(Number(res.body.inventory.movementsToday)).toBeGreaterThan(0);
    expect(Number(res.body.inventory.rawMaterialStockValue)).toBeGreaterThan(0);
    expect(res.body.purchasing.openPurchaseOrders).toBeGreaterThanOrEqual(1);

    // Production reports real figures now that phases 2 and 3 are delivered.
    // It used to assert `available: false`; that assertion was correct when
    // written and became a lie the moment the module shipped, which is exactly
    // what this test is here to catch in the other direction.
    expect(res.body.production.available).toBe(true);
    expect(Array.isArray(res.body.production.line)).toBe(true);
    expect(res.body.production.orders).toBeDefined();

    // Finished goods genuinely does not exist yet, so it still says so rather
    // than reporting a zero that reads as a measurement.
    expect(res.body.finishedGoods.available).toBe(false);
    expect(res.body.finishedGoods.phase).toBe(5);
  });

  // --- authorisation ------------------------------------------------------

  it('enforces permissions on the server, not just in the UI', async () => {
    const bcrypt = await import('bcryptjs');
    const operatorRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: orgId, code: 'BARCODE_OPERATOR' },
      select: { id: true },
    });
    const operator = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `operator-${randomUUID()}@dashanddot.local`,
        fullName: 'Shop Floor Operator',
        employeeCode: `OP-${Date.now()}`,
        passwordHash: await bcrypt.hash('operator-test-password', 10),
        userRoles: { create: [{ roleId: operatorRole.id }] },
      },
      select: { email: true },
    });

    const login = await http
      .post('/api/auth/login')
      .send({ email: operator.email, password: 'operator-test-password' })
      .expect(200);
    const operatorAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    // A barcode operator may read manufacturing orders...
    expect(login.body.user.permissions).toContain('production.scan');
    expect(login.body.user.permissions).not.toContain('inventory.adjust');

    // ...but cannot adjust stock, and the refusal names what is missing.
    const denied = await http
      .post('/api/inventory/adjust')
      .set(operatorAuth)
      .send({
        idempotencyKey: key(),
        rawMaterialId: fabricId,
        materialLotId: randomUUID(),
        locationId: warehouseId,
        adjustmentQty: '1000',
        uom: 'METER',
        reason: 'should be refused',
      })
      .expect(403);
    expect(denied.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect(denied.body.details.missing).toContain('inventory.adjust');
  });
});
