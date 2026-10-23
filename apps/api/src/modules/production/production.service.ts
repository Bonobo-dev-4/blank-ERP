import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal, assertRouteChainConsistent, assertStageTaskConsistent, availableToForward,
  buildBatchCode, computeBatchProgress, normaliseScannedCode, planBatchSplit, planForward,
  planFinalStageCompletion, planRelease, planReturnFromRework, planSendToRework,
  planStageOutcome, qty, reworkOutstanding, wipAtStage,
  type BatchState, type StageTaskState, type StageTransitionPlan,
} from '@dnd/domain';
import type {
  AuthenticatedUser, CreateBatchesRequest, ForwardStageRequest, RecordScanRequest,
  SplitBatchRequest, StageOutcomeRequest, UpsertRouteRequest, UpsertStageRequest,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';


const TASK_INCLUDE = {
  productionStage: { select: { id: true, code: true, name: true, requiresQc: true, consumesMaterial: true } },
  routeStep: { select: { id: true, sequence: true, isOptional: true, standardMinutes: true } },
} satisfies Prisma.ProductionStageTaskInclude;

const BATCH_INCLUDE = {
  stageTasks: { orderBy: { sequence: 'asc' }, include: TASK_INCLUDE },
  route: { select: { id: true, code: true, name: true } },
  manufacturingOrder: { select: { id: true, moNo: true, status: true, productId: true } },
  manufacturingOrderItem: {
    select: {
      id: true, lineNo: true, size: true, color: true, orderedQty: true, releasedQty: true,
      productVariant: { select: { id: true, sku: true, size: true } },
    },
  },
} satisfies Prisma.ProductionBatchInclude;

type LoadedTask = Prisma.ProductionStageTaskGetPayload<{ include: typeof TASK_INCLUDE }>;
type LoadedBatch = Prisma.ProductionBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

/**
 * The shop floor.
 *
 * Every quantity movement here goes through `@dnd/domain`'s stage ledger, which
 * holds the one rule that makes production figures trustworthy: **quantities
 * are never summed across stages.** Cutting 100, stitching 85 and finishing 60
 * means 60 garments exist and work is in progress, not 245.
 *
 * The service's job is narrow: lock the affected stage tasks, hand their
 * counters to a `plan*` function, apply exactly the deltas it returns, write an
 * immutable `ProductionStageMovement`, and re-assert consistency. Nothing here
 * decides arithmetic.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * One scannable barcode per batch, minted with the batch itself.
   *
   * A batch without a barcode is a batch nobody can scan, so the two are
   * created in the same transaction rather than by a later step someone has to
   * remember.
   */
  private async mintBatchBarcode(
    tx: Prisma.TransactionClient,
    organizationId: string,
    batchId: string,
    batchNo: string,
    label: Record<string, unknown>,
  ): Promise<void> {
    await tx.barcodeIdentifier.create({
      data: {
        organizationId,
        code: batchNo,
        kind: 'PRODUCTION_BATCH',
        productionBatchId: batchId,
        labelData: label as Prisma.InputJsonValue,
      },
    });
  }

  // =========================================================================
  // batches
  // =========================================================================

  /**
   * Create batches for a released order.
   *
   * Deliberately NOT done at release: a batch is a physical bundle whose size
   * is a floor decision, and release is already the transaction that freezes
   * the BOM snapshot. See decisions.md §26.
   */
  async createBatches(organizationId: string, actorUserId: string, body: CreateBatchesRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'production.createBatches',
        key: body.idempotencyKey,
        payload: body,
        entityType: 'ProductionBatch',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const order = await tx.manufacturingOrder.findFirst({
            where: { id: body.manufacturingOrderId, organizationId },
            include: {
              items: { orderBy: { lineNo: 'asc' }, include: { batches: { select: { plannedQty: true } } } },
              product: { select: { id: true, defaultRouteId: true } },
            },
          });
          if (!order) {
            throw new NotFoundException({
              code: 'MANUFACTURING_ORDER_NOT_FOUND',
              message: 'Manufacturing order not found',
            });
          }
          if (!order.releasedAt) {
            throw new ConflictException({
              code: 'MO_NOT_RELEASED',
              message: `Order ${order.moNo} is ${order.status}. Release it before creating batches — a batch carries the BOM snapshot that release freezes.`,
              details: { status: order.status },
            });
          }

          const routeId = body.routeId ?? order.routeId ?? order.product.defaultRouteId;
          if (!routeId) {
            throw new BadRequestException({
              code: 'NO_PRODUCTION_ROUTE',
              message:
                'No production route for this order. A batch cannot exist without a route, because the route is what defines the stages it passes through.',
              details: { manufacturingOrderId: order.id },
            });
          }

          const route = await tx.productionRoute.findFirst({
            where: { id: routeId, organizationId },
            include: {
              steps: {
                orderBy: { sequence: 'asc' },
                include: { productionStage: { select: { id: true, code: true } } },
              },
            },
          });
          if (!route || route.steps.length === 0) {
            throw new BadRequestException({
              code: 'ROUTE_HAS_NO_STEPS',
              message: 'That production route has no steps',
              details: { routeId },
            });
          }

          // Default: one batch per order line, for whatever of its released
          // quantity has not already been batched.
          const requested =
            body.batches ??
            order.items
              .map((item) => {
                const already = item.batches.reduce<Decimal>(
                  (acc, b) => acc.plus(qty(b.plannedQty.toFixed())),
                  new Decimal(0),
                );
                const remaining = qty(item.releasedQty.toFixed()).minus(already);
                return { manufacturingOrderItemId: item.id, plannedQty: remaining.toFixed(4) };
              })
              .filter((b) => Number(b.plannedQty) > 0);

          if (requested.length === 0) {
            throw new ConflictException({
              code: 'NOTHING_TO_BATCH',
              message:
                'Every released garment on this order is already in a batch. Release more quantity, or split an existing batch.',
              details: { manufacturingOrderId: order.id },
            });
          }

          const itemById = new Map(order.items.map((i) => [i.id, i]));
          const created: { id: string; batchNo: string; plannedQty: string }[] = [];

          for (const spec of requested) {
            const item = itemById.get(spec.manufacturingOrderItemId);
            if (!item) {
              throw new BadRequestException({
                code: 'ITEM_NOT_IN_ORDER',
                message: 'A batch names an order line that does not belong to this order',
                details: { manufacturingOrderItemId: spec.manufacturingOrderItemId },
              });
            }

            const alreadyBatched = item.batches.reduce<Decimal>(
              (acc, b) => acc.plus(qty(b.plannedQty.toFixed())),
              new Decimal(0),
            );
            const wanted = qty(spec.plannedQty);
            const releasable = qty(item.releasedQty.toFixed()).minus(alreadyBatched);
            if (wanted.greaterThan(releasable)) {
              throw new ConflictException({
                code: 'BATCH_EXCEEDS_RELEASED_QTY',
                message:
                  'Batch quantity exceeds what has been released on that order line and is not already batched',
                details: {
                  manufacturingOrderItemId: item.id,
                  requestedQty: wanted.toFixed(4),
                  releasedQty: qty(item.releasedQty.toFixed()).toFixed(4),
                  alreadyBatchedQty: alreadyBatched.toFixed(4),
                  availableToBatchQty: releasable.toFixed(4),
                },
              });
            }

            const sequence = (await tx.productionBatch.count({ where: { manufacturingOrderId: order.id } })) + 1;
            const batchNo = buildBatchCode(order.moNo, sequence);

            const batch = await tx.productionBatch.create({
              data: {
                organizationId,
                manufacturingOrderId: order.id,
                manufacturingOrderItemId: item.id,
                batchNo,
                routeId: route.id,
                trackingMode: body.trackingMode,
                plannedQty: new Prisma.Decimal(wanted.toFixed(4)),
                status: 'OPEN',
                createdByUserId: actorUserId,
                // One task per route step, created up front so the whole route
                // is visible from the moment the batch exists — an operator
                // needs to know what happens after them.
                stageTasks: {
                  create: route.steps.map((step) => ({
                    organizationId,
                    routeStepId: step.id,
                    productionStageId: step.productionStageId,
                    sequence: step.sequence,
                    plannedQty: new Prisma.Decimal(wanted.toFixed(4)),
                    status: 'NOT_STARTED' as const,
                  })),
                },
              },
              select: { id: true, batchNo: true, plannedQty: true },
            });

            await this.mintBatchBarcode(tx, organizationId, batch.id, batchNo, {
              moNo: order.moNo,
              sku: item.productVariantId,
              size: item.size,
              plannedQty: wanted.toFixed(4),
              routeCode: route.code,
            });
            created.push({ id: batch.id, batchNo, plannedQty: wanted.toFixed(4) });
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'CREATE',
              entityType: 'ProductionBatch', entityId: created[0].id,
              context: {
                moNo: order.moNo, routeCode: route.code,
                batchCount: created.length, batchNos: created.map((c) => c.batchNo),
              },
            },
            tx,
          );

          return { result: { manufacturingOrderId: order.id, routeId: route.id, batches: created }, entityId: created[0].id };
        }),
    );
    return result;
  }

  async listBatches(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      manufacturingOrderId?: string; status?: string; productionStageId?: string;
    },
  ) {
    const where: Prisma.ProductionBatchWhereInput = {
      organizationId,
      ...(query.manufacturingOrderId ? { manufacturingOrderId: query.manufacturingOrderId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.productionStageId
        ? { stageTasks: { some: { productionStageId: query.productionStageId, status: 'IN_PROGRESS' } } }
        : {}),
      ...(searchFilter(query.search, ['batchNo']) ?? {}),
    };

    const args = pageArgs(query, ['batchNo', 'createdAt'], 'createdAt');
    const [rows, total] = await Promise.all([
      this.prisma.productionBatch.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { createdAt: 'desc' },
        include: BATCH_INCLUDE,
      }),
      this.prisma.productionBatch.count({ where }),
    ]);

    return paginated(rows.map((b) => this.decorateBatch(b)), total, query);
  }

  async getBatch(organizationId: string, id: string) {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id, organizationId },
      include: {
        ...BATCH_INCLUDE,
        stageMovements: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            fromStageTask: { select: { id: true, sequence: true, productionStage: { select: { code: true, name: true } } } },
            toStageTask: { select: { id: true, sequence: true, productionStage: { select: { code: true, name: true } } } },
          },
        },
        barcode: { select: { id: true, code: true, kind: true } },
        childBatches: { select: { id: true, batchNo: true, plannedQty: true, status: true } },
        parentBatch: { select: { id: true, batchNo: true } },
      },
    });
    if (!batch) throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });

    return {
      ...this.decorateBatch(batch),
      movements: batch.stageMovements,
      barcode: batch.barcode,
      childBatches: batch.childBatches,
      parentBatch: batch.parentBatch,
    };
  }

  /**
   * Split a batch.
   *
   * Only quantity that has not yet entered the route can be split off. Once
   * garments are at a stage they are in a physical bundle somewhere, and
   * splitting them on paper would make the paper disagree with the floor.
   */
  async splitBatch(organizationId: string, actorUserId: string, id: string, body: SplitBatchRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'production.splitBatch',
        key: body.idempotencyKey,
        payload: { batchId: id, ...body },
        entityType: 'ProductionBatch',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const batch = await tx.productionBatch.findFirst({
            where: { id, organizationId },
            include: {
              stageTasks: { orderBy: { sequence: 'asc' } },
              route: { select: { id: true, steps: { select: { id: true, productionStageId: true, sequence: true } } } },
              manufacturingOrder: { select: { id: true, moNo: true } },
            },
          });
          if (!batch) throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });

          const released = qty(batch.releasedQty.toFixed());
          if (released.greaterThan(0)) {
            throw new ConflictException({
              code: 'BATCH_ALREADY_IN_ROUTE',
              message:
                'This batch has already entered the route. Garments at a stage are in a physical bundle; splitting them here would make the records disagree with the floor.',
              details: { batchId: id, releasedQty: released.toFixed(4) },
            });
          }

          // The domain decides whether the parts add up.
          // The domain decides whether the parts partition the parent exactly:
          // a split must never create or lose garments.
          const plan = planBatchSplit(
            batch.id,
            batch.plannedQty.toFixed(),
            body.parts.map((p) => p.plannedQty),
          );

          const createdChildren: { id: string; batchNo: string; plannedQty: string }[] = [];
          for (const childQty of plan.childQuantities) {
            const sequence =
              (await tx.productionBatch.count({ where: { manufacturingOrderId: batch.manufacturingOrderId } })) + 1;
            const batchNo = buildBatchCode(batch.manufacturingOrder.moNo, sequence);
            const child = await tx.productionBatch.create({
              data: {
                organizationId,
                manufacturingOrderId: batch.manufacturingOrderId,
                manufacturingOrderItemId: batch.manufacturingOrderItemId,
                batchNo,
                routeId: batch.routeId,
                trackingMode: batch.trackingMode,
                plannedQty: new Prisma.Decimal(childQty.toFixed(4)),
                status: 'OPEN',
                parentBatchId: batch.id,
                splitReason: body.reason,
                createdByUserId: actorUserId,
                stageTasks: {
                  create: batch.route.steps.map((step) => ({
                    organizationId,
                    routeStepId: step.id,
                    productionStageId: step.productionStageId,
                    sequence: step.sequence,
                    plannedQty: new Prisma.Decimal(childQty.toFixed(4)),
                    status: 'NOT_STARTED' as const,
                  })),
                },
              },
              select: { id: true, batchNo: true },
            });
            await this.mintBatchBarcode(tx, organizationId, child.id, batchNo, {
              moNo: batch.manufacturingOrder.moNo,
              plannedQty: childQty.toFixed(4),
              splitFrom: batch.batchNo,
            });
            createdChildren.push({ id: child.id, batchNo, plannedQty: childQty.toFixed(4) });
          }

          // The parent is closed, not shrunk: its barcode has been printed and
          // may be on a physical docket, so it must resolve to something that
          // explains where its garments went.
          await tx.productionBatch.update({
            where: { id: batch.id },
            data: { status: 'CLOSED', splitReason: body.reason, completedAt: new Date() },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'UPDATE',
              entityType: 'ProductionBatch', entityId: batch.id,
              context: {
                batchNo: batch.batchNo, reason: body.reason,
                children: createdChildren.map((c) => c.batchNo),
              },
            },
            tx,
          );

          return {
            result: { parentBatchId: batch.id, parentBatchNo: batch.batchNo, children: createdChildren },
            entityId: batch.id,
          };
        }),
    );
    return result;
  }

  /** Put quantity into the first step of the route. */
  async releaseIntoRoute(
    organizationId: string,
    actorUserId: string,
    batchId: string,
    body: { idempotencyKey: string; releaseQty: string },
  ) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'production.releaseBatch',
        key: body.idempotencyKey,
        payload: { batchId, ...body },
        entityType: 'ProductionBatch',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const batch = await this.loadBatchForWrite(tx, organizationId, batchId);
          const first = batch.stageTasks.find((t) => t.sequence === 1);
          if (!first) {
            throw new BadRequestException({
              code: 'ROUTE_HAS_NO_FIRST_STEP',
              message: 'This batch has no first route step',
              details: { batchId },
            });
          }

          const plan = planRelease(this.toBatchState(batch), this.toTaskState(first), body.releaseQty);
          await this.applyPlan(tx, organizationId, batch, plan, {
            actorUserId,
            fromStageTaskId: null,
            toStageTaskId: first.id,
            movementKey: `${body.idempotencyKey}:release`,
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'RELEASE',
              entityType: 'ProductionBatch', entityId: batchId,
              context: { batchNo: batch.batchNo, releaseQty: plan.qty.toFixed(4), intoStage: first.productionStage.code },
            },
            tx,
          );

          return { result: await this.presentBatch(tx, organizationId, batchId), entityId: batchId };
        }),
    );
    return result;
  }

  // =========================================================================
  // stage transitions
  // =========================================================================

  /** Record what a stage did with the garments it holds. */
  async recordOutcome(
    organizationId: string,
    user: AuthenticatedUser,
    stageTaskId: string,
    body: StageOutcomeRequest,
  ) {
    const actorUserId = user.id;
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'production.stageOutcome',
        key: body.idempotencyKey,
        payload: { stageTaskId, ...body },
        entityType: 'ProductionStageTask',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const { batch, task } = await this.loadTaskForWrite(tx, organizationId, stageTaskId);
          this.assertMayRecordAtStage(task, user);

          const isLastStep = task.sequence === Math.max(...batch.stageTasks.map((t) => t.sequence));
          const outcome = {
            completedQty: body.completedQty,
            rejectedQty: body.rejectedQty,
            reworkQty: body.reworkQty,
          };

          // Completing the LAST step is what makes a garment finished at the
          // batch level. An earlier stage completing does not.
          const plan = isLastStep
            ? planFinalStageCompletion(this.toBatchState(batch), this.toTaskState(task), outcome)
            : planStageOutcome(this.toTaskState(task), outcome);

          await this.applyPlan(tx, organizationId, batch, plan, {
            actorUserId,
            fromStageTaskId: task.id,
            toStageTaskId: null,
            remarks: body.remarks ?? body.rejectionReason,
            movementKey: `${body.idempotencyKey}:outcome`,
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'ProductionStageTask', entityId: stageTaskId,
              context: {
                batchNo: batch.batchNo, stageCode: task.productionStage.code,
                completedQty: body.completedQty, rejectedQty: body.rejectedQty, reworkQty: body.reworkQty,
                rejectionReason: body.rejectionReason ?? null,
              },
            },
            tx,
          );

          return { result: await this.presentBatch(tx, organizationId, batch.id), entityId: stageTaskId };
        }),
    );
    return result;
  }

  /** Hand accepted quantity to the next step. */
  async forward(
    organizationId: string,
    user: AuthenticatedUser,
    stageTaskId: string,
    body: ForwardStageRequest,
  ) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'production.forward',
        key: body.idempotencyKey,
        payload: { stageTaskId, ...body },
        entityType: 'ProductionStageTask',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const { batch, task } = await this.loadTaskForWrite(tx, organizationId, stageTaskId);
          this.assertMayRecordAtStage(task, user);

          const target = body.toStageTaskId
            ? batch.stageTasks.find((t) => t.id === body.toStageTaskId)
            : batch.stageTasks.find((t) => t.sequence === task.sequence + 1);

          if (!target) {
            throw new BadRequestException({
              code: 'NO_NEXT_STAGE',
              message:
                task.sequence === Math.max(...batch.stageTasks.map((t) => t.sequence))
                  ? 'This is the last step of the route; there is nowhere to forward to.'
                  : 'The next route step could not be resolved',
              details: { stageTaskId, sequence: task.sequence },
            });
          }

          // Skipping a step is an authorised exception, not a convenience.
          if (body.allowStageSkip && !user.permissions.includes('production.override_stage')) {
            throw new ConflictException({
              code: 'STAGE_SKIP_NOT_AUTHORISED',
              message: 'Skipping a route step needs the production.override_stage permission',
              details: { requiredPermission: 'production.override_stage' },
            });
          }
          if (body.allowStageSkip && !body.overrideReason) {
            throw new BadRequestException({
              code: 'STAGE_SKIP_REASON_REQUIRED',
              message: 'Skipping a route step needs a written reason',
            });
          }

          const plan = planForward(
            this.toTaskState(task),
            this.toTaskState(target),
            body.forwardQty,
            { allowStageSkip: body.allowStageSkip },
          );

          await this.applyPlan(tx, organizationId, batch, plan, {
            actorUserId: user.id,
            fromStageTaskId: task.id,
            toStageTaskId: target.id,
            remarks: body.overrideReason ?? body.remarks,
            movementKey: `${body.idempotencyKey}:forward`,
          });

          await this.audit.record(
            {
              organizationId, actorUserId: user.id, action: 'POST',
              entityType: 'ProductionStageTask', entityId: stageTaskId,
              context: {
                batchNo: batch.batchNo,
                from: task.productionStage.code,
                to: target.productionStage.code,
                forwardQty: plan.qty.toFixed(4),
                skipped: body.allowStageSkip,
                overrideReason: body.overrideReason ?? null,
              },
            },
            tx,
          );

          return { result: await this.presentBatch(tx, organizationId, batch.id), entityId: stageTaskId };
        }),
    );
    return result;
  }

  /** Send work in progress out to rework. */
  async sendToRework(
    organizationId: string,
    actorUserId: string,
    stageTaskId: string,
    body: { idempotencyKey: string; reworkQty: string; remarks?: string | null },
  ) {
    return this.applySimpleTransition(
      organizationId, actorUserId, stageTaskId, body.idempotencyKey,
      { scope: 'production.sendToRework', payload: body, action: 'SEND_TO_REWORK' },
      (task) => planSendToRework(task, body.reworkQty),
      body.remarks,
    );
  }

  /** Bring reworked quantity back to the stage it left. */
  async returnFromRework(
    organizationId: string,
    actorUserId: string,
    stageTaskId: string,
    body: { idempotencyKey: string; returnQty: string; remarks?: string | null },
  ) {
    return this.applySimpleTransition(
      organizationId, actorUserId, stageTaskId, body.idempotencyKey,
      { scope: 'production.returnFromRework', payload: body, action: 'RETURN_FROM_REWORK' },
      (task) => planReturnFromRework(task, body.returnQty),
      body.remarks,
    );
  }

  private async applySimpleTransition(
    organizationId: string,
    actorUserId: string,
    stageTaskId: string,
    key: string,
    meta: { scope: string; payload: unknown; action: string },
    plannerFn: (task: StageTaskState) => StageTransitionPlan,
    remarks?: string | null,
  ) {
    const { result } = await this.idempotency.execute(
      {
        organizationId, scope: meta.scope, key,
        payload: { stageTaskId, ...(meta.payload as Record<string, unknown>) },
        entityType: 'ProductionStageTask',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const { batch, task } = await this.loadTaskForWrite(tx, organizationId, stageTaskId);
          const plan = plannerFn(this.toTaskState(task));
          await this.applyPlan(tx, organizationId, batch, plan, {
            actorUserId, fromStageTaskId: task.id, toStageTaskId: null, remarks,
            movementKey: `${key}:${meta.action}`,
          });
          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'ProductionStageTask', entityId: stageTaskId,
              context: {
                batchNo: batch.batchNo, stageCode: task.productionStage.code,
                transition: meta.action, qty: plan.qty.toFixed(4),
              },
            },
            tx,
          );
          return { result: await this.presentBatch(tx, organizationId, batch.id), entityId: stageTaskId };
        }),
    );
    return result;
  }

  async listStageTasks(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      productionStageId?: string; status?: string; productionBatchId?: string; withWipOnly?: boolean;
    },
  ) {
    const where: Prisma.ProductionStageTaskWhereInput = {
      organizationId,
      ...(query.productionStageId ? { productionStageId: query.productionStageId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.productionBatchId ? { productionBatchId: query.productionBatchId } : {}),
      // "Has work in progress" cannot be expressed as a column comparison in
      // Prisma, so narrow in SQL to tasks that have received something and
      // filter the exact WIP arithmetic in code.
      ...(query.withWipOnly ? { receivedQty: { gt: 0 } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.productionStageTask.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          ...TASK_INCLUDE,
          productionBatch: {
            select: {
              id: true, batchNo: true, plannedQty: true, status: true,
              manufacturingOrder: { select: { id: true, moNo: true, dueDate: true, priority: true } },
              manufacturingOrderItem: {
                select: { size: true, productVariant: { select: { sku: true } } },
              },
            },
          },
        },
      }),
      this.prisma.productionStageTask.count({ where }),
    ]);

    const decorated = rows
      .map((t) => ({
        ...t,
        wipQty: wipAtStage(this.toTaskState(t)).toFixed(4),
        availableToForwardQty: availableToForward(this.toTaskState(t)).toFixed(4),
        reworkOutstandingQty: reworkOutstanding(this.toTaskState(t)).toFixed(4),
      }))
      .filter((t) => !query.withWipOnly || Number(t.wipQty) > 0);

    return paginated(decorated, total, query);
  }

  // =========================================================================
  // scanning
  // =========================================================================

  /**
   * What is this code, and what can be done with it here?
   *
   * Read-only. The scan station looks a code up and shows the operator what it
   * found before asking for a quantity, because a scan that silently does the
   * wrong thing to the wrong batch is far harder to unpick than one that asks.
   */
  async resolveScan(organizationId: string, code: string, productionStageId?: string | null) {
    const normalised = normaliseScannedCode(code);

    const identifier = await this.prisma.barcodeIdentifier.findFirst({
      where: { organizationId, code: normalised },
      include: {
        productionBatch: { include: BATCH_INCLUDE },
        materialLot: { select: { id: true, lotCode: true, rawMaterial: { select: { materialCode: true, name: true } } } },
        fabricRoll: { select: { id: true, rollNo: true, currentLength: true, status: true } },
      },
    });

    if (!identifier) {
      return {
        code: normalised,
        found: false,
        kind: null,
        message: 'That barcode is not known to this system.',
        actions: [],
      };
    }
    if (identifier.revokedAt) {
      return {
        code: normalised,
        found: true,
        kind: identifier.kind,
        message: 'That barcode has been revoked and must not be used.',
        actions: [],
      };
    }

    if (!identifier.productionBatch) {
      // A lot or roll barcode: useful for lookup, but not a stage transition.
      return {
        code: normalised,
        found: true,
        kind: identifier.kind,
        message: 'Recognised, but this is not a production batch.',
        materialLot: identifier.materialLot,
        fabricRoll: identifier.fabricRoll,
        actions: [],
      };
    }

    const batch = this.decorateBatch(identifier.productionBatch);
    // Where this batch actually is, which is not necessarily where the
    // operator is standing.
    const tasks = identifier.productionBatch.stageTasks;
    const here = productionStageId
      ? tasks.find((t) => t.productionStageId === productionStageId)
      : tasks.find((t) => wipAtStage(this.toTaskState(t)).greaterThan(0)) ??
        tasks.find((t) => availableToForward(this.toTaskState(t)).greaterThan(0));

    const actions: { action: string; stageTaskId: string; maxQty: string; label: string }[] = [];
    if (here) {
      const state = this.toTaskState(here);
      const wip = wipAtStage(state);
      const forwardable = availableToForward(state);
      const outstandingRework = reworkOutstanding(state);

      if (wip.greaterThan(0)) {
        actions.push({
          action: 'RECORD_OUTCOME', stageTaskId: here.id, maxQty: wip.toFixed(4),
          label: `Record what ${here.productionStage.name} did`,
        });
        actions.push({
          action: 'SEND_TO_REWORK', stageTaskId: here.id, maxQty: wip.toFixed(4),
          label: 'Send to rework',
        });
      }
      if (forwardable.greaterThan(0)) {
        const next = tasks.find((t) => t.sequence === here.sequence + 1);
        actions.push({
          action: 'FORWARD', stageTaskId: here.id, maxQty: forwardable.toFixed(4),
          label: next ? `Forward to ${next.productionStage.name}` : 'Complete the route',
        });
      }
      if (outstandingRework.greaterThan(0)) {
        actions.push({
          action: 'RETURN_FROM_REWORK', stageTaskId: here.id, maxQty: outstandingRework.toFixed(4),
          label: 'Return from rework',
        });
      }
    }

    return {
      code: normalised,
      found: true,
      kind: identifier.kind,
      message: here
        ? null
        : 'This batch has nothing to do at your stage right now.',
      batch,
      currentStageTaskId: here?.id ?? null,
      currentStageCode: here?.productionStage.code ?? null,
      actions,
    };
  }

  /**
   * Record a scan and apply the transition it represents, in one transaction.
   *
   * Every scan writes a `BarcodeScanEvent` whether it is accepted or refused,
   * because a refused scan is operational evidence: five rejected scans at one
   * station is a label problem or a training problem, and it is invisible if
   * only successes are stored.
   */
  async recordScan(organizationId: string, user: AuthenticatedUser, body: RecordScanRequest) {
    const normalised = normaliseScannedCode(body.code);
    const scannedAt = body.scannedAt ? new Date(body.scannedAt) : new Date();

    // The row-level unique key is the real guard: it survives even if the
    // request-level record were bypassed.
    const existing = await this.prisma.barcodeScanEvent.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: body.idempotencyKey } },
      select: { id: true, status: true, productionBatchId: true, validationMessage: true },
    });
    if (existing) {
      return {
        scanEventId: existing.id,
        status: 'DUPLICATE_IGNORED' as const,
        accepted: existing.status === 'ACCEPTED',
        message: 'This scan has already been recorded.',
        batch: existing.productionBatchId
          ? await this.presentBatch(this.prisma, organizationId, existing.productionBatchId)
          : null,
      };
    }

    try {
      return await this.prisma.inTransaction(async (tx) => {
        const identifier = await tx.barcodeIdentifier.findFirst({
          where: { organizationId, code: normalised },
          select: { id: true, kind: true, revokedAt: true, productionBatchId: true },
        });

        if (!identifier || !identifier.productionBatchId) {
          throw new BadRequestException({
            code: 'BARCODE_UNKNOWN',
            message: identifier
              ? 'That barcode is not a production batch'
              : 'That barcode is not known to this system',
            details: { code: normalised },
          });
        }
        if (identifier.revokedAt) {
          throw new ConflictException({
            code: 'BARCODE_REVOKED',
            message: 'That barcode has been revoked and must not be used',
            details: { code: normalised },
          });
        }

        const stageTaskId = body.stageTaskId ?? null;
        if (!stageTaskId && body.eventType !== 'LOOKUP') {
          throw new BadRequestException({
            code: 'STAGE_TASK_REQUIRED',
            message: 'A stage transition needs the route step it applies to',
          });
        }

        let batchId = identifier.productionBatchId;

        if (body.eventType !== 'LOOKUP') {
          const { batch, task } = await this.loadTaskForWrite(tx, organizationId, stageTaskId!);
          this.assertMayRecordAtStage(task, user);
          if (batch.id !== identifier.productionBatchId) {
            throw new BadRequestException({
              code: 'SCAN_BATCH_MISMATCH',
              message: 'That route step belongs to a different batch than the one scanned',
              details: { scannedBatchId: identifier.productionBatchId, stageTaskBatchId: batch.id },
            });
          }
          batchId = batch.id;

          const isLast = task.sequence === Math.max(...batch.stageTasks.map((t) => t.sequence));
          const outcome = {
            completedQty: body.completedQty ?? '0',
            rejectedQty: body.rejectedQty ?? '0',
            reworkQty: body.reworkQty ?? '0',
          };

          let plan: StageTransitionPlan;
          let toTaskId: string | null = null;

          switch (body.eventType) {
            case 'STAGE_COMPLETE':
            case 'STAGE_REJECT':
            case 'QC_SCAN':
              plan = isLast
                ? planFinalStageCompletion(this.toBatchState(batch), this.toTaskState(task), outcome)
                : planStageOutcome(this.toTaskState(task), outcome);
              break;
            case 'STAGE_RECEIVE': {
              const prev = batch.stageTasks.find((t) => t.sequence === task.sequence - 1);
              if (!prev) {
                throw new BadRequestException({
                  code: 'NO_PREVIOUS_STAGE',
                  message: 'This is the first step; quantity enters it by releasing the batch, not by receiving',
                });
              }
              plan = planForward(
                this.toTaskState(prev),
                this.toTaskState(task),
                body.completedQty ?? '0',
              );
              toTaskId = task.id;
              break;
            }
            case 'REWORK_SEND':
              plan = planSendToRework(this.toTaskState(task), body.reworkQty ?? '0');
              break;
            case 'REWORK_RETURN':
              plan = planReturnFromRework(this.toTaskState(task), body.completedQty ?? '0');
              break;
            default:
              throw new BadRequestException({
                code: 'SCAN_TYPE_NOT_SUPPORTED',
                message: `Scan type ${body.eventType} is not a stage transition`,
              });
          }

          const scanEvent = await tx.barcodeScanEvent.create({
            data: {
              organizationId,
              scannedCode: normalised,
              barcodeIdentifierId: identifier.id,
              eventType: body.eventType,
              status: 'ACCEPTED',
              productionBatchId: batchId,
              fromStageId: task.productionStageId,
              toStageId: toTaskId ? task.productionStageId : null,
              completedQty: body.completedQty ? new Prisma.Decimal(body.completedQty) : null,
              rejectedQty: body.rejectedQty ? new Prisma.Decimal(body.rejectedQty) : null,
              reworkQty: body.reworkQty ? new Prisma.Decimal(body.reworkQty) : null,
              operatorUserId: user.id,
              deviceId: body.deviceId ?? null,
              sessionId: body.sessionId ?? null,
              remarks: body.remarks ?? body.rejectionReason ?? null,
              idempotencyKey: body.idempotencyKey,
              scannedAt,
            },
            select: { id: true },
          });

          await this.applyPlan(tx, organizationId, batch, plan, {
            actorUserId: user.id,
            fromStageTaskId: body.eventType === 'STAGE_RECEIVE'
              ? batch.stageTasks.find((t) => t.sequence === task.sequence - 1)!.id
              : task.id,
            toStageTaskId: toTaskId,
            scanEventId: scanEvent.id,
            remarks: body.remarks ?? body.rejectionReason,
            movementKey: `${body.idempotencyKey}:scan`,
          });

          return {
            scanEventId: scanEvent.id,
            status: 'ACCEPTED' as const,
            accepted: true,
            message: null,
            batch: await this.presentBatch(tx, organizationId, batchId),
          };
        }

        const lookup = await tx.barcodeScanEvent.create({
          data: {
            organizationId,
            scannedCode: normalised,
            barcodeIdentifierId: identifier.id,
            eventType: 'LOOKUP',
            status: 'ACCEPTED',
            productionBatchId: batchId,
            operatorUserId: user.id,
            deviceId: body.deviceId ?? null,
            sessionId: body.sessionId ?? null,
            idempotencyKey: body.idempotencyKey,
            scannedAt,
          },
          select: { id: true },
        });

        return {
          scanEventId: lookup.id,
          status: 'ACCEPTED' as const,
          accepted: true,
          message: null,
          batch: await this.presentBatch(tx, organizationId, batchId),
        };
      });
    } catch (error) {
      // A refused scan is operational evidence. Record it, then re-throw so the
      // operator sees the real reason rather than a silent failure.
      await this.recordRejectedScan(organizationId, user.id, body, normalised, scannedAt, error);
      throw error;
    }
  }

  private async recordRejectedScan(
    organizationId: string,
    operatorUserId: string,
    body: RecordScanRequest,
    normalised: string,
    scannedAt: Date,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error
        ? ((error as { response?: { message?: string } }).response?.message ?? error.message)
        : 'Rejected';
    try {
      await this.prisma.barcodeScanEvent.create({
        data: {
          organizationId,
          scannedCode: normalised,
          eventType: body.eventType,
          status: 'REJECTED_VALIDATION',
          completedQty: body.completedQty ? new Prisma.Decimal(body.completedQty) : null,
          rejectedQty: body.rejectedQty ? new Prisma.Decimal(body.rejectedQty) : null,
          reworkQty: body.reworkQty ? new Prisma.Decimal(body.reworkQty) : null,
          operatorUserId,
          deviceId: body.deviceId ?? null,
          sessionId: body.sessionId ?? null,
          validationMessage: String(message).slice(0, 500),
          idempotencyKey: body.idempotencyKey,
          scannedAt,
        },
      });
    } catch {
      // The key is already taken, which means the scan is recorded. Never let
      // bookkeeping mask the original error.
    }
  }

  async listScans(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      productionBatchId?: string; operatorUserId?: string; eventType?: string; status?: string; since?: string;
    },
  ) {
    const where: Prisma.BarcodeScanEventWhereInput = {
      organizationId,
      ...(query.productionBatchId ? { productionBatchId: query.productionBatchId } : {}),
      ...(query.operatorUserId ? { operatorUserId: query.operatorUserId } : {}),
      ...(query.eventType ? { eventType: query.eventType as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.since ? { scannedAt: { gte: new Date(query.since) } } : {}),
      ...(query.search ? { scannedCode: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.barcodeScanEvent.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { scannedAt: 'desc' },
        include: {
          productionBatch: {
            select: { id: true, batchNo: true, manufacturingOrder: { select: { moNo: true } } },
          },
        },
      }),
      this.prisma.barcodeScanEvent.count({ where }),
    ]);

    const operatorIds = [...new Set(rows.map((r) => r.operatorUserId).filter(Boolean))] as string[];
    const operators = await this.prisma.user.findMany({
      where: { id: { in: operatorIds } },
      select: { id: true, fullName: true, employeeCode: true },
    });
    const byId = new Map(operators.map((o) => [o.id, o]));

    return paginated(
      rows.map((r) => ({ ...r, operator: r.operatorUserId ? (byId.get(r.operatorUserId) ?? null) : null })),
      total,
      query,
    );
  }

  /**
   * May this person record work at this route step?
   *
   * The narrowing on top of the permission layer (roadmap 3.13, shape decided
   * in decisions.md §28). It reads the **assignment on the work**, not a
   * department on the user: a stitching supervisor covering cutting for a
   * shift is an ordinary occurrence, and making that an administrative change
   * is how the restriction gets switched off and never switched back on.
   *
   * Unassigned work stays open to anyone holding `production.record_stage` —
   * most of a factory's work is never assigned to a named person, and
   * refusing it would make the floor unusable.
   */
  private assertMayRecordAtStage(
    task: { id: string; assignedUserId: string | null; assignedJobWorkerId: string | null;
      productionStage: { code: string; name: string } },
    user: { id: string; permissions: readonly string[] },
  ): void {
    if (!task.assignedUserId && !task.assignedJobWorkerId) return;

    // Whoever can assign the work can also record it — that is what a
    // supervisor covering an absence does.
    if (user.permissions.includes('production.assign')) return;
    if (user.permissions.includes('production.override_stage')) return;

    if (task.assignedJobWorkerId) {
      throw new ConflictException({
        code: 'STAGE_ASSIGNED_TO_JOB_WORKER',
        message: `${task.productionStage.name} is out with a job worker. Record it by receiving the job work order, so the pieces and the charge stay together.`,
        details: { stageTaskId: task.id, stageCode: task.productionStage.code },
      });
    }

    if (task.assignedUserId !== user.id) {
      throw new ConflictException({
        code: 'STAGE_ASSIGNED_TO_ANOTHER_OPERATOR',
        message: `${task.productionStage.name} is assigned to someone else. A supervisor can reassign it or record it on their behalf.`,
        details: {
          stageTaskId: task.id,
          stageCode: task.productionStage.code,
          requiredPermission: 'production.assign',
        },
      });
    }
  }

  /** Assign a route step to an operator or a job worker. */
  async assignStageTask(
    organizationId: string,
    actorUserId: string,
    stageTaskId: string,
    body: {
      assignedUserId?: string | null; assignedJobWorkerId?: string | null;
      plannedStartAt?: string | null; plannedEndAt?: string | null;
    },
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const task = await tx.productionStageTask.findFirst({
        where: { id: stageTaskId, organizationId },
        include: { productionStage: { select: { code: true, name: true, allowsJobWork: true } } },
      });
      if (!task) throw new NotFoundException({ code: 'STAGE_TASK_NOT_FOUND', message: 'Route step not found' });

      if (body.assignedUserId && body.assignedJobWorkerId) {
        throw new BadRequestException({
          code: 'DOUBLE_ASSIGNMENT',
          message: 'A route step is done in-house or by a job worker, not both',
        });
      }
      if (body.assignedJobWorkerId && !task.productionStage.allowsJobWork) {
        throw new BadRequestException({
          code: 'STAGE_DOES_NOT_ALLOW_JOB_WORK',
          message: `${task.productionStage.name} is not configured to be done by a job worker`,
          details: { stageCode: task.productionStage.code },
        });
      }

      await tx.productionStageTask.update({
        where: { id: stageTaskId },
        data: {
          assignedUserId: body.assignedUserId ?? null,
          assignedJobWorkerId: body.assignedJobWorkerId ?? null,
          plannedStartAt: body.plannedStartAt ? new Date(body.plannedStartAt) : null,
          plannedEndAt: body.plannedEndAt ? new Date(body.plannedEndAt) : null,
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'UPDATE',
          entityType: 'ProductionStageTask', entityId: stageTaskId,
          context: {
            stageCode: task.productionStage.code,
            assignedUserId: body.assignedUserId ?? null,
            assignedJobWorkerId: body.assignedJobWorkerId ?? null,
          },
        },
        tx,
      );

      return this.presentBatch(tx, organizationId, task.productionBatchId);
    });
  }

  // =========================================================================
  // transitions applied inside another module's transaction
  // =========================================================================

  /**
   * Apply a stage outcome on a caller's transaction.
   *
   * Quality inspections and job-work receipts move the same counters as a
   * shop-floor scan, and they must move them the same way. Exposing this
   * rather than letting those modules write `production_stage_tasks`
   * themselves is what keeps one writer for stage quantities — the same rule
   * `LedgerService` holds for stock.
   *
   * The caller owns the transaction and the idempotency; this only plans and
   * applies.
   */
  async applyStageOutcomeWithin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    stageTaskId: string,
    outcome: { completedQty?: string; rejectedQty?: string; reworkQty?: string },
    meta: { actorUserId: string; movementKey: string; remarks?: string | null },
  ): Promise<void> {
    const { batch, task } = await this.loadTaskForWrite(tx, organizationId, stageTaskId);
    const isLast = task.sequence === Math.max(...batch.stageTasks.map((t) => t.sequence));

    const plan = isLast
      ? planFinalStageCompletion(this.toBatchState(batch), this.toTaskState(task), outcome)
      : planStageOutcome(this.toTaskState(task), outcome);

    await this.applyPlan(tx, organizationId, batch, plan, {
      actorUserId: meta.actorUserId,
      fromStageTaskId: task.id,
      toStageTaskId: null,
      remarks: meta.remarks,
      movementKey: meta.movementKey,
    });
  }

  /** Bring reworked quantity back to its stage, on a caller's transaction. */
  async applyReworkReturnWithin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    stageTaskId: string,
    returnQty: string,
    meta: { actorUserId: string; movementKey: string; remarks?: string | null },
  ): Promise<void> {
    const { batch, task } = await this.loadTaskForWrite(tx, organizationId, stageTaskId);
    const plan = planReturnFromRework(this.toTaskState(task), returnQty);
    await this.applyPlan(tx, organizationId, batch, plan, {
      actorUserId: meta.actorUserId,
      fromStageTaskId: task.id,
      toStageTaskId: null,
      remarks: meta.remarks,
      movementKey: meta.movementKey,
    });
  }

  /** The route step a batch is at for a given stage, if the route has one. */
  async stageTaskFor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productionBatchId: string,
    productionStageId: string,
  ): Promise<{ id: string; sequence: number } | null> {
    return tx.productionStageTask.findFirst({
      where: { organizationId, productionBatchId, productionStageId },
      select: { id: true, sequence: true },
    });
  }

  // =========================================================================
  // routes and stages (read-only master data)
  // =========================================================================

  /**
   * The configured stages, in route order.
   *
   * The scan station needs this to let an operator say where they are
   * standing, which is what narrows a scan to the one action that makes sense
   * there.
   */
  async listStages(organizationId: string) {
    const stages = await this.prisma.productionStage.findMany({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: { sequenceHint: 'asc' },
      select: {
        id: true, code: true, name: true, sequenceHint: true,
        consumesMaterial: true, allowsJobWork: true, requiresQc: true,
        defaultLocation: { select: { id: true, code: true, name: true } },
      },
    });
    return { data: stages, page: 1, pageSize: stages.length, total: stages.length, totalPages: 1 };
  }

  /**
   * Create or update a stage.
   *
   * Stages are master data that route steps and BOM lines point at, so the
   * code is the stable identity and an existing one is updated rather than
   * duplicated.
   */
  async upsertStage(organizationId: string, actorUserId: string, body: UpsertStageRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const existing = await tx.productionStage.findFirst({
        where: { organizationId, code: body.code },
        select: { id: true },
      });

      const data = {
        name: body.name,
        sequenceHint: body.sequenceHint,
        defaultLocationId: body.defaultLocationId ?? null,
        consumesMaterial: body.consumesMaterial,
        allowsJobWork: body.allowsJobWork,
        requiresQc: body.requiresQc,
        serialisesUnits: body.serialisesUnits,
      };

      const stage = existing
        ? await tx.productionStage.update({ where: { id: existing.id }, data, select: { id: true, code: true } })
        : await tx.productionStage.create({
            data: { organizationId, code: body.code, ...data },
            select: { id: true, code: true },
          });

      await this.audit.record(
        {
          organizationId, actorUserId, action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'ProductionStage', entityId: stage.id,
          context: { code: stage.code, name: body.name },
        },
        tx,
      );
      return stage;
    });
  }

  /**
   * Create or update a route.
   *
   * Steps are replaced wholesale, because a route's meaning IS the sequence.
   * Existing batches keep the steps they were created with — their tasks were
   * written at batch creation and are not touched here, so changing a route
   * cannot reorder work already on the floor.
   */
  async upsertRoute(organizationId: string, actorUserId: string, body: UpsertRouteRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const stages = await tx.productionStage.findMany({
        where: { id: { in: body.steps.map((s) => s.productionStageId) }, organizationId },
        select: { id: true },
      });
      if (stages.length !== body.steps.length) {
        const found = new Set(stages.map((s) => s.id));
        throw new BadRequestException({
          code: 'STAGE_NOT_FOUND',
          message: 'One or more steps name a stage that does not exist',
          details: { missingIds: body.steps.map((s) => s.productionStageId).filter((id) => !found.has(id)) },
        });
      }

      const existing = await tx.productionRoute.findFirst({
        where: { organizationId, code: body.code },
        select: { id: true },
      });

      // Exactly one default, so "the route for a style with none of its own"
      // always resolves.
      if (body.isDefault) {
        await tx.productionRoute.updateMany({
          where: { organizationId, isDefault: true, ...(existing ? { id: { not: existing.id } } : {}) },
          data: { isDefault: false },
        });
      }

      const routeId = existing
        ? (await tx.productionRoute.update({
            where: { id: existing.id },
            data: { name: body.name, description: body.description ?? null, isDefault: body.isDefault },
            select: { id: true },
          })).id
        : (await tx.productionRoute.create({
            data: {
              organizationId, code: body.code, name: body.name,
              description: body.description ?? null, isDefault: body.isDefault,
            },
            select: { id: true },
          })).id;

      if (existing) {
        // Steps already carrying batch tasks cannot be removed: the task rows
        // reference them, and a batch mid-route must keep its own history.
        const inUse = await tx.productionRouteStep.findMany({
          where: { routeId, stageTasks: { some: {} } },
          select: { id: true, sequence: true, productionStage: { select: { code: true } } },
        });
        const keeping = new Set(
          body.steps.map((s) => inUse.find((u) => u.sequence === s.sequence)?.id).filter(Boolean) as string[],
        );
        const orphaned = inUse.filter((u) => !keeping.has(u.id));
        if (orphaned.length > 0) {
          throw new ConflictException({
            code: 'ROUTE_STEP_IN_USE',
            message:
              'Some steps are carrying batches that are part-way through the route. Finish or cancel those batches before removing their steps.',
            details: {
              steps: orphaned.map((o) => ({ sequence: o.sequence, stageCode: o.productionStage.code })),
            },
          });
        }
        await tx.productionRouteStep.deleteMany({ where: { routeId } });
      }

      for (const step of body.steps) {
        await tx.productionRouteStep.create({
          data: {
            routeId,
            productionStageId: step.productionStageId,
            sequence: step.sequence,
            isOptional: step.isOptional,
            standardMinutes: step.standardMinutes ? new Prisma.Decimal(step.standardMinutes) : null,
            slaHours: step.slaHours ? new Prisma.Decimal(step.slaHours) : null,
            defaultJobWorkerId: step.defaultJobWorkerId ?? null,
          },
        });
      }

      await this.audit.record(
        {
          organizationId, actorUserId, action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'ProductionRoute', entityId: routeId,
          context: { code: body.code, name: body.name, stepCount: body.steps.length, isDefault: body.isDefault },
        },
        tx,
      );

      return tx.productionRoute.findUniqueOrThrow({
        where: { id: routeId },
        include: {
          steps: {
            orderBy: { sequence: 'asc' },
            include: { productionStage: { select: { id: true, code: true, name: true } } },
          },
        },
      });
    });
  }

  async listRoutes(organizationId: string) {
    const routes = await this.prisma.productionRoute.findMany({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      include: {
        steps: {
          orderBy: { sequence: 'asc' },
          include: { productionStage: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    return { data: routes, page: 1, pageSize: routes.length, total: routes.length, totalPages: 1 };
  }

  // =========================================================================
  // internals
  // =========================================================================

  /**
   * Apply a plan from the domain: lock, write deltas, record the movement,
   * re-assert consistency.
   *
   * This is the only place stage counters change. Everything else — scans,
   * stage outcomes, rework — funnels through here, which is what makes "no
   * quantity moves without a stage movement row" structural rather than a
   * convention someone can forget.
   */
  private async applyPlan(
    tx: Prisma.TransactionClient,
    organizationId: string,
    batch: LoadedBatch,
    plan: StageTransitionPlan,
    meta: {
      actorUserId: string;
      fromStageTaskId: string | null;
      toStageTaskId: string | null;
      scanEventId?: string;
      remarks?: string | null;
      movementKey: string;
    },
  ): Promise<void> {
    for (const delta of plan.deltas) {
      await tx.productionStageTask.update({
        where: { id: delta.stageTaskId },
        data: {
          ...(delta.receivedQtyDelta ? { receivedQty: { increment: this.d(delta.receivedQtyDelta) } } : {}),
          ...(delta.completedQtyDelta ? { completedQty: { increment: this.d(delta.completedQtyDelta) } } : {}),
          ...(delta.rejectedQtyDelta ? { rejectedQty: { increment: this.d(delta.rejectedQtyDelta) } } : {}),
          ...(delta.reworkSentQtyDelta ? { reworkSentQty: { increment: this.d(delta.reworkSentQtyDelta) } } : {}),
          ...(delta.reworkReturnedQtyDelta
            ? { reworkReturnedQty: { increment: this.d(delta.reworkReturnedQtyDelta) } }
            : {}),
          ...(delta.forwardedQtyDelta ? { forwardedQty: { increment: this.d(delta.forwardedQtyDelta) } } : {}),
          version: { increment: 1 },
          startedAt: batch.stageTasks.find((t) => t.id === delta.stageTaskId)?.startedAt ?? new Date(),
        },
      });
    }

    const b = plan.batchDelta;
    if (b.releasedQtyDelta || b.finishedQtyDelta || b.rejectedQtyDelta) {
      await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          ...(b.releasedQtyDelta ? { releasedQty: { increment: this.d(b.releasedQtyDelta) } } : {}),
          ...(b.finishedQtyDelta ? { finishedQty: { increment: this.d(b.finishedQtyDelta) } } : {}),
          ...(b.rejectedQtyDelta ? { rejectedQty: { increment: this.d(b.rejectedQtyDelta) } } : {}),
          ...(b.releasedQtyDelta ? { startedAt: batch.startedAt ?? new Date() } : {}),
        },
      });
    }

    await tx.productionStageMovement.create({
      data: {
        organizationId,
        productionBatchId: batch.id,
        movementType: plan.movementType,
        qty: this.d(plan.qty),
        fromStageTaskId: meta.fromStageTaskId,
        toStageTaskId: meta.toStageTaskId,
        barcodeScanEventId: meta.scanEventId ?? null,
        operatorUserId: meta.actorUserId,
        remarks: meta.remarks ?? null,
        // The movement row carries its own key so the append-only trail is
        // protected even if the request-level record were bypassed.
        idempotencyKey: meta.movementKey,
      },
    });

    await this.refreshStatuses(tx, batch.id);

    // Re-read and re-assert: the database CHECK constraints cover each row, the
    // domain covers the relationships between them.
    const after = await tx.productionBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { stageTasks: { orderBy: { sequence: 'asc' }, include: TASK_INCLUDE } },
    });
    for (const task of after.stageTasks) assertStageTaskConsistent(this.toTaskState(task));
    assertRouteChainConsistent(
      after.stageTasks.map((t) => this.toTaskState(t)),
      this.toBatchState(after as unknown as LoadedBatch),
    );
  }

  /** Derive task and batch status from the counters rather than tracking them. */
  private async refreshStatuses(tx: Prisma.TransactionClient, batchId: string): Promise<void> {
    const batch = await tx.productionBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { stageTasks: { orderBy: { sequence: 'asc' } } },
    });

    for (const task of batch.stageTasks) {
      const state = this.toTaskState(task);
      const received = qty(task.receivedQty.toFixed());
      const wip = wipAtStage(state);
      const forwarded = qty(task.forwardedQty.toFixed());
      const completed = qty(task.completedQty.toFixed());

      const status =
        received.lessThanOrEqualTo(0)
          ? 'NOT_STARTED'
          : wip.greaterThan(0) || forwarded.lessThan(completed)
            ? 'IN_PROGRESS'
            : 'COMPLETED';

      if (status !== task.status) {
        await tx.productionStageTask.update({
          where: { id: task.id },
          data: {
            status,
            ...(status === 'COMPLETED' ? { completedAt: task.completedAt ?? new Date() } : {}),
          },
        });
      }
    }

    const planned = qty(batch.plannedQty.toFixed());
    const finished = qty(batch.finishedQty.toFixed());
    const rejected = qty(batch.rejectedQty.toFixed());
    const accounted = finished.plus(rejected);

    const batchStatus =
      qty(batch.releasedQty.toFixed()).lessThanOrEqualTo(0)
        ? 'OPEN'
        : accounted.greaterThanOrEqualTo(planned)
          ? 'COMPLETED'
          : 'IN_PROGRESS';

    if (batchStatus !== batch.status) {
      await tx.productionBatch.update({
        where: { id: batchId },
        data: {
          status: batchStatus,
          ...(batchStatus === 'COMPLETED' ? { completedAt: batch.completedAt ?? new Date() } : {}),
        },
      });
    }
  }

  /**
   * Lock the stage tasks of a batch before reading their counters.
   *
   * `FOR UPDATE` is not expressible through the Prisma query API. Ordering by
   * sequence makes two concurrent transitions on the same batch queue rather
   * than deadlock.
   */
  private async lockBatchTasks(tx: Prisma.TransactionClient, batchId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM "production_stage_tasks"
      WHERE "productionBatchId" = ${batchId}::uuid
      ORDER BY "sequence"
      FOR UPDATE
    `;
  }

  private async loadBatchForWrite(
    tx: Prisma.TransactionClient,
    organizationId: string,
    batchId: string,
  ): Promise<LoadedBatch> {
    await this.lockBatchTasks(tx, batchId);
    const batch = await tx.productionBatch.findFirst({
      where: { id: batchId, organizationId },
      include: BATCH_INCLUDE,
    });
    if (!batch) throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });
    return batch;
  }

  private async loadTaskForWrite(
    tx: Prisma.TransactionClient,
    organizationId: string,
    stageTaskId: string,
  ): Promise<{ batch: LoadedBatch; task: LoadedTask }> {
    const stub = await tx.productionStageTask.findFirst({
      where: { id: stageTaskId, organizationId },
      select: { productionBatchId: true },
    });
    if (!stub) {
      throw new NotFoundException({ code: 'STAGE_TASK_NOT_FOUND', message: 'Route step not found' });
    }
    const batch = await this.loadBatchForWrite(tx, organizationId, stub.productionBatchId);
    const task = batch.stageTasks.find((t) => t.id === stageTaskId)!;
    return { batch, task };
  }

  private async presentBatch(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    batchId: string,
  ) {
    const batch = await client.productionBatch.findFirstOrThrow({
      where: { id: batchId, organizationId },
      include: BATCH_INCLUDE,
    });
    return this.decorateBatch(batch);
  }

  /** Attach the derived figures, all computed by the domain. */
  private decorateBatch(batch: LoadedBatch) {
    const tasks = batch.stageTasks.map((t) => this.toTaskState(t));
    const progress = computeBatchProgress(this.toBatchState(batch), tasks);

    return {
      ...batch,
      stageTasks: batch.stageTasks.map((t) => {
        const state = this.toTaskState(t);
        return {
          ...t,
          wipQty: wipAtStage(state).toFixed(4),
          availableToForwardQty: availableToForward(state).toFixed(4),
          reworkOutstandingQty: reworkOutstanding(state).toFixed(4),
        };
      }),
      progress: {
        // Deliberately NOT a sum across stages: cutting 100, stitching 85 and
        // finishing 60 means 60 garments exist, not 245.
        plannedQty: progress.plannedQty.toFixed(4),
        releasedQty: progress.releasedQty.toFixed(4),
        finishedQty: progress.finishedQty.toFixed(4),
        rejectedQty: progress.totalRejectedQty.toFixed(4),
        inProgressQty: progress.totalWipQty.toFixed(4),
        reworkOutstandingQty: progress.totalReworkOutstandingQty.toFixed(4),
        // Completion is finished garments over planned — the route's endpoint,
        // never a sum of stage counters.
        completionPct: progress.plannedQty.greaterThan(0)
          ? progress.finishedQty.dividedBy(progress.plannedQty).times(100).toDecimalPlaces(2).toFixed(2)
          : '0.00',
        currentStageCode: progress.currentStageCode ?? null,
        stages: progress.stages.map((s) => ({
          stageTaskId: s.stageTaskId,
          sequence: s.sequence,
          stageCode: s.stageCode ?? null,
          receivedQty: s.receivedQty.toFixed(4),
          completedQty: s.completedQty.toFixed(4),
          rejectedQty: s.rejectedQty.toFixed(4),
          wipQty: s.wipQty.toFixed(4),
          availableToForwardQty: s.availableToForwardQty.toFixed(4),
          pendingQty: s.pendingQty.toFixed(4),
          reworkOutstandingQty: s.reworkOutstandingQty.toFixed(4),
        })),
      },
    };
  }

  private toTaskState(t: {
    id: string; sequence: number; productionStageId: string;
    receivedQty: Prisma.Decimal; completedQty: Prisma.Decimal; rejectedQty: Prisma.Decimal;
    reworkSentQty: Prisma.Decimal; reworkReturnedQty: Prisma.Decimal; forwardedQty: Prisma.Decimal;
    productionStage?: { code: string };
  }): StageTaskState {
    return {
      id: t.id,
      sequence: t.sequence,
      productionStageId: t.productionStageId,
      stageCode: t.productionStage?.code,
      receivedQty: t.receivedQty.toFixed(),
      completedQty: t.completedQty.toFixed(),
      rejectedQty: t.rejectedQty.toFixed(),
      reworkSentQty: t.reworkSentQty.toFixed(),
      reworkReturnedQty: t.reworkReturnedQty.toFixed(),
      forwardedQty: t.forwardedQty.toFixed(),
    };
  }

  private toBatchState(b: {
    id: string; batchNo: string;
    plannedQty: Prisma.Decimal; releasedQty: Prisma.Decimal; finishedQty: Prisma.Decimal;
    rejectedQty: Prisma.Decimal; qcPassedQty: Prisma.Decimal; inwardedQty: Prisma.Decimal;
  }): BatchState {
    return {
      id: b.id,
      batchNo: b.batchNo,
      plannedQty: b.plannedQty.toFixed(),
      releasedQty: b.releasedQty.toFixed(),
      finishedQty: b.finishedQty.toFixed(),
      rejectedQty: b.rejectedQty.toFixed(),
      qcPassedQty: b.qcPassedQty.toFixed(),
      inwardedQty: b.inwardedQty.toFixed(),
    };
  }

  private d(v: Decimal): Prisma.Decimal {
    return new Prisma.Decimal(v.toFixed(4));
  }
}
