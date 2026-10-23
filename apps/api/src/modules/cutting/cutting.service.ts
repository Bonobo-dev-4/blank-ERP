import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal, qty } from '@dnd/domain';
import type {
  CompleteCuttingRequest, CreateCuttingOrderRequest, CreateJobWorkOrderRequest,
  IssueFabricRequest, ReceiveJobWorkRequest, SerialiseBatchRequest,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { paginated } from '../../common/pagination';
import { InventoryService } from '../inventory/inventory.service';
import { ProductionService } from '../production/production.service';

/**
 * Cutting, job work and unit serialisation.
 *
 * The rule that shapes the cutting module is the specification's central
 * failure mode: **the same material deducted twice as it moves between
 * stages.** So issuing fabric to the cutting table is a *transfer* — the
 * owned quantity is unchanged, it has simply moved to the cutting department.
 * Only completing the cut retires it, and that may happen exactly once per
 * cutting order.
 *
 * Nothing here writes a stock balance or a stage counter. Stock goes through
 * `InventoryService`, stage quantities through `ProductionService`. One
 * writer each.
 */
@Injectable()
export class CuttingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly production: ProductionService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // =========================================================================
  // cutting orders
  // =========================================================================

  async createCuttingOrder(organizationId: string, actorUserId: string, body: CreateCuttingOrderRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'cutting.create',
        key: body.idempotencyKey,
        payload: body,
        entityType: 'CuttingOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const batch = await tx.productionBatch.findFirst({
            where: { id: body.productionBatchId, organizationId },
            select: {
              id: true, batchNo: true, manufacturingOrderId: true, plannedQty: true,
              manufacturingOrder: { select: { moNo: true } },
            },
          });
          if (!batch) {
            throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });
          }

          const planned = qty(body.plannedPieces);
          const breakdownTotal = body.sizeBreakdown.reduce<Decimal>(
            (acc, s) => acc.plus(qty(s.plannedPieces)),
            new Decimal(0),
          );
          if (!qty(breakdownTotal).equals(planned)) {
            throw new BadRequestException({
              code: 'SIZE_BREAKDOWN_MISMATCH',
              message: 'The size breakdown must add up to exactly the pieces planned',
              details: { plannedPieces: planned.toFixed(4), breakdownTotal: qty(breakdownTotal).toFixed(4) },
            });
          }
          if (planned.greaterThan(qty(batch.plannedQty.toFixed()))) {
            throw new ConflictException({
              code: 'CUT_EXCEEDS_BATCH',
              message: 'Cannot plan to cut more pieces than the batch holds',
              details: {
                plannedPieces: planned.toFixed(4),
                batchPlannedQty: qty(batch.plannedQty.toFixed()).toFixed(4),
              },
            });
          }

          const material = await tx.rawMaterial.findFirst({
            where: { id: body.fabricMaterialId, organizationId },
            select: { id: true, materialCode: true, category: true },
          });
          if (!material) {
            throw new NotFoundException({ code: 'RAW_MATERIAL_NOT_FOUND', message: 'Fabric not found' });
          }

          const cuttingOrderNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.CUTTING_ORDER);
          const created = await tx.cuttingOrder.create({
            data: {
              organizationId,
              cuttingOrderNo,
              manufacturingOrderId: batch.manufacturingOrderId,
              productionBatchId: batch.id,
              fabricMaterialId: material.id,
              sizeBreakdown: body.sizeBreakdown as unknown as Prisma.InputJsonValue,
              plannedPieces: new Prisma.Decimal(planned.toFixed(4)),
              status: 'PLANNED',
              operatorUserId: actorUserId,
              remarks: body.remarks ?? null,
            },
            select: { id: true, cuttingOrderNo: true },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'CREATE',
              entityType: 'CuttingOrder', entityId: created.id,
              context: {
                cuttingOrderNo, batchNo: batch.batchNo, moNo: batch.manufacturingOrder.moNo,
                fabric: material.materialCode, plannedPieces: planned.toFixed(4),
              },
            },
            tx,
          );

          return { result: await this.presentCuttingOrder(tx, organizationId, created.id), entityId: created.id };
        }),
    );
    return result;
  }

  /**
   * Issue fabric to the cutting department.
   *
   * A transfer, not a consumption. `InventoryService.issue` posts the ledger
   * movement; this only records that it was for this cutting order and tracks
   * how much the table is holding.
   */
  async issueFabric(organizationId: string, actorUserId: string, id: string, body: IssueFabricRequest) {
    const order = await this.prisma.cuttingOrder.findFirst({
      where: { id, organizationId },
      select: {
        id: true, cuttingOrderNo: true, status: true, manufacturingOrderId: true,
        productionBatchId: true, consumptionPostedAt: true,
      },
    });
    if (!order) throw new NotFoundException({ code: 'CUTTING_ORDER_NOT_FOUND', message: 'Cutting order not found' });
    if (order.consumptionPostedAt) {
      throw new ConflictException({
        code: 'CUTTING_ORDER_COMPLETED',
        message: `Cutting order ${order.cuttingOrderNo} is complete; its fabric has already been consumed`,
      });
    }

    // The cutting department is where the fabric physically goes.
    const destination = await this.cuttingLocation(organizationId);
    const stageTask = order.productionBatchId
      ? await this.cuttingStageTask(organizationId, order.productionBatchId)
      : null;

    const issued = await this.inventory.issue(organizationId, actorUserId, {
      idempotencyKey: body.idempotencyKey,
      manufacturingOrderId: order.manufacturingOrderId,
      stageTaskId: stageTask?.id ?? null,
      jobWorkOrderId: null,
      sourceLocationId: body.sourceLocationId,
      destinationLocationId: destination.id,
      issueType: 'PRODUCTION',
      lines: body.lines.map((l) => ({
        rawMaterialId: l.rawMaterialId,
        materialLotId: l.materialLotId,
        fabricRollId: l.fabricRollId ?? null,
        quantity: l.quantity,
        uom: l.uom,
      })),
      remarks: body.remarks ?? `Issued to cutting order ${order.cuttingOrderNo}`,
    });

    const totalIssued = body.lines.reduce<Decimal>((acc, l) => acc.plus(qty(l.quantity)), new Decimal(0));

    await this.prisma.cuttingOrder.update({
      where: { id },
      data: {
        fabricIssuedBaseQty: { increment: new Prisma.Decimal(qty(totalIssued).toFixed(4)) },
        status: order.status === 'PLANNED' ? 'FABRIC_ISSUED' : order.status,
        startedAt: new Date(),
        // Remember which lot and roll the table is working from, so the cut
        // can be traced back to the fabric it came off.
        fabricLotId: body.lines[0]?.materialLotId ?? null,
        fabricRollId: body.lines[0]?.fabricRollId ?? null,
      },
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'POST',
      entityType: 'CuttingOrder', entityId: id,
      context: {
        cuttingOrderNo: order.cuttingOrderNo,
        issuedQty: qty(totalIssued).toFixed(4),
        lineCount: body.lines.length,
      },
    });

    return {
      cuttingOrder: await this.presentCuttingOrder(this.prisma, organizationId, id),
      issue: issued.result,
    };
  }

  /**
   * Complete the cut.
   *
   * THE operation that retires fabric, and it may happen exactly once.
   * `consumptionPostedAt` is checked inside the transaction and set in the
   * same one, so completing twice cannot deduct fabric twice — which is the
   * risk the roadmap names for this module.
   */
  async completeCutting(organizationId: string, actorUserId: string, id: string, body: CompleteCuttingRequest) {
    const order = await this.prisma.cuttingOrder.findFirst({
      where: { id, organizationId },
      select: {
        id: true, cuttingOrderNo: true, status: true, manufacturingOrderId: true,
        productionBatchId: true, consumptionPostedAt: true, plannedPieces: true,
        fabricIssuedBaseQty: true, sizeBreakdown: true,
      },
    });
    if (!order) throw new NotFoundException({ code: 'CUTTING_ORDER_NOT_FOUND', message: 'Cutting order not found' });

    // Cheap pre-check for a clear error; the authoritative guard is the
    // conditional update inside the transaction below.
    if (order.consumptionPostedAt) {
      throw new ConflictException({
        code: 'CONSUMPTION_ALREADY_POSTED',
        message: `Cutting order ${order.cuttingOrderNo} already posted its fabric consumption on ${order.consumptionPostedAt.toISOString()}. Completing it again would deduct the fabric twice.`,
        details: { consumptionPostedAt: order.consumptionPostedAt.toISOString() },
      });
    }

    const consumedTotal = body.consumption.reduce<Decimal>(
      (acc, c) => acc.plus(qty(c.consumedQty)).plus(qty(c.wastageQty)),
      new Decimal(0),
    );
    const returnedTotal = body.returns.reduce<Decimal>((acc, r) => acc.plus(qty(r.quantity)), new Decimal(0));
    const issued = qty(order.fabricIssuedBaseQty.toFixed());

    // A cutting table cannot consume fabric it was never given.
    if (qty(consumedTotal).plus(returnedTotal).greaterThan(issued)) {
      throw new ConflictException({
        code: 'CONSUMPTION_EXCEEDS_ISSUED',
        message: 'Consumed, wasted and returned fabric together exceed what was issued to cutting',
        details: {
          issuedQty: issued.toFixed(4),
          consumedAndWastedQty: qty(consumedTotal).toFixed(4),
          returnedQty: qty(returnedTotal).toFixed(4),
        },
      });
    }

    const cut = qty(body.actualPiecesCut);
    const rejected = qty(body.rejectedPieces);
    if (rejected.greaterThan(0) && !body.rejectionReason) {
      throw new BadRequestException({
        code: 'REJECTION_REASON_REQUIRED',
        message: 'Rejected pieces need a reason',
      });
    }

    const cuttingLocation = await this.cuttingLocation(organizationId);

    // Check the route can accept this outcome BEFORE any fabric moves.
    //
    // Consumption and the stage outcome cannot share one transaction, because
    // each owns its own idempotency record. So the order matters: validating
    // first means a route that cannot accept the pieces fails with nothing
    // deducted, rather than leaving the fabric gone and the cut unrecorded.
    const stageTask = order.productionBatchId
      ? await this.cuttingStageTask(organizationId, order.productionBatchId)
      : null;

    if (stageTask && cut.plus(rejected).greaterThan(0)) {
      const current = await this.prisma.productionStageTask.findUniqueOrThrow({
        where: { id: stageTask.id },
        select: {
          receivedQty: true, completedQty: true, rejectedQty: true,
          reworkSentQty: true, reworkReturnedQty: true,
          productionStage: { select: { name: true } },
        },
      });
      const wip = qty(current.receivedQty.toFixed())
        .minus(qty(current.completedQty.toFixed()))
        .minus(qty(current.rejectedQty.toFixed()))
        .minus(
          Decimal.max(
            qty(current.reworkSentQty.toFixed()).minus(qty(current.reworkReturnedQty.toFixed())),
            0,
          ),
        );

      if (cut.plus(rejected).greaterThan(wip)) {
        throw new ConflictException({
          code: 'CUT_EXCEEDS_STAGE_WIP',
          message:
            `${current.productionStage.name} is only holding ${Decimal.max(wip, 0).toFixed(4)} pieces. ` +
            'Release the batch into the route and walk it to cutting before recording what the table produced. No fabric has been deducted.',
          details: {
            stageTaskId: stageTask.id,
            submittedQty: cut.plus(rejected).toFixed(4),
            wipQty: Decimal.max(wip, 0).toFixed(4),
          },
        });
      }
    }

    // Claim the completion, in its own transaction. If a concurrent request
    // already claimed it, this updates zero rows and we stop — before any
    // stock has moved.
    const claimed = await this.prisma.cuttingOrder.updateMany({
      where: { id, organizationId, consumptionPostedAt: null },
      data: { consumptionPostedAt: new Date(), status: 'COMPLETED' },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'CONSUMPTION_ALREADY_POSTED',
        message: `Cutting order ${order.cuttingOrderNo} was completed by another request. Fabric is deducted exactly once.`,
      });
    }

    // Once this flips true the fabric has physically left the ledger, and the
    // completion claim must NEVER be released again: re-running would deduct
    // it a second time, which is the one thing this module exists to prevent.
    let fabricDeducted = false;

    try {
      const consumed = await this.inventory.consume(organizationId, actorUserId, {
        idempotencyKey: `${body.idempotencyKey}:consume`,
        manufacturingOrderId: order.manufacturingOrderId,
        productionBatchId: order.productionBatchId,
        stageTaskId: order.productionBatchId
          ? (await this.cuttingStageTask(organizationId, order.productionBatchId))?.id ?? null
          : null,
        sourceLocationId: cuttingLocation.id,
        lines: body.consumption.map((c) => ({
          rawMaterialId: c.rawMaterialId,
          materialLotId: c.materialLotId,
          fabricRollId: c.fabricRollId ?? null,
          consumedQty: c.consumedQty,
          wastageQty: c.wastageQty,
          uom: c.uom,
          materialIssueLineId: null,
        })),
        remarks: body.remarks ?? `Cutting order ${order.cuttingOrderNo}`,
      });
      fabricDeducted = true;

      // Unused fabric goes back to the warehouse — a return, not a consumption.
      if (body.returns.length > 0) {
        const warehouse = await this.prisma.materialLocation.findFirstOrThrow({
          where: { organizationId, code: 'RM-WH' },
          select: { id: true },
        });
        await this.inventory.returnMaterial(organizationId, actorUserId, {
          idempotencyKey: `${body.idempotencyKey}:return`,
          materialIssueId: null,
          sourceLocationId: cuttingLocation.id,
          destinationLocationId: warehouse.id,
          lines: body.returns.map((r) => ({
            rawMaterialId: r.rawMaterialId,
            materialLotId: r.materialLotId,
            fabricRollId: r.fabricRollId ?? null,
            quantity: r.quantity,
            uom: r.uom,
            materialIssueLineId: null,
          })),
          reason: 'Unused after cutting',
          remarks: `Cutting order ${order.cuttingOrderNo}`,
        });
      }

      const consumedOnly = body.consumption.reduce<Decimal>((a, c) => a.plus(qty(c.consumedQty)), new Decimal(0));
      const wastedOnly = body.consumption.reduce<Decimal>((a, c) => a.plus(qty(c.wastageQty)), new Decimal(0));

      await this.prisma.cuttingOrder.update({
        where: { id },
        data: {
          actualPiecesCut: new Prisma.Decimal(cut.toFixed(4)),
          rejectedPieces: new Prisma.Decimal(rejected.toFixed(4)),
          fabricUsedBaseQty: new Prisma.Decimal(qty(consumedOnly).toFixed(4)),
          fabricWastageBaseQty: new Prisma.Decimal(qty(wastedOnly).toFixed(4)),
          fabricReturnedBaseQty: new Prisma.Decimal(qty(returnedTotal).toFixed(4)),
          completedAt: new Date(),
          remarks: body.remarks ?? undefined,
          ...(body.sizeActuals.length > 0
            ? { sizeBreakdown: this.mergeSizeActuals(order.sizeBreakdown, body.sizeActuals) }
            : {}),
        },
      });

      // Tell the route what the table produced.
      if (stageTask && cut.plus(rejected).greaterThan(0)) {
        {
          await this.prisma.inTransaction(async (tx) => {
            await this.production.applyStageOutcomeWithin(
              tx, organizationId, stageTask.id,
              { completedQty: cut.toFixed(4), rejectedQty: rejected.toFixed(4) },
              {
                actorUserId,
                movementKey: `${body.idempotencyKey}:cut-outcome`,
                remarks: body.rejectionReason ?? `Cutting order ${order.cuttingOrderNo}`,
              },
            );
          });
        }
      }

      await this.audit.record({
        organizationId, actorUserId, action: 'POST',
        entityType: 'CuttingOrder', entityId: id,
        context: {
          cuttingOrderNo: order.cuttingOrderNo,
          actualPiecesCut: cut.toFixed(4),
          rejectedPieces: rejected.toFixed(4),
          fabricUsed: qty(consumedOnly).toFixed(4),
          fabricWasted: qty(wastedOnly).toFixed(4),
          fabricReturned: qty(returnedTotal).toFixed(4),
        },
      });

      return {
        cuttingOrder: await this.presentCuttingOrder(this.prisma, organizationId, id),
        consumption: consumed.result,
      };
    } catch (error) {
      if (!fabricDeducted) {
        // Nothing left the ledger, so the operator can correct the figures and
        // try again. Without this a bad line would lock the cutting order shut
        // with its fabric still on the table.
        await this.prisma.cuttingOrder.updateMany({
          where: { id, organizationId },
          data: { consumptionPostedAt: null, status: 'IN_PROGRESS' },
        });
      }
      // If the fabric HAS gone, the claim stands. The cut is recorded as
      // posted and the error surfaces, because the alternative — reopening it
      // — invites a second deduction of fabric that is already consumed.
      throw error;
    }
  }

  async listCuttingOrders(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      manufacturingOrderId?: string; productionBatchId?: string; status?: string;
    },
  ) {
    const where: Prisma.CuttingOrderWhereInput = {
      organizationId,
      ...(query.manufacturingOrderId ? { manufacturingOrderId: query.manufacturingOrderId } : {}),
      ...(query.productionBatchId ? { productionBatchId: query.productionBatchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { cuttingOrderNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.cuttingOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          manufacturingOrder: { select: { id: true, moNo: true } },
          productionBatch: { select: { id: true, batchNo: true } },
          fabricLot: { select: { id: true, lotCode: true, shade: true } },
          fabricRoll: { select: { id: true, rollNo: true } },
        },
      }),
      this.prisma.cuttingOrder.count({ where }),
    ]);

    return paginated(rows.map((r) => this.decorateCuttingOrder(r)), total, query);
  }

  async getCuttingOrder(organizationId: string, id: string) {
    return this.presentCuttingOrder(this.prisma, organizationId, id);
  }

  // =========================================================================
  // job work
  // =========================================================================

  async createJobWorkOrder(organizationId: string, actorUserId: string, body: CreateJobWorkOrderRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId, scope: 'jobwork.create', key: body.idempotencyKey,
        payload: body, entityType: 'JobWorkOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const [worker, stage, order] = await Promise.all([
            tx.jobWorker.findFirst({
              where: { id: body.jobWorkerId, organizationId },
              select: { id: true, code: true, name: true, defaultRate: true, status: true },
            }),
            tx.productionStage.findFirst({
              where: { id: body.productionStageId, organizationId },
              select: { id: true, code: true, name: true, allowsJobWork: true },
            }),
            tx.manufacturingOrder.findFirst({
              where: { id: body.manufacturingOrderId, organizationId },
              select: { id: true, moNo: true },
            }),
          ]);

          if (!worker) throw new NotFoundException({ code: 'JOB_WORKER_NOT_FOUND', message: 'Job worker not found' });
          if (!order) {
            throw new NotFoundException({ code: 'MANUFACTURING_ORDER_NOT_FOUND', message: 'Manufacturing order not found' });
          }
          if (!stage) throw new NotFoundException({ code: 'STAGE_NOT_FOUND', message: 'Production stage not found' });
          if (!stage.allowsJobWork) {
            throw new BadRequestException({
              code: 'STAGE_DOES_NOT_ALLOW_JOB_WORK',
              message: `${stage.name} is not configured to be done by a job worker`,
              details: { stageCode: stage.code },
            });
          }
          if (worker.status !== 'ACTIVE') {
            throw new ConflictException({
              code: 'JOB_WORKER_INACTIVE',
              message: `${worker.name} is ${worker.status}`,
            });
          }

          // Every batch must be on this order and have work at that stage.
          const batches = await tx.productionBatch.findMany({
            where: {
              id: { in: body.lines.map((l) => l.productionBatchId) },
              organizationId,
              manufacturingOrderId: order.id,
            },
            select: { id: true, batchNo: true },
          });
          if (batches.length !== body.lines.length) {
            const found = new Set(batches.map((b) => b.id));
            throw new BadRequestException({
              code: 'BATCH_NOT_IN_ORDER',
              message: 'One or more batches do not belong to this manufacturing order',
              details: {
                missingIds: body.lines.map((l) => l.productionBatchId).filter((bid) => !found.has(bid)),
              },
            });
          }

          const rate = qty(body.ratePerPiece).greaterThan(0)
            ? qty(body.ratePerPiece)
            : qty(worker.defaultRate?.toFixed() ?? '0');
          const assigned = body.lines.reduce<Decimal>((a, l) => a.plus(qty(l.assignedQty)), new Decimal(0));

          const jobWorkOrderNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.JOB_WORK_ORDER);
          const created = await tx.jobWorkOrder.create({
            data: {
              organizationId,
              jobWorkOrderNo,
              manufacturingOrderId: order.id,
              jobWorkerId: worker.id,
              productionStageId: stage.id,
              status: 'ISSUED',
              assignedQty: new Prisma.Decimal(qty(assigned).toFixed(4)),
              ratePerPiece: new Prisma.Decimal(rate.toFixed(6)),
              issueDate: new Date(),
              dueDate: body.dueDate ? new Date(body.dueDate) : null,
              remarks: body.remarks ?? null,
              lines: {
                create: body.lines.map((l) => ({
                  productionBatchId: l.productionBatchId,
                  assignedQty: new Prisma.Decimal(l.assignedQty),
                  ratePerPiece: new Prisma.Decimal(rate.toFixed(6)),
                })),
              },
            },
            select: { id: true, jobWorkOrderNo: true },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'CREATE',
              entityType: 'JobWorkOrder', entityId: created.id,
              context: {
                jobWorkOrderNo, moNo: order.moNo, jobWorker: worker.code,
                stageCode: stage.code, assignedQty: qty(assigned).toFixed(4),
                ratePerPiece: rate.toFixed(6),
              },
            },
            tx,
          );

          return { result: await this.presentJobWork(tx, organizationId, created.id), entityId: created.id };
        }),
    );
    return result;
  }

  /**
   * Receive work back from a job worker.
   *
   * The quantities move the batch's stage counters, and the charge is computed
   * from what came back good — a worker who returns 90 good and 10 rejected is
   * not paid for 100.
   */
  async receiveJobWork(organizationId: string, actorUserId: string, id: string, body: ReceiveJobWorkRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId, scope: 'jobwork.receive', key: body.idempotencyKey,
        payload: { jobWorkOrderId: id, ...body }, entityType: 'JobWorkOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const jwo = await tx.jobWorkOrder.findFirst({
            where: { id, organizationId },
            include: {
              lines: true,
              jobWorker: { select: { code: true, name: true } },
              productionStage: { select: { id: true, code: true, name: true } },
            },
          });
          if (!jwo) throw new NotFoundException({ code: 'JOB_WORK_ORDER_NOT_FOUND', message: 'Job work order not found' });
          if (['CLOSED', 'CANCELLED'].includes(jwo.status)) {
            throw new ConflictException({
              code: 'JOB_WORK_ORDER_CLOSED',
              message: `Job work order ${jwo.jobWorkOrderNo} is ${jwo.status}`,
            });
          }

          const byBatch = new Map(jwo.lines.map((l) => [l.productionBatchId, l]));
          let chargedQty = new Decimal(0);

          for (const line of body.lines) {
            const existing = byBatch.get(line.productionBatchId);
            if (!existing) {
              throw new BadRequestException({
                code: 'BATCH_NOT_ON_JOB_WORK_ORDER',
                message: 'A line names a batch that is not on this job work order',
                details: { productionBatchId: line.productionBatchId },
              });
            }

            const completed = qty(line.completedQty);
            const rejected = qty(line.rejectedQty);
            const rework = qty(line.reworkQty);
            const total = completed.plus(rejected).plus(rework);
            if (total.lessThanOrEqualTo(0)) continue;

            if (rejected.greaterThan(0) && !line.rejectionReason) {
              throw new BadRequestException({
                code: 'REJECTION_REASON_REQUIRED',
                message: 'Rejected pieces need a reason',
                details: { productionBatchId: line.productionBatchId },
              });
            }

            const alreadyReceived = qty(existing.receivedQty.toFixed());
            if (alreadyReceived.plus(total).greaterThan(qty(existing.assignedQty.toFixed()))) {
              throw new ConflictException({
                code: 'RECEIPT_EXCEEDS_ASSIGNED',
                message: 'More pieces than were assigned to the job worker for this batch',
                details: {
                  productionBatchId: line.productionBatchId,
                  assignedQty: qty(existing.assignedQty.toFixed()).toFixed(4),
                  alreadyReceivedQty: alreadyReceived.toFixed(4),
                  submittedQty: total.toFixed(4),
                },
              });
            }

            // Move the route the same way an in-house stage would.
            const stageTask = await this.production.stageTaskFor(
              tx, organizationId, line.productionBatchId, jwo.productionStageId,
            );
            if (stageTask) {
              await this.production.applyStageOutcomeWithin(
                tx, organizationId, stageTask.id,
                {
                  completedQty: completed.toFixed(4),
                  rejectedQty: rejected.toFixed(4),
                  reworkQty: rework.toFixed(4),
                },
                {
                  actorUserId,
                  movementKey: `${body.idempotencyKey}:${line.productionBatchId}`,
                  remarks: line.rejectionReason ?? `${jwo.jobWorkOrderNo} received`,
                },
              );
            }

            const lineRate = qty(existing.ratePerPiece.toFixed());
            await tx.jobWorkOrderLine.update({
              where: { id: existing.id },
              data: {
                receivedQty: { increment: new Prisma.Decimal(total.toFixed(4)) },
                completedQty: { increment: new Prisma.Decimal(completed.toFixed(4)) },
                rejectedQty: { increment: new Prisma.Decimal(rejected.toFixed(4)) },
                reworkQty: { increment: new Prisma.Decimal(rework.toFixed(4)) },
                // Charged on good pieces only.
                lineCharge: {
                  increment: new Prisma.Decimal(completed.times(lineRate).toDecimalPlaces(2).toFixed(2)),
                },
              },
            });
            chargedQty = chargedQty.plus(completed);
          }

          const refreshed = await tx.jobWorkOrderLine.findMany({ where: { jobWorkOrderId: id } });
          const sum = (pick: (l: (typeof refreshed)[number]) => Prisma.Decimal) =>
            refreshed.reduce<Decimal>((a, l) => a.plus(qty(pick(l).toFixed())), new Decimal(0));

          const received = sum((l) => l.receivedQty);
          const assigned = sum((l) => l.assignedQty);
          const charge = refreshed.reduce<Decimal>((a, l) => a.plus(qty(l.lineCharge.toFixed())), new Decimal(0));

          await tx.jobWorkOrder.update({
            where: { id },
            data: {
              receivedQty: new Prisma.Decimal(qty(received).toFixed(4)),
              completedQty: new Prisma.Decimal(qty(sum((l) => l.completedQty)).toFixed(4)),
              rejectedQty: new Prisma.Decimal(qty(sum((l) => l.rejectedQty)).toFixed(4)),
              reworkQty: new Prisma.Decimal(qty(sum((l) => l.reworkQty)).toFixed(4)),
              totalCharge: new Prisma.Decimal(charge.toDecimalPlaces(2).toFixed(2)),
              status: received.greaterThanOrEqualTo(assigned) ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
              completionDate: received.greaterThanOrEqualTo(assigned) ? new Date() : null,
            },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'JobWorkOrder', entityId: id,
              context: {
                jobWorkOrderNo: jwo.jobWorkOrderNo, jobWorker: jwo.jobWorker.code,
                stageCode: jwo.productionStage.code,
                receivedQty: qty(received).toFixed(4), totalCharge: charge.toDecimalPlaces(2).toFixed(2),
              },
            },
            tx,
          );

          return { result: await this.presentJobWork(tx, organizationId, id), entityId: id };
        }),
    );
    return result;
  }

  async listJobWorkOrders(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      manufacturingOrderId?: string; jobWorkerId?: string; productionStageId?: string;
      status?: string; overdueOnly?: boolean;
    },
  ) {
    const where: Prisma.JobWorkOrderWhereInput = {
      organizationId,
      ...(query.manufacturingOrderId ? { manufacturingOrderId: query.manufacturingOrderId } : {}),
      ...(query.jobWorkerId ? { jobWorkerId: query.jobWorkerId } : {}),
      ...(query.productionStageId ? { productionStageId: query.productionStageId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.overdueOnly
        ? { dueDate: { lt: new Date() }, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } }
        : {}),
      ...(query.search ? { jobWorkOrderNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.jobWorkOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          jobWorker: { select: { id: true, code: true, name: true, kind: true } },
          productionStage: { select: { id: true, code: true, name: true } },
          manufacturingOrder: { select: { id: true, moNo: true } },
          lines: { include: { productionBatch: { select: { id: true, batchNo: true } } } },
        },
      }),
      this.prisma.jobWorkOrder.count({ where }),
    ]);

    return paginated(
      rows.map((r) => ({
        ...r,
        pendingQty: Decimal.max(
          qty(r.assignedQty.toFixed()).minus(qty(r.receivedQty.toFixed())),
          0,
        ).toFixed(4),
        isOverdue:
          r.dueDate != null && r.dueDate < new Date() && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(r.status),
      })),
      total,
      query,
    );
  }

  async getJobWorkOrder(organizationId: string, id: string) {
    return this.presentJobWork(this.prisma, organizationId, id);
  }

  async listJobWorkers(organizationId: string) {
    const workers = await this.prisma.jobWorker.findMany({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, kind: true, defaultRate: true,
        capacityPerDay: true, phone: true, rating: true,
      },
    });
    return { data: workers, page: 1, pageSize: workers.length, total: workers.length, totalPages: 1 };
  }

  // =========================================================================
  // unit serialisation
  // =========================================================================

  /**
   * Give each garment in a batch its own barcode.
   *
   * Only worth doing where a single garment has to be traceable on its own.
   * For everything else the batch is the unit, and minting 500 barcodes
   * nobody scans is work the floor will route around.
   */
  async serialiseBatch(organizationId: string, actorUserId: string, batchId: string, body: SerialiseBatchRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId, scope: 'production.serialise', key: body.idempotencyKey,
        payload: { batchId, ...body }, entityType: 'ProductionUnit',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const batch = await tx.productionBatch.findFirst({
            where: { id: batchId, organizationId },
            select: {
              id: true, batchNo: true, plannedQty: true, releasedQty: true, trackingMode: true,
              manufacturingOrder: { select: { moNo: true } },
              _count: { select: { units: true } },
            },
          });
          if (!batch) throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });

          if (batch._count.units > 0) {
            throw new ConflictException({
              code: 'BATCH_ALREADY_SERIALISED',
              message: `${batch.batchNo} already has ${batch._count.units} serialised units`,
              details: { existingUnits: batch._count.units },
            });
          }

          const wanted = body.quantity ? qty(body.quantity) : qty(batch.releasedQty.toFixed());
          if (wanted.lessThanOrEqualTo(0)) {
            throw new BadRequestException({
              code: 'NOTHING_TO_SERIALISE',
              message: 'Release quantity into the route before serialising, or give a quantity explicitly',
            });
          }
          if (wanted.greaterThan(qty(batch.plannedQty.toFixed()))) {
            throw new ConflictException({
              code: 'SERIALISE_EXCEEDS_BATCH',
              message: 'Cannot serialise more garments than the batch holds',
              details: {
                requestedQty: wanted.toFixed(4),
                batchPlannedQty: qty(batch.plannedQty.toFixed()).toFixed(4),
              },
            });
          }

          const count = Number(wanted.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toFixed());
          const units: { serialNo: string }[] = [];

          for (let i = 1; i <= count; i += 1) {
            const serialNo = `${batch.batchNo}-U${String(i).padStart(4, '0')}`;
            const unit = await tx.productionUnit.create({
              data: { organizationId, productionBatchId: batch.id, serialNo, status: 'CREATED' },
              select: { id: true },
            });
            await tx.barcodeIdentifier.create({
              data: {
                organizationId,
                code: serialNo,
                kind: 'PRODUCTION_UNIT',
                productionUnitId: unit.id,
                labelData: { batchNo: batch.batchNo, moNo: batch.manufacturingOrder.moNo, unit: i, of: count },
              },
            });
            units.push({ serialNo });
          }

          await tx.productionBatch.update({ where: { id: batch.id }, data: { trackingMode: 'UNIT' } });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'CREATE',
              entityType: 'ProductionUnit', entityId: batch.id,
              context: { batchNo: batch.batchNo, unitCount: count },
            },
            tx,
          );

          return {
            result: { productionBatchId: batch.id, batchNo: batch.batchNo, unitCount: count, units },
            entityId: batch.id,
          };
        }),
    );
    return result;
  }

  async listUnits(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      productionBatchId?: string; status?: string;
    },
  ) {
    const where: Prisma.ProductionUnitWhereInput = {
      organizationId,
      ...(query.productionBatchId ? { productionBatchId: query.productionBatchId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search ? { serialNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.productionUnit.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { serialNo: 'asc' },
        include: {
          productionBatch: {
            select: {
              id: true, batchNo: true,
              manufacturingOrder: { select: { id: true, moNo: true } },
              manufacturingOrderItem: { select: { size: true, productVariant: { select: { sku: true } } } },
            },
          },
          barcode: { select: { code: true } },
        },
      }),
      this.prisma.productionUnit.count({ where }),
    ]);

    return paginated(rows, total, query);
  }

  // =========================================================================
  // internals
  // =========================================================================

  /** Where fabric physically sits while it is being cut. */
  private async cuttingLocation(organizationId: string) {
    const location = await this.prisma.materialLocation.findFirst({
      where: { organizationId, code: 'DEPT-CUT' },
      select: { id: true, code: true, kind: true },
    });
    if (!location) {
      throw new BadRequestException({
        code: 'CUTTING_LOCATION_NOT_CONFIGURED',
        message:
          'No DEPT-CUT location is configured. Fabric cannot be issued to cutting without a department location to hold it.',
      });
    }
    return location;
  }

  private async cuttingStageTask(organizationId: string, productionBatchId: string) {
    return this.prisma.productionStageTask.findFirst({
      where: { organizationId, productionBatchId, productionStage: { code: 'CUTTING' } },
      select: { id: true, sequence: true },
    });
  }

  /** Fold recorded actuals into the stored size plan, leaving the plan intact. */
  private mergeSizeActuals(
    stored: Prisma.JsonValue,
    actuals: readonly { size: string; actualPieces: string }[],
  ): Prisma.InputJsonValue {
    const plan = Array.isArray(stored) ? (stored as { size: string; plannedPieces: string }[]) : [];
    const bySize = new Map(actuals.map((a) => [a.size, a.actualPieces]));
    return plan.map((p) => ({ ...p, actualPieces: bySize.get(p.size) ?? '0' })) as unknown as Prisma.InputJsonValue;
  }

  private async presentCuttingOrder(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const row = await client.cuttingOrder.findFirst({
      where: { id, organizationId },
      include: {
        manufacturingOrder: { select: { id: true, moNo: true } },
        productionBatch: { select: { id: true, batchNo: true, plannedQty: true } },
        fabricLot: { select: { id: true, lotCode: true, shade: true } },
        fabricRoll: { select: { id: true, rollNo: true, currentLength: true } },
      },
    });
    if (!row) throw new NotFoundException({ code: 'CUTTING_ORDER_NOT_FOUND', message: 'Cutting order not found' });
    return this.decorateCuttingOrder(row);
  }

  private decorateCuttingOrder<T extends {
    plannedPieces: Prisma.Decimal; actualPiecesCut: Prisma.Decimal;
    fabricIssuedBaseQty: Prisma.Decimal; fabricUsedBaseQty: Prisma.Decimal;
    fabricWastageBaseQty: Prisma.Decimal; fabricReturnedBaseQty: Prisma.Decimal;
    consumptionPostedAt: Date | null;
  }>(row: T) {
    const issued = qty(row.fabricIssuedBaseQty.toFixed());
    const used = qty(row.fabricUsedBaseQty.toFixed());
    const wasted = qty(row.fabricWastageBaseQty.toFixed());
    const returned = qty(row.fabricReturnedBaseQty.toFixed());
    const cut = qty(row.actualPiecesCut.toFixed());

    return {
      ...row,
      // What the table is still holding, which is the figure a supervisor
      // walking the floor actually wants.
      fabricOnTableQty: Decimal.max(issued.minus(used).minus(wasted).minus(returned), 0).toFixed(4),
      // Fabric per garment actually achieved, against what the BOM planned.
      actualFabricPerPiece: cut.greaterThan(0) ? used.plus(wasted).dividedBy(cut).toDecimalPlaces(4).toFixed(4) : null,
      wastagePct: used.plus(wasted).greaterThan(0)
        ? wasted.dividedBy(used.plus(wasted)).times(100).toDecimalPlaces(2).toFixed(2)
        : '0.00',
      isConsumptionPosted: row.consumptionPostedAt != null,
    };
  }

  private async presentJobWork(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const row = await client.jobWorkOrder.findFirst({
      where: { id, organizationId },
      include: {
        jobWorker: { select: { id: true, code: true, name: true, kind: true } },
        productionStage: { select: { id: true, code: true, name: true } },
        manufacturingOrder: { select: { id: true, moNo: true } },
        lines: { include: { productionBatch: { select: { id: true, batchNo: true } } } },
      },
    });
    if (!row) throw new NotFoundException({ code: 'JOB_WORK_ORDER_NOT_FOUND', message: 'Job work order not found' });
    return {
      ...row,
      pendingQty: Decimal.max(
        qty(row.assignedQty.toFixed()).minus(qty(row.receivedQty.toFixed())),
        0,
      ).toFixed(4),
      isOverdue:
        row.dueDate != null && row.dueDate < new Date() && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(row.status),
    };
  }
}
