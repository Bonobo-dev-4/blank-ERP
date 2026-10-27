import {
  ConflictException, ForbiddenException, GoneException, HttpException, HttpStatus, Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type FacilitySwitchStatus as DbStatus } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AuthenticatedUser, FacilitySwitchPreflightRequest, FacilitySwitchResolveRequest, FacilitySwitchStartRequest,
} from '@dnd/contracts';
import {
  assessSwitchReconciliation, canTransitionSwitch, dec, evaluateFacilitySwitch, holdsSwitchLock,
  judgeSwitchVerification, legacyIdFromGid, matchUniwareItemToLine, normaliseCommerceRef,
  readSwitchResponse, type FacilitySwitchStatus, type InventoryReading, type LineMatch,
  type SwitchApiOutcome, type SwitchEligibility, type SwitchTarget, type UniwareEnvelope,
} from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { UnicommerceClient, UC_PATHS } from '../integrations/unicommerce.client';
import {
  SUPPLIED_FACILITY_CODES, UnicommerceService, type FacilityRecord,
} from '../integrations/unicommerce.service';

const SWITCH_PERMISSION = 'demand.switch_facility';
/** The confirmation is bound to what was checked, for this long. */
const PREFLIGHT_TTL_MS = 30_000;
const FACILITY_CACHE_MS = 10 * 60_000;
const MAX_SWITCHES_PER_MINUTE = 5;
/** Read-after-write attempts: Unicommerce may apply the switch a moment later. */
const VERIFY_DELAYS_MS = [1_500, 3_000, 6_000];
/** An operation idle this long in a working state was interrupted. */
const STALE_MS = 2 * 60_000;

interface SaleOrderItemDto {
  code?: string; itemSku?: string; sellerSkuCode?: string; itemName?: string;
  facilityCode?: string; facilityName?: string; statusCode?: string;
  shippingPackageCode?: string | null; shippingPackageStatus?: string | null; onHold?: boolean;
}
interface SaleOrderGetResponse extends UniwareEnvelope {
  readonly saleOrderDTO?: {
    code?: string; displayOrderCode?: string; status?: string; saleOrderItems?: SaleOrderItemDto[];
  } | null;
}

export interface LiveItem {
  code: string; sku: string | null; itemName: string | null;
  facilityCode: string | null; facilityName: string | null; statusCode: string | null;
  shippingPackageCode: string | null; shippingPackageStatus: string | null; onHold: boolean;
  lineId: string | null; lineMatch: LineMatch | null;
}
export interface LiveOrder {
  found: boolean; code: string | null; status: string | null; displayOrderCode: string | null;
  displayMatches: boolean; items: LiveItem[]; fetchedAt: Date;
}

type OrderRow = Prisma.ShopifyOrderGetPayload<{
  select: {
    id: true; organizationId: true; externalId: true; orderName: true; orderNumber: true; orderedAt: true;
    requiredByDate: true; unicommerceSaleOrderCode: true;
    lines: {
      select: {
        id: true; externalLineId: true; externalVariantId: true; externalSku: true; title: true;
        orderedQty: true; cancelledQty: true; fulfilledQty: true; priority: true;
      };
    };
  };
}>;

interface TokenClaims {
  v: 1; org: string; user: string; order: string; so: string; item: string;
  src: string; tgt: string; iat: number; exp: number; nonce: string;
}

interface Op {
  id: string; status: FacilitySwitchStatus;
}

/** Transport failures mean "could not ask", never "the answer is no". */
const TRANSPORT_FAILURES = new Set([
  'UNICOMMERCE_NOT_CONFIGURED', 'UNICOMMERCE_BAD_BASE_URL', 'UNICOMMERCE_AUTH_FAILED',
  'UNICOMMERCE_UNAUTHORISED', 'UNICOMMERCE_BAD_RESPONSE',
]);

/**
 * Moving one Unicommerce sale-order item to another facility.
 *
 * The order of operations is the safety argument:
 *
 *  1. Everything is read live and judged by `evaluateFacilitySwitch` — once
 *     when the operator asks, and again, from scratch, just before sending.
 *  2. The operation is written down BEFORE anything leaves, holding a unique
 *     per-item lock, so a second operator or a double click cannot race it.
 *  3. The request is sent once. `submittedAt` is set first and never cleared,
 *     so nothing in this service can send it twice.
 *  4. Success is only ever what Unicommerce shows afterwards. A timeout is an
 *     unknown, held as VERIFICATION_PENDING until a person resolves it.
 *  5. Production is never changed automatically; a verified switch with live
 *     demand behind it becomes a review for a person.
 *
 * No database transaction is held across a network call.
 */
@Injectable()
export class FacilitySwitchService {
  private readonly logger = new Logger(FacilitySwitchService.name);
  private facilityCache: { at: number; records: FacilityRecord[] } | null = null;
  /** Read-after-write back-off; replaceable in tests. */
  verifyDelaysMs: readonly number[] = VERIFY_DELAYS_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UnicommerceClient,
    private readonly unicommerce: UnicommerceService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  /** Everything the dialog shows before a facility is chosen. */
  async options(user: AuthenticatedUser, orderId: string, query: { line?: string; item?: string }) {
    const order = await this.loadOrder(user.organizationId, orderId);
    const live = await this.readSaleOrder(order);
    const writes = await this.writesEnabled(user.organizationId);

    const selected =
      (query.item ? live.items.find((i) => i.code === query.item) : undefined)
      ?? (query.line ? this.preferredItem(live.items.filter((i) => i.lineId === query.line)) : undefined)
      ?? (live.items.length === 1 ? live.items[0] : undefined)
      ?? null;

    const facilities = await this.facilityMaster();
    let facilityRows: Awaited<ReturnType<FacilitySwitchService['facilityRows']>> = [];
    let current: { availableQty: string | null; checkedAt: string | null } = { availableQty: null, checkedAt: null };
    let eligibility: SwitchEligibility | null = null;
    let production: Awaited<ReturnType<FacilitySwitchService['productionFacts']>> | null = null;

    if (selected) {
      const line = order.lines.find((l) => l.id === selected.lineId) ?? null;
      const conflict = await this.activeOperation(user.organizationId, live.code, selected.code);
      facilityRows = await this.facilityRows(user, order, live, selected, facilities, conflict, writes);
      const here = facilityRows.find((f) => f.code === selected.facilityCode);
      current = { availableQty: here?.availableQty ?? null, checkedAt: here?.checkedAt ?? null };
      eligibility = evaluateFacilitySwitch({
        ...this.baseInput(user, live, selected, line, conflict, writes),
        expectedSourceFacility: selected.facilityCode,
        target: null, targetStock: null,
      });
      production = line ? await this.productionFacts(order.organizationId, order.id, line.id) : null;
    }

    return {
      order: {
        id: order.id, orderName: order.orderName ?? `#${order.orderNumber}`,
        saleOrderCode: live.code, saleOrderStatus: live.status, found: live.found,
        displayMatches: live.displayMatches,
      },
      items: live.items.map((i) => ({
        ...i,
        lineTitle: order.lines.find((l) => l.id === i.lineId)?.title ?? null,
      })),
      selectedItemCode: selected?.code ?? null,
      line: selected?.lineId ? this.lineSummary(order, selected.lineId) : null,
      production,
      current: selected
        ? { code: selected.facilityCode, name: selected.facilityName, ...current,
            statusCode: selected.statusCode, shippingPackageStatus: selected.shippingPackageStatus }
        : null,
      facilities: facilityRows,
      checks: eligibility?.checks ?? [],
      writes,
      activeOperation: selected ? await this.activeOperation(user.organizationId, live.code, selected.code) : null,
      fetchedAt: live.fetchedAt.toISOString(),
    };
  }

  /**
   * A fresh, complete check for one item and one target, and — only if every
   * check passes — a token that binds the confirmation to exactly what was
   * checked. The token is not a reservation; execution checks everything again.
   */
  async preflight(user: AuthenticatedUser, orderId: string, body: FacilitySwitchPreflightRequest) {
    const order = await this.loadOrder(user.organizationId, orderId);
    const live = await this.readSaleOrder(order);
    const item = live.items.find((i) => i.code === body.saleOrderItemCode) ?? null;
    const line = item?.lineId ? order.lines.find((l) => l.id === item.lineId) ?? null : null;
    const [target, stock, conflict, writes] = await Promise.all([
      this.targetFacility(body.targetFacilityCode),
      item?.sku ? this.stockAt(item.sku, body.targetFacilityCode) : Promise.resolve(null),
      this.activeOperation(user.organizationId, live.code, body.saleOrderItemCode),
      this.writesEnabled(user.organizationId),
    ]);

    const result = evaluateFacilitySwitch({
      ...this.baseInput(user, live, item, line, conflict, writes),
      expectedSourceFacility: body.expectedCurrentFacilityCode,
      target,
      targetStock: stock ? { availableQty: stock.reading.sellableQty.toFixed(), checkedAt: stock.checkedAt } : null,
    });

    const now = Date.now();
    const token = result.ready && live.code && item
      ? this.signToken({
          v: 1, org: user.organizationId, user: user.id, order: order.id, so: live.code, item: item.code,
          src: body.expectedCurrentFacilityCode, tgt: body.targetFacilityCode,
          iat: now, exp: now + PREFLIGHT_TTL_MS, nonce: randomUUID(),
        })
      : null;

    return {
      ready: result.ready,
      checks: result.checks,
      blocker: result.blocker,
      token,
      expiresAt: token ? new Date(now + PREFLIGHT_TTL_MS).toISOString() : null,
      item: item ? { ...item, lineTitle: line?.title ?? null } : null,
      target: stock
        ? { code: body.targetFacilityCode, ...this.stockView(stock.reading), checkedAt: stock.checkedAt.toISOString() }
        : { code: body.targetFacilityCode, availableQty: null, openSaleQty: null, heldQty: null, checkedAt: null },
      fetchedAt: live.fetchedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Starting
  // ---------------------------------------------------------------------------

  async start(user: AuthenticatedUser, orderId: string, body: FacilitySwitchStartRequest, idempotencyKey: string) {
    const org = user.organizationId;
    const fingerprint = sha256(JSON.stringify([
      orderId, body.saleOrderItemCode, body.expectedCurrentFacilityCode, body.targetFacilityCode, body.reason,
    ]));

    // The same key returns the same operation; never a second send.
    const replay = await this.prisma.facilitySwitchOperation.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey } },
      select: { id: true, requestFingerprint: true, operatorUserId: true },
    });
    if (replay) {
      if (replay.requestFingerprint !== fingerprint || replay.operatorUserId !== user.id) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This confirmation key was already used for a different switch.',
        });
      }
      return { replayed: true, operation: await this.operation(user, replay.id) };
    }

    if (!user.permissions.includes(SWITCH_PERMISSION)) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_PERMISSIONS', message: `This action requires: ${SWITCH_PERMISSION}` });
    }
    const claims = this.verifyToken(body.preflightToken);
    const bound =
      claims.org === org && claims.user === user.id && claims.order === orderId &&
      claims.item === body.saleOrderItemCode && claims.src === body.expectedCurrentFacilityCode &&
      claims.tgt === body.targetFacilityCode;
    if (!bound) {
      throw new ConflictException({
        code: 'PREFLIGHT_MISMATCH',
        message: 'The confirmation does not match the checks that were run. Check again before confirming.',
      });
    }

    const recent = await this.prisma.facilitySwitchOperation.count({
      where: { operatorUserId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent >= MAX_SWITCHES_PER_MINUTE) {
      throw new HttpException(
        { code: 'TOO_MANY_SWITCHES', message: 'Too many facility switches in the last minute. Wait a moment and try again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const order = await this.loadOrder(org, orderId);
    const projected = await this.prisma.unicommerceOrderItem.findUnique({
      where: { organizationId_saleOrderCode_itemCode: { organizationId: org, saleOrderCode: claims.so, itemCode: claims.item } },
      select: { sku: true, shopifyOrderLineId: true },
    });

    let id: string;
    try {
      id = await this.prisma.inTransaction(async (tx) => {
        const op = await tx.facilitySwitchOperation.create({
          data: {
            organizationId: org,
            shopifyOrderId: order.id,
            shopifyOrderLineId: projected?.shopifyOrderLineId ?? null,
            saleOrderCode: claims.so,
            saleOrderItemCode: claims.item,
            sku: projected?.sku ?? null,
            quantity: new Prisma.Decimal(1),
            sourceFacilityCode: claims.src,
            targetFacilityCode: claims.tgt,
            operatorUserId: user.id,
            reason: body.reason,
            idempotencyKey,
            requestFingerprint: fingerprint,
            preflightNonce: claims.nonce,
            activeLockKey: lockKey(org, claims.so, claims.item),
            preflightAt: new Date(claims.iat),
          },
          select: { id: true },
        });
        await tx.facilitySwitchEvent.create({
          data: {
            operationId: op.id, eventType: 'SWITCH_REQUESTED', statusAfter: 'CREATED', actorUserId: user.id,
            integrationReference: `${claims.so}/${claims.item}`,
            details: { source: claims.src, target: claims.tgt, reason: body.reason },
          },
        });
        await this.audit.record({
          organizationId: org, actorUserId: user.id, action: 'SUBMIT',
          entityType: 'FacilitySwitchOperation', entityId: op.id,
          context: { saleOrderCode: claims.so, itemCode: claims.item, source: claims.src, target: claims.tgt },
        }, tx);
        return op.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as { target?: unknown })?.target ?? '');
        if (target.includes('activeLockKey')) {
          throw new ConflictException({ code: 'SWITCH_IN_PROGRESS', message: 'Another switch for this item is already running.' });
        }
        if (target.includes('preflightNonce')) {
          throw new ConflictException({ code: 'PREFLIGHT_TOKEN_USED', message: 'This confirmation was already used. Check again to switch.' });
        }
        // A concurrent request with the same key won the race: replay it.
        const winner = await this.prisma.facilitySwitchOperation.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey } },
          select: { id: true },
        });
        if (winner) return { replayed: true, operation: await this.operation(user, winner.id) };
      }
      throw error;
    }

    // Runs after the response: the operation is durable and the dialog polls it.
    void this.run(id).catch((e) => this.logger.error(`Facility switch ${id} stopped: ${errorText(e)}`));
    return { replayed: false, operation: await this.operation(user, id) };
  }

  // ---------------------------------------------------------------------------
  // Executing
  // ---------------------------------------------------------------------------

  /** Revalidate, send once, verify, reconcile. Public for tests. */
  async run(id: string): Promise<void> {
    const row = await this.prisma.facilitySwitchOperation.findUnique({ where: { id } });
    if (!row || row.status !== 'CREATED') return;
    let op: Op = { id: row.id, status: row.status as FacilitySwitchStatus };

    op = await this.transition(op, 'PREFLIGHT_CHECKING', {}, { type: 'PREFLIGHT_STARTED' });

    let source: string;
    let liveBefore: LiveOrder | null = null;
    try {
      const order = await this.loadOrder(row.organizationId, row.shopifyOrderId);
      liveBefore = await this.readSaleOrder(order);
      const item = liveBefore.items.find((i) => i.code === row.saleOrderItemCode) ?? null;
      const line = item?.lineId ? order.lines.find((l) => l.id === item.lineId) ?? null : null;
      const [target, stock, conflict, writes, operator] = await Promise.all([
        this.targetFacility(row.targetFacilityCode),
        item?.sku ? this.stockAt(item.sku, row.targetFacilityCode) : Promise.resolve(null),
        this.activeOperation(row.organizationId, liveBefore.code, row.saleOrderItemCode, row.id),
        this.writesEnabled(row.organizationId),
        this.operatorPermissions(row.operatorUserId),
      ]);
      const result = evaluateFacilitySwitch({
        hasPermission: operator.active && operator.permissions.has(SWITCH_PERMISSION),
        order: { found: liveBefore.found, status: liveBefore.status, displayMatches: liveBefore.displayMatches },
        item,
        expectedSourceFacility: row.sourceFacilityCode,
        target,
        targetStock: stock ? { availableQty: stock.reading.sellableQty.toFixed(), checkedAt: stock.checkedAt } : null,
        lineMatch: item?.lineMatch ?? null,
        erpOpenQty: line ? openQty(line) : null,
        itemQty: 1,
        conflictingOperation: conflict,
        writes,
        now: new Date(),
      });
      if (!result.ready) {
        await this.transition(op, 'BLOCKED', {
          failureCode: result.blocker?.code ?? 'BLOCKED',
          failureMessage: result.blocker?.detail ?? 'A check did not pass.',
        }, {
          type: 'PREFLIGHT_BLOCKED', errorCode: result.blocker?.code,
          details: { checks: result.checks.filter((c) => c.state !== 'PASS') },
        });
        return;
      }
      source = item!.facilityCode!;
      op = await this.transition(op, 'READY', {}, {
        type: 'PREFLIGHT_PASSED',
        details: { targetAvailable: stock?.reading.sellableQty.toFixed() ?? null, stockCheckedAt: stock?.checkedAt.toISOString() ?? null },
      });
    } catch (error) {
      // Nothing has been sent; closing the operation is safe.
      await this.transition(op, 'BLOCKED', {
        failureCode: 'PREFLIGHT_ERROR', failureMessage: safeMessage(error),
      }, { type: 'PREFLIGHT_BLOCKED', errorCode: 'PREFLIGHT_ERROR', details: { message: safeMessage(error) } });
      return;
    }

    // The attempt is recorded before the request exists. From here the only
    // path is verification, whatever happens.
    const now = new Date();
    op = await this.transition(op, 'EXECUTING', { executionStartedAt: now, submittedAt: now }, {
      type: 'SWITCH_SUBMITTED', ref: `${row.saleOrderCode}/${row.saleOrderItemCode}`,
      details: { facilityCode: row.targetFacilityCode, facilityHeader: source },
    });

    let api: SwitchApiOutcome;
    try {
      const result = await this.client.switchFacility(
        { facilityCode: row.targetFacilityCode, saleOrderCode: row.saleOrderCode, saleOrderItemCodes: [row.saleOrderItemCode] },
        source,
      );
      if (result.kind === 'NO_RESPONSE') {
        api = 'NO_RESPONSE';
        await this.patch(op, { apiRespondedAt: null });
        await this.event(op, { type: 'API_RESPONSE_RECEIVED', errorCode: 'NO_RESPONSE', details: { reason: result.reason } });
      } else {
        const reading = readSwitchResponse(result.body);
        // A gateway error or an unreadable body may or may not have reached
        // Unicommerce, so it is an unknown, not a refusal.
        api = reading.successful === true ? 'ACCEPTED'
          : reading.successful === false ? 'REJECTED'
          : 'NO_RESPONSE';
        await this.patch(op, {
          apiRespondedAt: new Date(),
          apiSuccessful: reading.successful,
          apiMessage: reading.message,
          apiErrors: reading.errors as unknown as Prisma.InputJsonValue,
          apiWarnings: reading.warnings as unknown as Prisma.InputJsonValue,
        });
        await this.event(op, {
          type: 'API_RESPONSE_RECEIVED',
          errorCode: reading.errors[0]?.message ?? (api === 'NO_RESPONSE' ? `HTTP_${result.httpStatus}` : undefined),
          details: {
            httpStatus: result.httpStatus, successful: reading.successful, message: reading.message,
            errors: reading.errors, warnings: reading.warnings,
          },
        });
      }
    } catch (error) {
      // Refused before sending (writes off, sign-in failed): a definite no.
      api = 'REJECTED';
      await this.patch(op, { apiSuccessful: false, apiMessage: safeMessage(error) });
      await this.event(op, { type: 'API_RESPONSE_RECEIVED', errorCode: errorCode(error), details: { refusedBeforeSending: true, message: safeMessage(error) } });
    }

    if (api === 'ACCEPTED') op = await this.transition(op, 'API_ACCEPTED', {}, null);
    op = await this.transition(op, 'VERIFYING', {}, { type: 'VERIFICATION_STARTED' });
    await this.verifyLoop(op, row, api, liveBefore, this.verifyDelaysMs);
  }

  private async verifyLoop(
    op: Op,
    row: { id: string; organizationId: string; shopifyOrderId: string; shopifyOrderLineId: string | null; saleOrderItemCode: string; sourceFacilityCode: string; targetFacilityCode: string },
    api: SwitchApiOutcome,
    before: LiveOrder | null,
    delays: readonly number[],
    operatorConfirmedNotApplied = false,
    actor?: string,
  ): Promise<void> {
    let verdict = judgeSwitchVerification({ api, itemFound: false, liveFacility: null, source: row.sourceFacilityCode, target: row.targetFacilityCode });
    let after: LiveOrder | null = null;
    for (const delay of delays.length ? delays : [0]) {
      if (delay) await sleep(delay);
      try {
        const order = await this.loadOrder(row.organizationId, row.shopifyOrderId);
        after = await this.readSaleOrder(order);
        const item = after.items.find((i) => i.code === row.saleOrderItemCode);
        verdict = judgeSwitchVerification({
          api, itemFound: Boolean(item), liveFacility: item?.facilityCode ?? null,
          source: row.sourceFacilityCode, target: row.targetFacilityCode, operatorConfirmedNotApplied,
        });
      } catch (error) {
        verdict = { outcome: 'PENDING', code: 'READ_FAILED', reason: `Unicommerce could not be read: ${safeMessage(error)}` };
      }
      if (verdict.outcome !== 'PENDING') break;
    }

    // Anything else on the order that moved is worth knowing about.
    const unexpected = before && after
      ? after.items
          .filter((i) => i.code !== row.saleOrderItemCode)
          .filter((i) => before.items.find((b) => b.code === i.code)?.facilityCode !== i.facilityCode)
          .map((i) => ({ item: i.code, now: i.facilityCode }))
      : [];
    const details = { verdict: verdict.code, reason: verdict.reason, ...(unexpected.length ? { otherItemsMoved: unexpected } : {}) };

    if (verdict.outcome === 'PENDING') {
      await this.transition(op, 'VERIFICATION_PENDING', { failureCode: verdict.code, failureMessage: verdict.reason }, {
        type: 'VERIFICATION_INCONCLUSIVE', errorCode: verdict.code, details, actor,
      });
      return;
    }
    if (verdict.outcome === 'FAILURE') {
      await this.transition(op, 'VERIFIED_FAILURE', {
        verificationCompletedAt: new Date(), verifiedFacilityCode: row.sourceFacilityCode,
        failureCode: verdict.code, failureMessage: verdict.reason,
      }, { type: 'SWITCH_FAILED', errorCode: verdict.code, details, actor });
      await this.auditOutcome(row, 'REJECT', verdict.code);
      return;
    }

    const production = row.shopifyOrderLineId
      ? await this.productionFacts(row.organizationId, row.shopifyOrderId, row.shopifyOrderLineId)
      : null;
    const review = assessSwitchReconciliation({
      demand: production?.demand ?? null,
      orders: production?.orders ?? [],
    });
    const verified = {
      verificationCompletedAt: new Date(), verifiedFacilityCode: row.targetFacilityCode,
      failureCode: null, failureMessage: null, manufacturingDemandId: production?.demand?.id ?? null,
    };
    if (review.required) {
      op = await this.transition(op, 'RECONCILIATION_REQUIRED', {
        ...verified, reconciliation: { reasons: review.reasons } as Prisma.InputJsonValue,
      }, { type: 'SWITCH_VERIFIED', details, actor });
      await this.event(op, { type: 'MANUFACTURING_RECONCILIATION_CREATED', details: { reasons: review.reasons } });
    } else {
      await this.transition(op, 'VERIFIED_SUCCESS', verified, { type: 'SWITCH_VERIFIED', details, actor });
    }
    await this.auditOutcome(row, 'UPDATE', 'VERIFIED');
  }

  // ---------------------------------------------------------------------------
  // After the fact
  // ---------------------------------------------------------------------------

  /** "Check status": read Unicommerce again for an operation whose outcome is open. */
  async verify(user: AuthenticatedUser, id: string) {
    const row = await this.ownOperation(user, id);
    const status = row.status as FacilitySwitchStatus;
    const stale = Date.now() - row.updatedAt.getTime() > STALE_MS;
    let op: Op = { id: row.id, status };

    if (['CREATED', 'PREFLIGHT_CHECKING', 'READY'].includes(status) && !row.submittedAt && stale) {
      await this.transition(op, 'BLOCKED', {
        failureCode: 'ABANDONED', failureMessage: 'The operation stopped before anything was sent to Unicommerce.',
      }, { type: 'PREFLIGHT_BLOCKED', errorCode: 'ABANDONED', actor: user.id });
    } else if (status === 'VERIFICATION_PENDING' || (stale && ['EXECUTING', 'API_ACCEPTED', 'VERIFYING'].includes(status))) {
      if (status !== 'VERIFYING') op = await this.transition(op, 'VERIFYING', {}, { type: 'VERIFICATION_STARTED', actor: user.id });
      await this.verifyLoop(op, row, apiOutcomeOf(row), null, [0], false, user.id);
    }
    return this.operation(user, id);
  }

  /**
   * A person closes what the system could not: production reviewed after a
   * switch, or a pending switch confirmed as never applied (only if
   * Unicommerce still shows the item at its source).
   */
  async resolve(user: AuthenticatedUser, id: string, body: FacilitySwitchResolveRequest) {
    const row = await this.ownOperation(user, id);
    const op: Op = { id: row.id, status: row.status as FacilitySwitchStatus };

    if (body.action === 'PRODUCTION_REVIEWED') {
      if (op.status !== 'RECONCILIATION_REQUIRED') {
        throw new ConflictException({ code: 'NOTHING_TO_REVIEW', message: 'This switch has no open production review.' });
      }
      await this.transition(op, 'VERIFIED_SUCCESS', {
        reconciledAt: new Date(), reconciledByUserId: user.id, reconciliationNote: body.note,
      }, { type: 'MANUAL_RECONCILIATION_COMPLETED', actor: user.id, details: { note: body.note } });
      await this.audit.record({
        organizationId: row.organizationId, actorUserId: user.id, action: 'APPROVE',
        entityType: 'FacilitySwitchOperation', entityId: row.id, context: { reviewed: true },
      });
    } else {
      if (op.status !== 'VERIFICATION_PENDING') {
        throw new ConflictException({ code: 'NOT_PENDING', message: 'Only a switch awaiting verification can be closed as not applied.' });
      }
      const verifying = await this.transition(op, 'VERIFYING', {}, {
        type: 'VERIFICATION_STARTED', actor: user.id, details: { confirmNotApplied: true, note: body.note },
      });
      await this.verifyLoop(verifying, row, apiOutcomeOf(row), null, [0], true, user.id);
    }
    return this.operation(user, id);
  }

  async operation(user: AuthenticatedUser, id: string) {
    const row = await this.ownOperation(user, id);
    const events = await this.prisma.facilitySwitchEvent.findMany({
      where: { operationId: id }, orderBy: { at: 'asc' },
    });
    return (await this.present([row], events))[0]!;
  }

  async history(user: AuthenticatedUser, orderId: string) {
    this.assertCanReadHistory(user);
    const rows = await this.prisma.facilitySwitchOperation.findMany({
      where: { organizationId: user.organizationId, shopifyOrderId: orderId },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    const events = rows.length
      ? await this.prisma.facilitySwitchEvent.findMany({ where: { operationId: { in: rows.map((r) => r.id) } }, orderBy: { at: 'asc' } })
      : [];
    return this.present(rows, events);
  }

  async list(user: AuthenticatedUser, query: { status?: string; open?: boolean }) {
    this.assertCanReadHistory(user);
    const rows = await this.prisma.facilitySwitchOperation.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query.status ? { status: query.status as DbStatus } : {}),
        ...(query.open ? { status: { in: ['VERIFICATION_PENDING', 'RECONCILIATION_REQUIRED', 'EXECUTING', 'VERIFYING', 'API_ACCEPTED'] as DbStatus[] } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    const orders = await this.prisma.shopifyOrder.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.shopifyOrderId))] } },
      select: { id: true, orderName: true, orderNumber: true },
    });
    const name = new Map(orders.map((o) => [o.id, o.orderName ?? `#${o.orderNumber}`]));
    return (await this.present(rows, [])).map((op) => ({ ...op, orderName: name.get(op.orderId) ?? null }));
  }

  // ---------------------------------------------------------------------------
  // Unicommerce reads
  // ---------------------------------------------------------------------------

  /**
   * The live sale order for an ERP order.
   *
   * Measured: Unicommerce's code for a Shopify order is the Shopify order id,
   * and its displayOrderCode is the order name. The code is tried directly,
   * accepted only if the display code matches, and otherwise found by search.
   */
  async readSaleOrder(order: OrderRow): Promise<LiveOrder> {
    const fetchedAt = new Date();
    const ref = normaliseCommerceRef(order.orderName ?? order.orderNumber);
    const matches = (display: string | null | undefined) =>
      Boolean(display) && (normaliseCommerceRef(display!) === ref || digits(display!) === digits(order.orderName ?? order.orderNumber));

    const candidates = [...new Set([order.unicommerceSaleOrderCode, legacyIdFromGid(order.externalId)].filter((c): c is string => Boolean(c)))];
    let dto: NonNullable<SaleOrderGetResponse['saleOrderDTO']> | null = null;
    for (const code of candidates) {
      const got = await this.getSaleOrder(code);
      if (got && matches(got.displayOrderCode)) { dto = got; break; }
    }
    if (!dto) {
      const from = new Date(order.orderedAt.getTime() - 86_400_000);
      const to = new Date(Math.min(Date.now(), order.orderedAt.getTime() + 3 * 86_400_000));
      const found = (await this.unicommerce.searchOrders(from, to)).find((o) => matches(o.displayOrderCode));
      if (found) dto = await this.getSaleOrder(found.code);
    }
    if (!dto?.code) {
      return { found: false, code: null, status: null, displayOrderCode: null, displayMatches: false, items: [], fetchedAt };
    }
    if (dto.code !== order.unicommerceSaleOrderCode && matches(dto.displayOrderCode)) {
      await this.prisma.shopifyOrder.update({ where: { id: order.id }, data: { unicommerceSaleOrderCode: dto.code } });
    }

    const items: LiveItem[] = (dto.saleOrderItems ?? []).filter((i) => i.code).map((i) => {
      const sku = i.itemSku ?? i.sellerSkuCode ?? null;
      let best: { lineId: string; match: LineMatch } | null = null;
      for (const line of order.lines) {
        const m = matchUniwareItemToLine({ code: i.code!, sku }, {
          lineLegacyId: legacyIdFromGid(line.externalLineId),
          variantLegacyId: legacyIdFromGid(line.externalVariantId),
          sku: line.externalSku,
        });
        if (m && (!best || rank(m) < rank(best.match))) best = { lineId: line.id, match: m };
      }
      return {
        code: i.code!, sku, itemName: i.itemName ?? null,
        facilityCode: i.facilityCode ?? null, facilityName: i.facilityName ?? null,
        statusCode: i.statusCode ?? null,
        shippingPackageCode: i.shippingPackageCode ?? null, shippingPackageStatus: i.shippingPackageStatus ?? null,
        onHold: Boolean(i.onHold), lineId: best?.lineId ?? null, lineMatch: best?.match ?? null,
      };
    });

    // Keep the last-known state for the order page.
    for (const i of items) {
      const data = {
        shopifyOrderId: order.id, shopifyOrderLineId: i.lineId, sku: i.sku, itemName: i.itemName,
        facilityCode: i.facilityCode, facilityName: i.facilityName, statusCode: i.statusCode,
        shippingPackageCode: i.shippingPackageCode, shippingPackageStatus: i.shippingPackageStatus,
        onHold: i.onHold, syncedAt: fetchedAt,
      };
      await this.prisma.unicommerceOrderItem.upsert({
        where: { organizationId_saleOrderCode_itemCode: { organizationId: order.organizationId, saleOrderCode: dto.code, itemCode: i.code } },
        create: { organizationId: order.organizationId, saleOrderCode: dto.code, itemCode: i.code, ...data },
        update: data,
      });
    }

    return {
      found: true, code: dto.code, status: dto.status ?? null, displayOrderCode: dto.displayOrderCode ?? null,
      displayMatches: matches(dto.displayOrderCode), items, fetchedAt,
    };
  }

  private async getSaleOrder(code: string) {
    try {
      const body = await this.client.post<SaleOrderGetResponse>(UC_PATHS.saleOrderGet, { code });
      return body.saleOrderDTO ?? null;
    } catch (error) {
      if (TRANSPORT_FAILURES.has(errorCode(error))) throw error;
      return null;
    }
  }

  private async facilityMaster(): Promise<FacilityRecord[]> {
    if (this.facilityCache && Date.now() - this.facilityCache.at < FACILITY_CACHE_MS) return this.facilityCache.records;
    const records = await this.unicommerce.facilities();
    this.facilityCache = { at: Date.now(), records };
    return records;
  }

  /** The target, read fresh: a cached "enabled" is not good enough to write on. */
  private async targetFacility(code: string): Promise<SwitchTarget> {
    const configured = (SUPPLIED_FACILITY_CODES as readonly string[]).includes(code);
    if (!configured) return { code, configured, visible: false, enabled: null };
    const result = await this.client.probe(UC_PATHS.facilityGet, { facilityCode: code });
    const facility = result.ok ? (result.body as { facility?: { enabled?: boolean | null } }).facility : null;
    return { code, configured, visible: result.ok, enabled: facility ? facility.enabled ?? null : null };
  }

  private async stockAt(sku: string, facilityCode: string): Promise<{ reading: InventoryReading; checkedAt: Date } | null> {
    const reading = await this.unicommerce.inventoryAt(sku, facilityCode);
    return reading ? { reading, checkedAt: new Date() } : null;
  }

  /**
   * Every configured facility as a destination for this item. Reads stock at
   * the visible ones in parallel, six at a time.
   */
  private async facilityRows(
    user: AuthenticatedUser, order: OrderRow, live: LiveOrder, item: LiveItem, master: FacilityRecord[],
    conflict: { id: string; status: string } | null, writes: { env: boolean; connection: boolean },
  ) {
    const line = item.lineId ? order.lines.find((l) => l.id === item.lineId) ?? null : null;
    const readings = await pool(master, 6, async (f) =>
      f.isVisible && item.sku ? this.stockAt(item.sku, f.code) : null);

    return master.map((f, idx) => {
      const stock = readings[idx];
      const target: SwitchTarget = { code: f.code, configured: true, visible: f.isVisible, enabled: f.enabled };
      const r = evaluateFacilitySwitch({
        ...this.baseInput(user, live, item, line, conflict, writes),
        expectedSourceFacility: item.facilityCode,
        target,
        targetStock: stock ? { availableQty: stock.reading.sellableQty.toFixed(), checkedAt: stock.checkedAt } : null,
      });
      const own = r.checks.filter((c) => ['TARGET_DIFFERENT', 'TARGET_ENABLED', 'STOCK'].includes(c.code));
      const restriction = own.find((c) => c.state !== 'PASS') ?? null;
      return {
        code: f.code,
        name: f.displayName,
        kind: f.kind,
        visible: f.isVisible,
        enabled: f.enabled,
        isCurrent: f.code === item.facilityCode,
        ...(stock ? this.stockView(stock.reading) : { availableQty: null, openSaleQty: null, heldQty: null }),
        checkedAt: stock?.checkedAt.toISOString() ?? null,
        eligible: restriction === null,
        restriction: restriction?.detail ?? null,
      };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.availableQty ?? -1) - Number(a.availableQty ?? -1));
  }

  /** Unicommerce's documented "Available quantity", with what sits beside it. */
  private stockView(r: InventoryReading) {
    return { availableQty: r.sellableQty.toFixed(), openSaleQty: r.committedQty.toFixed(), heldQty: r.heldQty.toFixed() };
  }

  // ---------------------------------------------------------------------------
  // ERP reads
  // ---------------------------------------------------------------------------

  private async loadOrder(organizationId: string, id: string): Promise<OrderRow> {
    const order = await this.prisma.shopifyOrder.findFirst({
      where: { organizationId, id },
      select: {
        id: true, organizationId: true, externalId: true, orderName: true, orderNumber: true, orderedAt: true,
        requiredByDate: true, unicommerceSaleOrderCode: true,
        lines: {
          select: {
            id: true, externalLineId: true, externalVariantId: true, externalSku: true, title: true,
            orderedQty: true, cancelledQty: true, fulfilledQty: true, priority: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    return order;
  }

  private lineSummary(order: OrderRow, lineId: string) {
    const line = order.lines.find((l) => l.id === lineId);
    if (!line) return null;
    return {
      id: line.id, title: line.title, sku: line.externalSku, priority: line.priority,
      orderedQty: line.orderedQty.toFixed(), openQty: openQty(line),
      requiredByDate: order.requiredByDate?.toISOString() ?? null,
    };
  }

  /** What production has done for this line, read-only. */
  private async productionFacts(organizationId: string, orderId: string, lineId: string) {
    const mapping = await this.prisma.demandSourceMapping.findFirst({
      where: { organizationId, sourceSystem: 'SHOPIFY', sourceDocType: 'ORDER', sourceDocId: orderId, sourceLineId: lineId },
      select: {
        manufacturingDemand: {
          select: {
            id: true, demandNo: true, status: true, priority: true, requiredByDate: true,
            allocations: {
              select: {
                manufacturingOrder: {
                  select: {
                    id: true, moNo: true, status: true, completedQty: true,
                    materialIssues: { select: { id: true }, take: 1 },
                    finishedInwards: { select: { id: true }, take: 1 },
                    batches: {
                      select: {
                        scanEvents: { select: { id: true }, take: 1 },
                        stageTasks: {
                          select: { receivedQty: true, productionStage: { select: { name: true, sequenceHint: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const demand = mapping?.manufacturingDemand ?? null;
    if (!demand) return { demand: null, orders: [] };
    return {
      demand: {
        id: demand.id, demandNo: demand.demandNo, status: demand.status, priority: demand.priority,
        requiredByDate: demand.requiredByDate?.toISOString() ?? null,
      },
      orders: demand.allocations.map(({ manufacturingOrder: mo }) => {
        const tasks = mo.batches.flatMap((b) => b.stageTasks).filter((t) => dec(t.receivedQty.toFixed()).greaterThan(0));
        const latest = tasks.sort((a, b) => b.productionStage.sequenceHint - a.productionStage.sequenceHint)[0];
        return {
          id: mo.id, moNo: mo.moNo, status: mo.status,
          materialIssued: mo.materialIssues.length > 0,
          scanned: mo.batches.some((b) => b.scanEvents.length > 0),
          completedQty: mo.completedQty.toFixed(),
          finishedGoodsInwarded: mo.finishedInwards.length > 0,
          stage: latest?.productionStage.name ?? null,
        };
      }),
    };
  }

  private async writesEnabled(organizationId: string) {
    const connection = await this.prisma.integrationConnection.findFirst({
      where: { organizationId, provider: 'UNICOMMERCE', name: 'primary' },
      select: { allowExternalWrites: true },
    });
    return { env: this.client.describe().allowExternalWrites, connection: connection?.allowExternalWrites ?? false };
  }

  private async activeOperation(organizationId: string, saleOrderCode: string | null, itemCode: string, except?: string) {
    if (!saleOrderCode) return null;
    const op = await this.prisma.facilitySwitchOperation.findFirst({
      where: { activeLockKey: lockKey(organizationId, saleOrderCode, itemCode), ...(except ? { id: { not: except } } : {}) },
      select: { id: true, status: true },
    });
    return op ? { id: op.id, status: op.status } : null;
  }

  /** The operator's grants as they stand now, not as their token remembers. */
  private async operatorPermissions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { code: true } } } } } } } },
      },
    });
    return {
      active: user?.status === 'ACTIVE',
      permissions: new Set((user?.userRoles ?? []).flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code))),
    };
  }

  private baseInput(
    user: AuthenticatedUser, live: LiveOrder, item: LiveItem | null,
    line: OrderRow['lines'][number] | null, conflict: { id: string; status: string } | null,
    writes: { env: boolean; connection: boolean },
  ) {
    return {
      hasPermission: user.permissions.includes(SWITCH_PERMISSION),
      order: { found: live.found, status: live.status, displayMatches: live.displayMatches },
      item,
      lineMatch: item?.lineMatch ?? null,
      erpOpenQty: line ? openQty(line) : null,
      itemQty: 1,
      conflictingOperation: conflict,
      writes,
      now: new Date(),
    };
  }

  private preferredItem(items: LiveItem[]): LiveItem | undefined {
    const switchable = ['CREATED', 'FULFILLABLE', 'UNFULFILLABLE'];
    return items.find((i) => i.statusCode && switchable.includes(i.statusCode) && !i.shippingPackageCode) ?? items[0];
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private async transition(
    op: Op, to: FacilitySwitchStatus, patch: Prisma.FacilitySwitchOperationUpdateManyMutationInput,
    event: { type: string; actor?: string; errorCode?: string; details?: unknown; ref?: string } | null,
  ): Promise<Op> {
    if (!canTransitionSwitch(op.status, to)) {
      throw new ConflictException({ code: 'ILLEGAL_SWITCH_TRANSITION', message: `Cannot move a switch from ${op.status} to ${to}.` });
    }
    await this.prisma.inTransaction(async (tx) => {
      const updated = await tx.facilitySwitchOperation.updateMany({
        where: { id: op.id, status: op.status as DbStatus },
        data: { ...patch, status: to as DbStatus, ...(holdsSwitchLock(to) ? {} : { activeLockKey: null }) },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: 'SWITCH_STATE_CHANGED', message: 'This switch changed state while it was being processed.' });
      }
      await tx.facilitySwitchEvent.create({
        data: {
          operationId: op.id, eventType: event?.type ?? `STATUS_${to}`,
          statusBefore: op.status as DbStatus, statusAfter: to as DbStatus,
          actorUserId: event?.actor ?? null, integrationReference: event?.ref ?? null,
          errorCode: event?.errorCode ?? null,
          details: (event?.details ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    });
    return { id: op.id, status: to };
  }

  private async patch(op: Op, data: Prisma.FacilitySwitchOperationUpdateManyMutationInput) {
    await this.prisma.facilitySwitchOperation.updateMany({ where: { id: op.id, status: op.status as DbStatus }, data });
  }

  private async event(op: Op, e: { type: string; errorCode?: string; details?: unknown; actor?: string }) {
    await this.prisma.facilitySwitchEvent.create({
      data: {
        operationId: op.id, eventType: e.type, statusBefore: op.status as DbStatus, statusAfter: op.status as DbStatus,
        actorUserId: e.actor ?? null, errorCode: e.errorCode ?? null,
        details: (e.details ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async auditOutcome(row: { id: string; organizationId: string }, action: 'UPDATE' | 'REJECT', outcome: string) {
    const op = await this.prisma.facilitySwitchOperation.findUnique({ where: { id: row.id }, select: { operatorUserId: true, status: true } });
    await this.audit.record({
      organizationId: row.organizationId, actorUserId: op?.operatorUserId ?? null, action,
      entityType: 'FacilitySwitchOperation', entityId: row.id, context: { outcome, status: op?.status ?? null },
    });
  }

  private async ownOperation(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.facilitySwitchOperation.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException({ code: 'SWITCH_NOT_FOUND', message: 'Facility switch not found' });
    if (row.operatorUserId !== user.id) this.assertCanReadHistory(user);
    return row;
  }

  private assertCanReadHistory(user: AuthenticatedUser) {
    if (!user.permissions.includes(SWITCH_PERMISSION) && !user.permissions.includes('admin.view_audit_log')) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_PERMISSIONS', message: `This needs ${SWITCH_PERMISSION} or admin.view_audit_log.` });
    }
  }

  private async present(
    rows: Prisma.FacilitySwitchOperationGetPayload<object>[],
    events: Prisma.FacilitySwitchEventGetPayload<object>[],
  ) {
    const ids = [...new Set([...rows.map((r) => r.operatorUserId), ...rows.map((r) => r.reconciledByUserId), ...events.map((e) => e.actorUserId)].filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      id: r.id,
      reference: r.id.slice(0, 8).toUpperCase(),
      orderId: r.shopifyOrderId,
      lineId: r.shopifyOrderLineId,
      status: r.status,
      saleOrderCode: r.saleOrderCode,
      saleOrderItemCode: r.saleOrderItemCode,
      sku: r.sku,
      quantity: r.quantity.toFixed(),
      sourceFacilityCode: r.sourceFacilityCode,
      targetFacilityCode: r.targetFacilityCode,
      verifiedFacilityCode: r.verifiedFacilityCode,
      reason: r.reason,
      operator: { id: r.operatorUserId, name: name.get(r.operatorUserId) ?? null },
      createdAt: r.createdAt.toISOString(),
      preflightAt: r.preflightAt.toISOString(),
      executionStartedAt: r.executionStartedAt?.toISOString() ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      verificationCompletedAt: r.verificationCompletedAt?.toISOString() ?? null,
      api: {
        respondedAt: r.apiRespondedAt?.toISOString() ?? null,
        successful: r.apiSuccessful, message: r.apiMessage, errors: r.apiErrors ?? [], warnings: r.apiWarnings ?? [],
      },
      failure: r.failureCode ? { code: r.failureCode, message: r.failureMessage } : null,
      reconciliation: r.reconciliation
        ? {
            ...(r.reconciliation as object),
            demandId: r.manufacturingDemandId,
            reviewedAt: r.reconciledAt?.toISOString() ?? null,
            reviewedBy: r.reconciledByUserId ? name.get(r.reconciledByUserId) ?? null : null,
            note: r.reconciliationNote,
          }
        : null,
      events: events.filter((e) => e.operationId === r.id).map((e) => ({
        type: e.eventType, at: e.at.toISOString(), statusBefore: e.statusBefore, statusAfter: e.statusAfter,
        actor: e.actorUserId ? name.get(e.actorUserId) ?? null : null, errorCode: e.errorCode, details: e.details,
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Preflight token
  // ---------------------------------------------------------------------------

  private key(): Buffer {
    const secret = String(this.config.get('JWT_ACCESS_SECRET') ?? '');
    return createHmac('sha256', secret).update('facility-switch-preflight:v1').digest();
  }

  signToken(claims: TokenClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const mac = createHmac('sha256', this.key()).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }

  verifyToken(token: string): TokenClaims {
    const [payload, mac] = token.split('.');
    const expected = payload ? createHmac('sha256', this.key()).update(payload).digest() : null;
    const given = mac ? Buffer.from(mac, 'base64url') : null;
    if (!payload || !expected || !given || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ConflictException({ code: 'PREFLIGHT_INVALID', message: 'The confirmation could not be verified. Check again before confirming.' });
    }
    let claims: TokenClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenClaims;
    } catch {
      throw new ConflictException({ code: 'PREFLIGHT_INVALID', message: 'The confirmation could not be read. Check again before confirming.' });
    }
    if (claims.v !== 1 || typeof claims.exp !== 'number' || Date.now() > claims.exp) {
      throw new GoneException({ code: 'PREFLIGHT_EXPIRED', message: 'The checks are more than 30 seconds old. Check again before confirming.' });
    }
    return claims;
  }
}

// -----------------------------------------------------------------------------

function lockKey(org: string, saleOrderCode: string, itemCode: string): string {
  return `${org}:${saleOrderCode}:${itemCode}`;
}

function openQty(line: { orderedQty: Prisma.Decimal; cancelledQty: Prisma.Decimal; fulfilledQty: Prisma.Decimal }): string {
  const open = dec(line.orderedQty.toFixed()).minus(dec(line.cancelledQty.toFixed())).minus(dec(line.fulfilledQty.toFixed()));
  return (open.lessThan(0) ? dec('0') : open).toFixed();
}

function apiOutcomeOf(row: { apiSuccessful: boolean | null }): SwitchApiOutcome {
  return row.apiSuccessful === true ? 'ACCEPTED' : row.apiSuccessful === false ? 'REJECTED' : 'NO_RESPONSE';
}

const rank = (m: LineMatch) => ({ LINE_ID: 0, VARIANT: 1, SKU: 2 })[m];
const digits = (s: string) => s.replace(/\D/g, '');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorCode(error: unknown): string {
  return String((error as { response?: { code?: string } })?.response?.code ?? 'ERROR');
}

/** A message safe to store and show: no stack, no URL, bounded length. */
function safeMessage(error: unknown): string {
  const r = (error as { response?: { message?: string } })?.response?.message;
  const m = r ?? (error instanceof Error ? error.message : String(error));
  return m.replace(/https?:\/\/\S+/g, '[url]').slice(0, 300);
}

function errorText(error: unknown): string {
  return safeMessage(error);
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

