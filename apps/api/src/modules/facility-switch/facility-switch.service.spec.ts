import { Prisma } from '@prisma/client';
import { readInventorySnapshot } from '@dnd/domain';
import type { AuthenticatedUser } from '@dnd/contracts';
import { FacilitySwitchService } from './facility-switch.service';

/*
 * The switch is exercised end to end against an in-memory store that keeps
 * the same unique constraints as the database, and a scripted Unicommerce.
 * No network, no real tenant: production orders are never touched by tests.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const LINE = '55555555-5555-4555-8555-555555555555';
const SO = '6123456789012';
const ITEM = '15000000000001';

const user = (id = USER, perms = ['demand.read', 'demand.switch_facility']): AuthenticatedUser => ({
  id, organizationId: ORG, email: 'ops@example.test', fullName: 'Ops', employeeCode: null, roles: ['PRODUCTION_HEAD'], permissions: perms,
});

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: [target] } });
}

function makeDb(opts: { demand?: boolean } = {}) {
  const ops = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const projection = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const unique = (data: Record<string, unknown>, self?: string) => {
    for (const o of ops.values()) {
      if (o.id === self) continue;
      if (data.activeLockKey && o.activeLockKey === data.activeLockKey) throw p2002('activeLockKey');
      if (data.preflightNonce && o.preflightNonce === data.preflightNonce) throw p2002('preflightNonce');
      if (data.idempotencyKey && o.idempotencyKey === data.idempotencyKey) throw p2002('idempotencyKey');
    }
  };
  const matches = (o: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'organizationId_idempotencyKey') return o.idempotencyKey === (v as { idempotencyKey: string }).idempotencyKey;
      if (k === 'id' && v && typeof v === 'object' && 'not' in v) return o.id !== (v as { not: string }).not;
      if (k === 'createdAt') return true;
      return o[k] === v;
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    ops, events,
    shopifyOrder: {
      findFirst: jest.fn(async () => ({
        id: ORDER, organizationId: ORG, externalId: `gid://shopify/Order/${SO}`, orderName: '#170717', orderNumber: '170717',
        orderedAt: new Date(), expectedDispatchDate: null, orderPriority: 'NORMAL', unicommerceSaleOrderCode: SO,
        lines: [{
          id: LINE, externalLineId: `gid://shopify/LineItem/${ITEM}`, externalVariantId: 'gid://shopify/ProductVariant/49295244427434',
          externalSku: 'DD-KUR-L', title: 'Kurta', orderedQty: new Prisma.Decimal(1), cancelledQty: new Prisma.Decimal(0),
          fulfilledQty: new Prisma.Decimal(0), priority: 'NORMAL',
        }],
      })),
      update: jest.fn(),
      findMany: jest.fn(async () => []),
    },
    unicommerceOrderItem: {
      upsert: jest.fn(async ({ create, update, where }: { create: Record<string, unknown>; update: Record<string, unknown>; where: { organizationId_saleOrderCode_itemCode: { itemCode: string } } }) => {
        const k = where.organizationId_saleOrderCode_itemCode.itemCode;
        projection.set(k, { ...(projection.get(k) ?? create), ...update });
      }),
      findUnique: jest.fn(async ({ where }: { where: { organizationId_saleOrderCode_itemCode: { itemCode: string } } }) =>
        projection.get(where.organizationId_saleOrderCode_itemCode.itemCode) ?? null),
    },
    facilitySwitchOperation: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...ops.values()].find((o) => matches(o, where)) ?? null),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...ops.values()].find((o) => matches(o, where)) ?? null),
      findMany: jest.fn(async () => [...ops.values()]),
      count: jest.fn(async ({ where }: { where: { operatorUserId: string } }) =>
        [...ops.values()].filter((o) => o.operatorUserId === where.operatorUserId).length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        unique(data);
        const now = new Date();
        const row = {
          status: 'CREATED', submittedAt: null, apiSuccessful: null, apiRespondedAt: null, reconciliation: null,
          reconciledByUserId: null, manufacturingDemandId: null, verifiedFacilityCode: null, failureCode: null,
          failureMessage: null, executionStartedAt: null, verificationCompletedAt: null, apiErrors: null, apiWarnings: null,
          apiMessage: null, reconciledAt: null, reconciliationNote: null,
          ...data, quantity: new Prisma.Decimal(1), id: id(), createdAt: now, updatedAt: now,
        };
        ops.set(row.id, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const o = ops.get(where.id);
        if (!o || (where.status && o.status !== where.status)) return { count: 0 };
        unique(data, o.id as string);
        Object.assign(o, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
    },
    facilitySwitchEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push({ ...data, at: new Date() }); }),
      findMany: jest.fn(async () => events),
    },
    integrationConnection: { findFirst: jest.fn(async () => ({ allowExternalWrites: true })) },
    user: {
      findUnique: jest.fn(async () => ({
        status: 'ACTIVE',
        userRoles: [{ role: { rolePermissions: [{ permission: { code: 'demand.switch_facility' } }] } }],
      })),
      findMany: jest.fn(async () => []),
    },
    demandSourceMapping: {
      findFirst: jest.fn(async () => (opts.demand
        ? {
            manufacturingDemand: {
              id: 'd1', demandNo: 'DEM-0001', status: 'IN_PRODUCTION', priority: 'NORMAL', requiredByDate: null,
              allocations: [{
                manufacturingOrder: {
                  id: 'm1', moNo: 'MO-0007', status: 'IN_PROGRESS', completedQty: new Prisma.Decimal(0),
                  materialIssues: [{ id: 'i' }], finishedInwards: [],
                  batches: [{ scanEvents: [{ id: 's' }], stageTasks: [{ receivedQty: new Prisma.Decimal(1), productionStage: { name: 'Stitching', sequenceHint: 3 } }] }],
                },
              }],
            },
          }
        : null)),
    },
    inTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db)),
  };
  return db as {
    ops: Map<string, Record<string, unknown>>; events: Record<string, unknown>[];
    integrationConnection: { findFirst: jest.Mock };
  };
}

/** A scripted Unicommerce: the item's facility, and what the switch does. */
function makeUc(o: {
  facility?: string; status?: string; stock?: number;
  switchResult?: 'ACCEPT' | 'REJECT' | 'TIMEOUT' | 'ACCEPT_WITH_WARNING' | 'ACCEPT_LATE';
} = {}) {
  const state = { facility: o.facility ?? 'dashanddot', reads: 0, switches: 0, applyOnRead: 0 };
  const order = () => ({
    saleOrderDTO: {
      code: SO, displayOrderCode: '#170717', status: 'PROCESSING',
      saleOrderItems: [{
        code: ITEM, itemSku: 'W/2769-L-49295244427434', itemName: 'Kurta', facilityCode: state.facility,
        facilityName: state.facility, statusCode: o.status ?? 'CREATED', shippingPackageCode: null, shippingPackageStatus: null, onHold: false,
      }],
    },
  });
  const client = {
    describe: () => ({ allowExternalWrites: true }),
    post: jest.fn(async () => {
      state.reads += 1;
      if (state.applyOnRead && state.reads >= state.applyOnRead) state.facility = 'ST_KGF_Mumbai';
      return order();
    }),
    probe: jest.fn(async () => ({ ok: true, body: { successful: true, facility: { enabled: true } } })),
    switchFacility: jest.fn(async () => {
      state.switches += 1;
      switch (o.switchResult ?? 'ACCEPT') {
        case 'REJECT':
          return { kind: 'RESPONSE', httpStatus: 200, body: { successful: false, errors: [{ message: 'INVALID_STATE', description: 'Item cannot be switched' }] } };
        case 'TIMEOUT':
          return { kind: 'NO_RESPONSE', reason: 'No answer within 25s' };
        case 'ACCEPT_WITH_WARNING':
          state.facility = 'ST_KGF_Mumbai';
          return { kind: 'RESPONSE', httpStatus: 200, body: { successful: true, warnings: [{ code: 1, message: 'LOW_INVENTORY' }] } };
        case 'ACCEPT_LATE':
          state.applyOnRead = state.reads + 2;
          return { kind: 'RESPONSE', httpStatus: 200, body: { successful: true } };
        default:
          state.facility = 'ST_KGF_Mumbai';
          return { kind: 'RESPONSE', httpStatus: 200, body: { successful: true } };
      }
    }),
  };
  const unicommerce = {
    facilities: jest.fn(async () => [
      { code: 'dashanddot', displayName: 'Noida', kind: 'WAREHOUSE', probe: 'VALID', isVisible: true, enabled: true },
      { code: 'ST_KGF_Mumbai', displayName: 'Kala Ghoda', kind: 'STORE', probe: 'VALID', isVisible: true, enabled: true },
      { code: 'CWH', displayName: null, kind: 'UNKNOWN', probe: 'ACCESS_DENIED', isVisible: false, enabled: null },
    ]),
    inventoryAt: jest.fn(async (sku: string, code: string) =>
      readInventorySnapshot({ itemTypeSKU: sku, inventory: code === 'ST_KGF_Mumbai' ? (o.stock ?? 2) : 0 }, code)),
    searchOrders: jest.fn(async () => []),
  };
  return { client, unicommerce, state };
}

function setup(o: Parameters<typeof makeUc>[0] & { demand?: boolean } = {}) {
  const db = makeDb({ demand: o.demand });
  const uc = makeUc(o);
  const audit = { record: jest.fn() };
  const config = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'x'.repeat(40) : undefined) };
  const service = new FacilitySwitchService(db as never, uc.client as never, uc.unicommerce as never, audit as never, config as never);
  service.verifyDelaysMs = [0, 0, 0];
  return { service, db, uc, audit };
}

const body = (token: string, over: object = {}) => ({
  preflightToken: token, saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai',
  expectedCurrentFacilityCode: 'dashanddot', reason: 'Stock is sitting in Mumbai', ...over,
});

async function confirmAndRun(s: ReturnType<typeof setup>, key = 'key-0000000000000001') {
  const pre = await s.service.preflight(user(), ORDER, {
    saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
  });
  expect(pre.ready).toBe(true);
  // Run synchronously in the test rather than via the fire-and-forget path.
  const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
  const started = await s.service.start(user(), ORDER, body(pre.token!), key);
  spy.mockRestore();
  await s.service.run(started.operation.id);
  return s.db.ops.get(started.operation.id)!;
}

const types = (s: ReturnType<typeof setup>) => (s.db.events as { eventType: string }[]).map((e) => e.eventType);

describe('facility switch', () => {
  it('switches, verifies by reading back, and releases the item', async () => {
    const s = setup();
    const op = await confirmAndRun(s);
    expect(op.status).toBe('VERIFIED_SUCCESS');
    expect(op.verifiedFacilityCode).toBe('ST_KGF_Mumbai');
    expect(op.activeLockKey).toBeNull();
    expect(s.uc.client.switchFacility).toHaveBeenCalledTimes(1);
    expect(s.uc.client.switchFacility).toHaveBeenCalledWith(
      { facilityCode: 'ST_KGF_Mumbai', saleOrderCode: SO, saleOrderItemCodes: [ITEM] }, 'dashanddot',
    );
    expect(types(s)).toEqual([
      'SWITCH_REQUESTED', 'PREFLIGHT_STARTED', 'PREFLIGHT_PASSED', 'SWITCH_SUBMITTED',
      'API_RESPONSE_RECEIVED', 'STATUS_API_ACCEPTED', 'VERIFICATION_STARTED', 'SWITCH_VERIFIED',
    ]);
  });

  it('records successful=false as a failure, never as success', async () => {
    const s = setup({ switchResult: 'REJECT' });
    const op = await confirmAndRun(s);
    expect(op.status).toBe('VERIFIED_FAILURE');
    expect(op.failureCode).toBe('REJECTED');
    expect(op.apiSuccessful).toBe(false);
    expect(op.activeLockKey).toBeNull();
  });

  it('keeps warnings apart from errors on a successful switch', async () => {
    const s = setup({ switchResult: 'ACCEPT_WITH_WARNING' });
    const op = await confirmAndRun(s);
    expect(op.status).toBe('VERIFIED_SUCCESS');
    expect(op.apiWarnings).toEqual([{ code: '1', message: 'LOW_INVENTORY', description: null }]);
    expect(op.apiErrors).toEqual([]);
  });

  it('treats a timeout as unknown, holds the item, and never re-sends', async () => {
    const s = setup({ switchResult: 'TIMEOUT' });
    const op = await confirmAndRun(s);
    expect(op.status).toBe('VERIFICATION_PENDING');
    expect(op.activeLockKey).not.toBeNull();
    expect(op.failureCode).toBe('NO_RESPONSE');

    // "Check status" reads again; it does not send again.
    await s.service.verify(user(), op.id as string);
    expect(s.uc.client.switchFacility).toHaveBeenCalledTimes(1);
    expect(s.db.ops.get(op.id as string)!.status).toBe('VERIFICATION_PENDING');

    // An operator may close it as not applied, because the item is still at source.
    await s.service.resolve(user(), op.id as string, { action: 'CONFIRM_NOT_APPLIED', note: 'Checked in Uniware' });
    expect(s.db.ops.get(op.id as string)!.status).toBe('VERIFIED_FAILURE');
    expect(s.db.ops.get(op.id as string)!.activeLockKey).toBeNull();
  });

  it('verifies a switch Unicommerce applies a moment later', async () => {
    const s = setup({ switchResult: 'ACCEPT_LATE' });
    const op = await confirmAndRun(s);
    expect(op.status).toBe('VERIFIED_SUCCESS');
  });

  it('refuses before sending when the item moved after the check', async () => {
    const s = setup();
    const pre = await s.service.preflight(user(), ORDER, {
      saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
    });
    const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
    const started = await s.service.start(user(), ORDER, body(pre.token!), 'key-0000000000000002');
    spy.mockRestore();
    s.uc.state.facility = 'WH_Noida';
    await s.service.run(started.operation.id);
    const op = s.db.ops.get(started.operation.id)!;
    expect(op.status).toBe('BLOCKED');
    expect(op.failureCode).toBe('SOURCE_MATCH');
    expect(s.uc.client.switchFacility).not.toHaveBeenCalled();
  });

  it('refuses before sending when stock went between confirmation and execution', async () => {
    const s = setup();
    const pre = await s.service.preflight(user(), ORDER, {
      saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
    });
    const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
    const started = await s.service.start(user(), ORDER, body(pre.token!), 'key-0000000000000003');
    spy.mockRestore();
    s.uc.unicommerce.inventoryAt.mockImplementation(async (sku: string, code: string) => readInventorySnapshot({ itemTypeSKU: sku, inventory: 0 }, code));
    await s.service.run(started.operation.id);
    expect(s.db.ops.get(started.operation.id)!.failureCode).toBe('STOCK');
    expect(s.uc.client.switchFacility).not.toHaveBeenCalled();
  });

  it('replays the same operation for a repeated key, and refuses the key for anything else', async () => {
    const s = setup();
    const pre = await s.service.preflight(user(), ORDER, {
      saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
    });
    const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
    const first = await s.service.start(user(), ORDER, body(pre.token!), 'key-0000000000000004');
    const again = await s.service.start(user(), ORDER, body(pre.token!), 'key-0000000000000004');
    expect(again.replayed).toBe(true);
    expect(again.operation.id).toBe(first.operation.id);
    await expect(s.service.start(user(), ORDER, body(pre.token!, { reason: 'Something else entirely' }), 'key-0000000000000004'))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('lets only one operator switch an item at a time', async () => {
    const s = setup();
    const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
    const preA = await s.service.preflight(user(), ORDER, { saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot' });
    const preB = await s.service.preflight(user(OTHER), ORDER, { saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot' });
    await s.service.start(user(), ORDER, body(preA.token!), 'key-000000000000000A');
    await expect(s.service.start(user(OTHER), ORDER, body(preB.token!), 'key-000000000000000B'))
      .rejects.toMatchObject({ response: { code: 'SWITCH_IN_PROGRESS' } });
    // And a fresh check now reports the conflict.
    const preC = await s.service.preflight(user(OTHER), ORDER, { saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot' });
    expect(preC.ready).toBe(false);
    expect(preC.blocker?.code).toBe('NO_CONFLICT');
    spy.mockRestore();
  });

  it('refuses an expired, forged or reused confirmation', async () => {
    const s = setup();
    const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
    const now = Date.now();
    const expired = s.service.signToken({ v: 1, org: ORG, user: USER, order: ORDER, so: SO, item: ITEM, src: 'dashanddot', tgt: 'ST_KGF_Mumbai', iat: now - 60_000, exp: now - 30_000, nonce: 'n1' });
    await expect(s.service.start(user(), ORDER, body(expired), 'key-0000000000000005')).rejects.toMatchObject({ response: { code: 'PREFLIGHT_EXPIRED' } });
    await expect(s.service.start(user(), ORDER, body(`${expired.split('.')[0]}.forged`), 'key-0000000000000006')).rejects.toMatchObject({ response: { code: 'PREFLIGHT_INVALID' } });
    const other = s.service.signToken({ v: 1, org: ORG, user: OTHER, order: ORDER, so: SO, item: ITEM, src: 'dashanddot', tgt: 'ST_KGF_Mumbai', iat: now, exp: now + 30_000, nonce: 'n2' });
    await expect(s.service.start(user(), ORDER, body(other), 'key-0000000000000007')).rejects.toMatchObject({ response: { code: 'PREFLIGHT_MISMATCH' } });
    spy.mockRestore();
  });

  it('lets a confirmation start one operation, once', async () => {
    const s = setup();
    const pre = await s.service.preflight(user(), ORDER, {
      saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
    });
    const spy = jest.spyOn(s.service, 'run').mockResolvedValue(undefined);
    const first = await s.service.start(user(), ORDER, body(pre.token!), 'key-0000000000000008');
    s.db.ops.get(first.operation.id)!.activeLockKey = null; // as if it had finished
    await expect(s.service.start(user(), ORDER, body(pre.token!), 'key-0000000000000009'))
      .rejects.toMatchObject({ response: { code: 'PREFLIGHT_TOKEN_USED' } });
    spy.mockRestore();
  });

  it('refuses an operator without the permission', async () => {
    const s = setup();
    const pre = await s.service.preflight(user(USER, ['demand.read']), ORDER, {
      saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
    });
    expect(pre.ready).toBe(false);
    expect(pre.token).toBeNull();
    expect(pre.blocker?.code).toBe('ACCESS');
  });

  it('issues no confirmation while writes are switched off', async () => {
    const s = setup();
    s.db.integrationConnection.findFirst.mockResolvedValue({ allowExternalWrites: false });
    const pre = await s.service.preflight(user(), ORDER, {
      saleOrderItemCode: ITEM, targetFacilityCode: 'ST_KGF_Mumbai', expectedCurrentFacilityCode: 'dashanddot',
    });
    expect(pre.token).toBeNull();
    expect(pre.blocker?.code).toBe('WRITES_ENABLED');
  });

  it('flags production for review, and changes nothing in it', async () => {
    const s = setup({ demand: true });
    const op = await confirmAndRun(s);
    expect(op.status).toBe('RECONCILIATION_REQUIRED');
    expect(op.manufacturingDemandId).toBe('d1');
    expect((op.reconciliation as { reasons: string[] }).reasons[1]).toBe('MO-0007: at Stitching, materials issued, barcode scans recorded.');
    expect(types(s)).toContain('MANUFACTURING_RECONCILIATION_CREATED');
    expect(op.activeLockKey).toBeNull();

    await s.service.resolve(user(), op.id as string, { action: 'PRODUCTION_REVIEWED', note: 'MO kept for stock' });
    expect(s.db.ops.get(op.id as string)!.status).toBe('VERIFIED_SUCCESS');
    expect(types(s)).toContain('MANUAL_RECONCILIATION_COMPLETED');
  });

  it('lists live facilities with stock and a reason for each one that cannot take the item', async () => {
    const s = setup();
    const o = await s.service.options(user(), ORDER, { line: LINE });
    expect(o.selectedItemCode).toBe(ITEM);
    expect(o.items[0]).toMatchObject({ lineId: LINE, lineMatch: 'LINE_ID' });
    const byCode = Object.fromEntries(o.facilities.map((f) => [f.code, f]));
    expect(byCode.ST_KGF_Mumbai).toMatchObject({ eligible: true, availableQty: '2' });
    expect(byCode.dashanddot).toMatchObject({ eligible: false, isCurrent: true });
    expect(byCode.CWH).toMatchObject({ eligible: false, availableQty: null });
    expect(byCode.CWH!.restriction).toContain('cannot see');
  });
});
