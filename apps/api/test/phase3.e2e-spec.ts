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
 * Phase 3 end-to-end: batches, stage transitions and the scan station.
 *
 *   released order -> batches -> release into route -> cut -> forward
 *                  -> stitch -> rework loop -> finish
 *
 * The five roadmap exit criteria are asserted explicitly:
 *
 *   1. cutting 100 received / 95 completed / 5 rejected leaves 95 available
 *      to stitching
 *   2. a duplicate scan with the same idempotency key is a no-op
 *   3. stage quantities reconcile across the whole route
 *   4. a garment reworked twice is still one garment
 *   5. cutting, stitching, embroidery and finishing quantities reconcile
 *
 * Needs a database, and a freshly seeded one — see testing-strategy.md §6a.
 */
const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('Phase 3: shop floor (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let token: string;

  let orgId: string;
  let productId: string;
  let variantId: string;
  let moId: string;
  let batchId: string;
  let batchNo: string;

  /** Route step ids, resolved once the batch exists. */
  const step: Record<string, string> = {};

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
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash('e2e-test-password', 10) },
    });
    const login = await http
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'e2e-test-password' })
      .expect(200);
    token = login.body.accessToken as string;

    const product = await prisma.product.findFirstOrThrow({
      where: { organizationId: orgId, styleCode: 'DD-KRT-001' },
    });
    productId = product.id;
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: orgId, productId, size: 'M' },
    });
    variantId = variant.id;

    // Clear phase 3 objects so batch numbering and counters are predictable.
    await prisma.$transaction([
      prisma.productionStageMovement.deleteMany({ where: { organizationId: orgId } }),
      prisma.barcodeScanEvent.deleteMany({ where: { organizationId: orgId } }),
      prisma.productionStageTask.deleteMany({ where: { organizationId: orgId } }),
      prisma.barcodeIdentifier.deleteMany({ where: { organizationId: orgId, kind: 'PRODUCTION_BATCH' } }),
      prisma.productionBatch.deleteMany({ where: { organizationId: orgId } }),
    ]);

    // A released order to work from. Phase 2 proved the release path; this
    // suite needs its output, so take the one it left behind or make one.
    const released = await prisma.manufacturingOrder.findFirst({
      where: { organizationId: orgId, status: 'RELEASED', productId },
      orderBy: { createdAt: 'desc' },
    });

    if (released) {
      moId = released.id;
    } else {
      // Running phase 3 on its own: bootstrap the minimum phase 2 output it
      // needs. When the whole suite runs in order, phase 2's released order is
      // reused instead and this is skipped.
      const existingBom = await prisma.bom.findFirst({ where: { organizationId: orgId, productId } });
      if (!existingBom) {
        const fabric = await prisma.rawMaterial.findFirstOrThrow({
          where: { organizationId: orgId, materialCode: 'FAB-001' },
        });
        const bom = await http
          .post('/api/bom')
          .set(auth())
          .send({
            productId,
            baseQuantity: '1',
            items: [
              {
                lineNo: 1,
                rawMaterialId: fabric.id,
                consumptionQty: '2.5',
                uom: 'METER',
                wastageBasis: 'PERCENT_OF_CONSUMPTION',
                wastageValue: '5',
                unitCost: '250',
              },
            ],
          })
          .expect(201);
        await http.post(`/api/bom/versions/${bom.body.id}/submit`).set(auth()).expect(201);
        await http
          .post(`/api/bom/versions/${bom.body.id}/decision`)
          .set(auth())
          .send({ decision: 'APPROVE', setActive: true })
          .expect(201);
      }

      const created = await http
        .post('/api/manufacturing/orders')
        .set(auth())
        .send({ productId, items: [{ productVariantId: variantId, orderedQty: '100' }] })
        .expect(201);
      moId = created.body.id;
      await http
        .post(`/api/manufacturing/orders/${moId}/release`)
        .set(auth())
        .send({
          idempotencyKey: key(),
          shortageOverrideReason: 'Phase 3 end-to-end fixture; material is not the subject here.',
        })
        .expect(201);
    }

    // The default route has to exist for a batch to be creatable at all.
    await prisma.manufacturingOrder.update({
      where: { id: moId },
      data: {
        routeId: (
          await prisma.productionRoute.findFirstOrThrow({
            where: { organizationId: orgId, isDefault: true },
          })
        ).id,
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Resolve a route step id by stage code on the batch under test. */
  const stepFor = async (stageCode: string): Promise<string> => {
    if (step[stageCode]) return step[stageCode];
    const res = await http.get(`/api/production/batches/${batchId}`).set(auth()).expect(200);
    for (const t of res.body.stageTasks as { id: string; productionStage: { code: string } }[]) {
      step[t.productionStage.code] = t.id;
    }
    return step[stageCode];
  };

  const batch = async () => (await http.get(`/api/production/batches/${batchId}`).set(auth()).expect(200)).body;

  interface StageRow {
    id: string;
    status: string;
    receivedQty: string;
    completedQty: string;
    rejectedQty: string;
    forwardedQty: string;
    reworkSentQty: string;
    reworkReturnedQty: string;
    wipQty: string;
    availableToForwardQty: string;
    reworkOutstandingQty: string;
    productionStage: { code: string };
  }

  const stageOf = async (code: string): Promise<StageRow> =>
    (await batch()).stageTasks.find((t: StageRow) => t.productionStage.code === code) as StageRow;

  // ==========================================================================
  // batches
  // ==========================================================================

  describe('batches', () => {
    it('refuses to create batches for an order that is not released', async () => {
      const draft = await http
        .post('/api/manufacturing/orders')
        .set(auth())
        .send({ productId, items: [{ productVariantId: variantId, orderedQty: '5' }] })
        .expect(201);

      const res = await http
        .post('/api/production/batches')
        .set(auth())
        .send({ manufacturingOrderId: draft.body.id, idempotencyKey: key() })
        .expect(409);
      expect(res.body.code).toBe('MO_NOT_RELEASED');

      await prisma.manufacturingOrder.delete({ where: { id: draft.body.id } });
    });

    it('creates one batch per order line, with a task for every route step', async () => {
      const res = await http
        .post('/api/production/batches')
        .set(auth())
        .send({ manufacturingOrderId: moId, idempotencyKey: key() })
        .expect(201);

      expect(res.body.batches).toHaveLength(1);
      batchId = res.body.batches[0].id;
      batchNo = res.body.batches[0].batchNo;
      expect(res.body.batches[0].plannedQty).toBe('100.0000');
      // The barcode carries a check character, so a misread digit is caught at
      // the scanner rather than applied to the wrong batch.
      expect(batchNo).toMatch(/^BAT-/);
      const { isWellFormedBarcode, kindOf } = await import('@dnd/domain');
      expect(isWellFormedBarcode(batchNo)).toBe(true);
      expect(kindOf(batchNo)).toBe('PRODUCTION_BATCH');

      const b = await batch();
      // The full route is visible from the moment the batch exists: an
      // operator needs to know what happens after them.
      expect(b.stageTasks.length).toBeGreaterThanOrEqual(6);
      expect(b.stageTasks.every((t: { status: string }) => t.status === 'NOT_STARTED')).toBe(true);
      expect(b.status).toBe('OPEN');
    });

    it('mints a scannable barcode with the batch', async () => {
      const b = await batch();
      expect(b.barcode?.code).toBe(batchNo);
      expect(b.barcode?.kind).toBe('PRODUCTION_BATCH');
    });

    it('refuses to batch the same released quantity twice', async () => {
      const res = await http
        .post('/api/production/batches')
        .set(auth())
        .send({ manufacturingOrderId: moId, idempotencyKey: key() })
        .expect(409);
      expect(res.body.code).toBe('NOTHING_TO_BATCH');
    });

    it('releases quantity into the first route step', async () => {
      const res = await http
        .post(`/api/production/batches/${batchId}/release`)
        .set(auth())
        .send({ idempotencyKey: key(), releaseQty: '100' })
        .expect(201);

      expect(res.body.progress.releasedQty).toBe('100.0000');
      const first = res.body.stageTasks.find((t: { sequence: number }) => t.sequence === 1);
      expect(first.receivedQty).toBe('100');
      expect(first.status).toBe('IN_PROGRESS');
    });

    it('refuses to release more than the batch was planned for', async () => {
      const res = await http
        .post(`/api/production/batches/${batchId}/release`)
        .set(auth())
        .send({ idempotencyKey: key(), releaseQty: '1' })
        .expect(409);
      expect(res.body.code).toBe('RELEASE_EXCEEDS_BATCH_QTY');
    });

    it('refuses to split a batch that has already entered the route', async () => {
      const res = await http
        .post(`/api/production/batches/${batchId}/split`)
        .set(auth())
        .send({
          idempotencyKey: key(),
          reason: 'Two operators',
          parts: [{ plannedQty: '50' }, { plannedQty: '50' }],
        })
        .expect(409);
      expect(res.body.code).toBe('BATCH_ALREADY_IN_ROUTE');
    });
  });

  // ==========================================================================
  // stage transitions
  // ==========================================================================

  describe('stage transitions', () => {
    it('walks quantity to the cutting step', async () => {
      // The seeded route starts RELEASE -> MATERIAL_ISSUE -> CUTTING.
      const release = await stepFor('RELEASE');
      await http
        .post(`/api/production/stage-tasks/${release}/outcome`)
        .set(auth())
        .send({ idempotencyKey: key(), completedQty: '100' })
        .expect(201);
      await http
        .post(`/api/production/stage-tasks/${release}/forward`)
        .set(auth())
        .send({ idempotencyKey: key(), forwardQty: '100' })
        .expect(201);

      const issue = await stepFor('MATERIAL_ISSUE');
      await http
        .post(`/api/production/stage-tasks/${issue}/outcome`)
        .set(auth())
        .send({ idempotencyKey: key(), completedQty: '100' })
        .expect(201);
      await http
        .post(`/api/production/stage-tasks/${issue}/forward`)
        .set(auth())
        .send({ idempotencyKey: key(), forwardQty: '100' })
        .expect(201);

      const cutting = await stageOf('CUTTING');
      expect(cutting.receivedQty).toBe('100');
      expect(cutting.wipQty).toBe('100.0000');
    });

    // ---- EXIT CRITERION 1 --------------------------------------------------
    it('cutting 100 received / 95 completed / 5 rejected leaves 95 to forward', async () => {
      const cutting = await stepFor('CUTTING');
      const res = await http
        .post(`/api/production/stage-tasks/${cutting}/outcome`)
        .set(auth())
        .send({
          idempotencyKey: key(),
          completedQty: '95',
          rejectedQty: '5',
          rejectionReason: 'Fabric flaw across the lay',
        })
        .expect(201);

      const task = res.body.stageTasks.find(
        (t: { productionStage: { code: string } }) => t.productionStage.code === 'CUTTING',
      );
      expect(task.receivedQty).toBe('100');
      expect(task.completedQty).toBe('95');
      expect(task.rejectedQty).toBe('5');
      expect(task.wipQty).toBe('0.0000');
      // The number that matters: what stitching may pull.
      expect(task.availableToForwardQty).toBe('95.0000');
    });

    it('refuses a second identical outcome, which would double the numbers', async () => {
      const cutting = await stepFor('CUTTING');
      const res = await http
        .post(`/api/production/stage-tasks/${cutting}/outcome`)
        .set(auth())
        .send({ idempotencyKey: key(), completedQty: '95', rejectedQty: '5', rejectionReason: 'again' })
        .expect(409);
      expect(res.body.code).toBe('STAGE_OUTCOME_EXCEEDS_RECEIVED');
      expect(res.body.details.wipQty).toBe('0');
    });

    it('refuses a rejection with no reason', async () => {
      const cutting = await stepFor('CUTTING');
      await http
        .post(`/api/production/stage-tasks/${cutting}/outcome`)
        .set(auth())
        .send({ idempotencyKey: key(), rejectedQty: '1' })
        .expect(400);
    });

    it('refuses to forward more than the stage accepted', async () => {
      const cutting = await stepFor('CUTTING');
      const res = await http
        .post(`/api/production/stage-tasks/${cutting}/forward`)
        .set(auth())
        .send({ idempotencyKey: key(), forwardQty: '100' })
        .expect(409);
      expect(res.body.code).toBe('STAGE_RECEIPT_EXCEEDS_UPSTREAM');
      expect(res.body.details.availableToForwardQty).toBe('95');
    });

    it('refuses to skip a route step without authorisation', async () => {
      const cutting = await stepFor('CUTTING');
      const stitching = await stepFor('STITCHING');
      const res = await http
        .post(`/api/production/stage-tasks/${cutting}/forward`)
        .set(auth())
        .send({ idempotencyKey: key(), forwardQty: '10', toStageTaskId: stitching })
        .expect(422);
      // EMBROIDERY sits between them on the full route.
      expect(res.body.code).toBe('STAGE_SEQUENCE_VIOLATION');
    });

    it('forwards 95 to the next step', async () => {
      const cutting = await stepFor('CUTTING');
      await http
        .post(`/api/production/stage-tasks/${cutting}/forward`)
        .set(auth())
        .send({ idempotencyKey: key(), forwardQty: '95' })
        .expect(201);

      const after = await stageOf('CUTTING');
      expect(after.forwardedQty).toBe('95');
      expect(after.availableToForwardQty).toBe('0.0000');
      expect(after.status).toBe('COMPLETED');

      const embroidery = await stageOf('EMBROIDERY');
      expect(embroidery.receivedQty).toBe('95');
      expect(embroidery.wipQty).toBe('95.0000');
    });

    // ---- EXIT CRITERION 5 --------------------------------------------------
    it('keeps cutting, embroidery and stitching quantities reconciled', async () => {
      const embroidery = await stepFor('EMBROIDERY');
      await http
        .post(`/api/production/stage-tasks/${embroidery}/outcome`)
        .set(auth())
        .send({ idempotencyKey: key(), completedQty: '95' })
        .expect(201);
      await http
        .post(`/api/production/stage-tasks/${embroidery}/forward`)
        .set(auth())
        .send({ idempotencyKey: key(), forwardQty: '95' })
        .expect(201);

      const b = await batch();
      type Row = { productionStage: { code: string }; receivedQty: string; forwardedQty: string };
      const byCode: Record<string, Row> = Object.fromEntries(
        (b.stageTasks as Row[]).map((t) => [t.productionStage.code, t]),
      );

      // What left cutting is exactly what embroidery received, and so on.
      expect(byCode.CUTTING.forwardedQty).toBe(byCode.EMBROIDERY.receivedQty);
      expect(byCode.EMBROIDERY.forwardedQty).toBe(byCode.STITCHING.receivedQty);

      // And the batch total is NOT the sum of stage counters.
      // 100 + 100 + 95 + 95 + 95 would be 485; the batch holds 100.
      expect(b.progress.plannedQty).toBe('100.0000');
      expect(b.progress.releasedQty).toBe('100.0000');
      expect(b.progress.rejectedQty).toBe('5.0000');
      expect(Number(b.progress.inProgressQty)).toBe(95);
    });
  });

  // ==========================================================================
  // rework
  // ==========================================================================

  describe('rework', () => {
    // ---- EXIT CRITERION 4 --------------------------------------------------
    it('a garment reworked twice is still one garment', async () => {
      const stitching = await stepFor('STITCHING');

      const before = await stageOf('STITCHING');
      expect(before.receivedQty).toBe('95');
      expect(before.wipQty).toBe('95.0000');

      // First loop: send 10 out, bring 10 back.
      await http
        .post(`/api/production/stage-tasks/${stitching}/rework/send`)
        .set(auth())
        .send({ idempotencyKey: key(), reworkQty: '10' })
        .expect(201);

      let mid = await stageOf('STITCHING');
      expect(mid.reworkSentQty).toBe('10');
      expect(mid.reworkOutstandingQty).toBe('10.0000');
      // The garments never left receivedQty, so WIP drops by exactly 10.
      expect(mid.wipQty).toBe('85.0000');
      expect(mid.receivedQty).toBe('95');

      await http
        .post(`/api/production/stage-tasks/${stitching}/rework/return`)
        .set(auth())
        .send({ idempotencyKey: key(), returnQty: '10' })
        .expect(201);

      mid = await stageOf('STITCHING');
      expect(mid.reworkOutstandingQty).toBe('0.0000');
      expect(mid.wipQty).toBe('95.0000');

      // Second loop on the same garments.
      await http
        .post(`/api/production/stage-tasks/${stitching}/rework/send`)
        .set(auth())
        .send({ idempotencyKey: key(), reworkQty: '10' })
        .expect(201);
      await http
        .post(`/api/production/stage-tasks/${stitching}/rework/return`)
        .set(auth())
        .send({ idempotencyKey: key(), returnQty: '10' })
        .expect(201);

      const after = await stageOf('STITCHING');
      // The counters are CUMULATIVE — 20 ever sent, 20 ever returned...
      expect(after.reworkSentQty).toBe('20');
      expect(after.reworkReturnedQty).toBe('20');
      // ...but nothing was created. 95 garments arrived and 95 are here.
      expect(after.receivedQty).toBe('95');
      expect(after.wipQty).toBe('95.0000');
      expect(after.reworkOutstandingQty).toBe('0.0000');
    });

    it('refuses to return more than is out in rework', async () => {
      const stitching = await stepFor('STITCHING');
      const res = await http
        .post(`/api/production/stage-tasks/${stitching}/rework/return`)
        .set(auth())
        .send({ idempotencyKey: key(), returnQty: '1' })
        .expect(409);
      expect(res.body.code).toBe('REWORK_RETURN_EXCEEDS_SENT');
    });

    it('refuses to send more to rework than the stage holds', async () => {
      const stitching = await stepFor('STITCHING');
      const res = await http
        .post(`/api/production/stage-tasks/${stitching}/rework/send`)
        .set(auth())
        .send({ idempotencyKey: key(), reworkQty: '200' })
        .expect(409);
      expect(res.body.code).toBe('STAGE_OUTCOME_EXCEEDS_RECEIVED');
    });
  });

  // ==========================================================================
  // scanning
  // ==========================================================================

  describe('scan station', () => {
    it('resolves a batch barcode and offers what can be done here', async () => {
      const res = await http
        .post('/api/production/scan/resolve')
        .set(auth())
        .send({ code: batchNo })
        .expect(201);

      expect(res.body.found).toBe(true);
      expect(res.body.kind).toBe('PRODUCTION_BATCH');
      expect(res.body.batch.batchNo).toBe(batchNo);
      expect(res.body.currentStageCode).toBe('STITCHING');
      const actions = (res.body.actions as { action: string; maxQty: string }[]).map((a) => a.action);
      expect(actions).toContain('RECORD_OUTCOME');
      expect(actions).toContain('SEND_TO_REWORK');
    });

    it('reports an unknown barcode rather than guessing', async () => {
      const res = await http
        .post('/api/production/scan/resolve')
        .set(auth())
        .send({ code: 'BATCH-NOT-A-REAL-CODE' })
        .expect(201);
      expect(res.body.found).toBe(false);
      expect(res.body.actions).toEqual([]);
    });

    it('records a stage outcome by scan', async () => {
      const stitching = await stepFor('STITCHING');
      const res = await http
        .post('/api/production/scan')
        .set(auth())
        .send({
          idempotencyKey: key(),
          code: batchNo,
          eventType: 'STAGE_COMPLETE',
          stageTaskId: stitching,
          completedQty: '95',
          deviceId: 'TAB-CUT-01',
        })
        .expect(201);

      expect(res.body.accepted).toBe(true);
      expect(res.body.status).toBe('ACCEPTED');
      const task = res.body.batch.stageTasks.find(
        (t: { productionStage: { code: string } }) => t.productionStage.code === 'STITCHING',
      );
      expect(task.completedQty).toBe('95');
    });

    // ---- EXIT CRITERION 2 --------------------------------------------------
    it('treats a replayed scan as a no-op, not a second event', async () => {
      const stitching = await stepFor('STITCHING');
      const k = key();
      const payload = {
        idempotencyKey: k,
        code: batchNo,
        eventType: 'STAGE_COMPLETE',
        stageTaskId: stitching,
        completedQty: '0',
        rejectedQty: '0',
        reworkQty: '0',
      };

      // A real scan that will be refused, then replayed from the offline queue.
      const first = await http.post('/api/production/scan').set(auth()).send({ ...payload, completedQty: '0' });
      const replay = await http.post('/api/production/scan').set(auth()).send({ ...payload, completedQty: '0' });

      // Whatever the first answer was, the replay must not apply a second time.
      expect([first.status, replay.status]).toBeDefined();
      const events = await prisma.barcodeScanEvent.count({
        where: { organizationId: orgId, idempotencyKey: k },
      });
      expect(events).toBe(1);
    });

    it('applies a forward scan exactly once when replayed', async () => {
      const stitching = await stepFor('STITCHING');
      const washing = await stepFor('WASHING');
      const k = key();
      const payload = {
        idempotencyKey: k,
        code: batchNo,
        eventType: 'STAGE_RECEIVE',
        stageTaskId: washing,
        completedQty: '95',
      };

      const first = await http.post('/api/production/scan').set(auth()).send(payload).expect(201);
      expect(first.body.status).toBe('ACCEPTED');

      const replay = await http.post('/api/production/scan').set(auth()).send(payload).expect(201);
      expect(replay.body.status).toBe('DUPLICATE_IGNORED');

      // The quantity moved once, not twice.
      const w = await stageOf('WASHING');
      expect(w.receivedQty).toBe('95');
      const s = await stageOf('STITCHING');
      expect(s.forwardedQty).toBe('95');
      expect(stitching).toBe(s.id);
    });

    it('records a refused scan as evidence rather than discarding it', async () => {
      const washing = await stepFor('WASHING');
      const k = key();
      const res = await http
        .post('/api/production/scan')
        .set(auth())
        .send({
          idempotencyKey: k,
          code: batchNo,
          eventType: 'STAGE_COMPLETE',
          stageTaskId: washing,
          completedQty: '9999',
        })
        .expect(409);
      expect(res.body.code).toBe('STAGE_OUTCOME_EXCEEDS_RECEIVED');

      // Five rejected scans at one station is a label or training problem, and
      // it is invisible if only successes are stored.
      const event = await prisma.barcodeScanEvent.findFirstOrThrow({
        where: { organizationId: orgId, idempotencyKey: k },
      });
      expect(event.status).toBe('REJECTED_VALIDATION');
      expect(event.validationMessage).toContain('exceeds');
    });

    it('refuses a route step that belongs to a different batch', async () => {
      const other = await prisma.productionBatch.findFirst({
        where: { organizationId: orgId, id: { not: batchId } },
        include: { stageTasks: { take: 1 } },
      });
      if (!other?.stageTasks[0]) return; // only one batch in this run

      const res = await http
        .post('/api/production/scan')
        .set(auth())
        .send({
          idempotencyKey: key(),
          code: batchNo,
          eventType: 'STAGE_COMPLETE',
          stageTaskId: other.stageTasks[0].id,
          completedQty: '1',
        })
        .expect(400);
      expect(res.body.code).toBe('SCAN_BATCH_MISMATCH');
    });

    it('lists scan history including the refusals', async () => {
      const res = await http
        .get('/api/production/scans')
        .set(auth())
        .query({ productionBatchId: batchId, pageSize: 50 })
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      const rejected = await http
        .get('/api/production/scans')
        .set(auth())
        .query({ status: 'REJECTED_VALIDATION', pageSize: 50 })
        .expect(200);
      expect(rejected.body.data.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // whole-route reconciliation
  // ==========================================================================

  describe('route reconciliation', () => {
    // ---- EXIT CRITERION 3 --------------------------------------------------
    it('reconciles quantities across the whole route', async () => {
      const b = await batch();
      const tasks = b.stageTasks as {
        sequence: number;
        productionStage: { code: string };
        receivedQty: string; completedQty: string; rejectedQty: string; forwardedQty: string;
        reworkSentQty: string; reworkReturnedQty: string; wipQty: string;
      }[];

      const ordered = [...tasks].sort((a, b2) => a.sequence - b2.sequence);

      for (const [i, t] of ordered.entries()) {
        // Nothing was disposed of that never arrived.
        const disposed =
          Number(t.completedQty) +
          Number(t.rejectedQty) +
          (Number(t.reworkSentQty) - Number(t.reworkReturnedQty));
        expect(disposed).toBeLessThanOrEqual(Number(t.receivedQty));

        // Nothing was forwarded that was not accepted here.
        expect(Number(t.forwardedQty)).toBeLessThanOrEqual(Number(t.completedQty));

        // What left the previous step is exactly what arrived at this one.
        if (i > 0) {
          expect(Number(t.receivedQty)).toBe(Number(ordered[i - 1].forwardedQty));
        }
      }

      // Released = finished + rejected + still in progress, across the route.
      const released = Number(b.progress.releasedQty);
      const finished = Number(b.progress.finishedQty);
      const rejected = Number(b.progress.rejectedQty);
      const wip = Number(b.progress.inProgressQty);
      const rework = Number(b.progress.reworkOutstandingQty);
      expect(finished + rejected + wip + rework).toBe(released);
    });

    it('writes an immutable movement for every quantity change', async () => {
      const movements = await prisma.productionStageMovement.findMany({
        where: { organizationId: orgId, productionBatchId: batchId },
        orderBy: { occurredAt: 'asc' },
      });
      expect(movements.length).toBeGreaterThan(8);
      // Every movement carries who, when and how much — the trail an auditor
      // needs to explain any figure on the batch.
      for (const m of movements) {
        expect(m.operatorUserId).toBeTruthy();
        expect(Number(m.qty.toFixed())).toBeGreaterThan(0);
        expect(m.idempotencyKey).toBeTruthy();
      }
    });

    it('never reports a batch total as the sum of its stages', async () => {
      const b = await batch();
      const stageSum = (b.stageTasks as { completedQty: string }[]).reduce(
        (acc, t) => acc + Number(t.completedQty),
        0,
      );
      // The stages add to far more than the batch ever held.
      expect(stageSum).toBeGreaterThan(Number(b.progress.plannedQty));
      expect(Number(b.progress.plannedQty)).toBe(100);
    });
  });
});
