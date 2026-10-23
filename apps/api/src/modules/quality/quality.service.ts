import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal, assertDefectsConsistent, planQcVerdict, qty,
} from '@dnd/domain';
import type { CloseReworkOrderRequest, CreateInspectionRequest, CreateReworkOrderRequest } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { paginated } from '../../common/pagination';
import { ProductionService } from '../production/production.service';

/**
 * Quality control and rework.
 *
 * An inspection is a *record of a judgement*, and it moves the same stage
 * counters a shop-floor scan does — through `ProductionService`, never by
 * writing those counters here. That is what stops QC and the floor reporting
 * different numbers for the same garments.
 *
 * The arithmetic rule the domain enforces: passed + failed + rework + hold
 * equals exactly the inspected quantity. A garment that was looked at has an
 * outcome. "Some of them were fine" is not an inspection result, and letting
 * the remainder vanish is how a batch quietly loses pieces.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // =========================================================================
  // inspections
  // =========================================================================

  async createInspection(organizationId: string, actorUserId: string, body: CreateInspectionRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'quality.inspect',
        key: body.idempotencyKey,
        payload: body,
        entityType: 'QualityInspection',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const batch = await tx.productionBatch.findFirst({
            where: { id: body.productionBatchId, organizationId },
            include: {
              stageTasks: {
                orderBy: { sequence: 'asc' },
                include: { productionStage: { select: { id: true, code: true, name: true, requiresQc: true } } },
              },
            },
          });
          if (!batch) {
            throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });
          }

          // Where the inspection applies. Default to the route's QC step, then
          // to wherever the batch is actually holding work.
          const stageTask = body.stageTaskId
            ? batch.stageTasks.find((t) => t.id === body.stageTaskId)
            : (batch.stageTasks.find((t) => t.productionStage.requiresQc) ??
               batch.stageTasks.find((t) => qty(t.receivedQty.toFixed())
                 .minus(qty(t.completedQty.toFixed()))
                 .minus(qty(t.rejectedQty.toFixed()))
                 .greaterThan(0)));

          if (!stageTask) {
            throw new BadRequestException({
              code: 'NO_STAGE_TO_INSPECT',
              message:
                'This batch has no route step holding work to inspect. Name the step explicitly if you meant a different one.',
              details: { productionBatchId: batch.id },
            });
          }

          // The domain owns the split arithmetic and the resulting verdict.
          const verdict = planQcVerdict({
            inspectedQty: body.inspectedQty,
            passedQty: body.passedQty,
            failedQty: body.failedQty,
            reworkQty: body.reworkQty,
            holdQty: body.holdQty,
          });

          // Defects may only exist where something was not accepted. One
          // garment can carry several, so the total may exceed the count.
          assertDefectsConsistent(
            verdict,
            body.defects.map((d) => ({ category: d.category, qty: d.qty })),
          );

          const inspectionNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.QUALITY_INSPECTION);

          const inspection = await tx.qualityInspection.create({
            data: {
              organizationId,
              inspectionNo,
              kind: body.kind,
              manufacturingOrderId: batch.manufacturingOrderId,
              productionBatchId: batch.id,
              stageTaskId: stageTask.id,
              productionStageId: stageTask.productionStageId,
              inspectedQty: new Prisma.Decimal(body.inspectedQty),
              passedQty: new Prisma.Decimal(body.passedQty),
              failedQty: new Prisma.Decimal(body.failedQty),
              reworkQty: new Prisma.Decimal(body.reworkQty),
              holdQty: new Prisma.Decimal(body.holdQty),
              result: verdict.result,
              checklist: body.checklist as unknown as Prisma.InputJsonValue,
              photoUrls: body.photoUrls,
              reinspectionOfId: body.reinspectionOfId ?? null,
              inspectorUserId: actorUserId,
              remarks: body.remarks ?? null,
              idempotencyKey: body.idempotencyKey,
              defects: {
                create: body.defects.map((d) => ({
                  category: d.category,
                  defectCode: d.defectCode ?? null,
                  description: d.description ?? null,
                  qty: new Prisma.Decimal(d.qty),
                  severity: d.severity,
                  // Where it was CAUSED, which is not necessarily where it was
                  // found — that is the whole point of recording it.
                  attributedStageId: d.attributedStageId ?? null,
                  attributedJobWorkerId: d.attributedJobWorkerId ?? null,
                  photoUrls: d.photoUrls,
                })),
              },
            },
            select: { id: true, inspectionNo: true, result: true },
          });

          // Move the stage counters the same way a scan would. Held quantity
          // is deliberately NOT disposed of: it stays in work in progress
          // until someone decides, which is what "hold" means.
          const moves =
            Number(body.passedQty) + Number(body.failedQty) + Number(body.reworkQty) > 0;
          if (moves) {
            await this.production.applyStageOutcomeWithin(
              tx,
              organizationId,
              stageTask.id,
              {
                completedQty: body.passedQty,
                rejectedQty: body.failedQty,
                reworkQty: body.reworkQty,
              },
              {
                actorUserId,
                movementKey: `${body.idempotencyKey}:qc`,
                remarks: `${inspectionNo}: ${verdict.result}`,
              },
            );
          }

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'QualityInspection', entityId: inspection.id,
              context: {
                inspectionNo, batchNo: batch.batchNo, stageCode: stageTask.productionStage.code,
                inspectedQty: body.inspectedQty, passedQty: body.passedQty,
                failedQty: body.failedQty, reworkQty: body.reworkQty, holdQty: body.holdQty,
                result: verdict.result, defectCount: body.defects.length,
              },
            },
            tx,
          );

          return {
            result: await this.presentInspection(tx, organizationId, inspection.id),
            entityId: inspection.id,
          };
        }),
    );
    return result;
  }

  async listInspections(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      productionBatchId?: string; manufacturingOrderId?: string; kind?: string; result?: string;
    },
  ) {
    const where: Prisma.QualityInspectionWhereInput = {
      organizationId,
      ...(query.productionBatchId ? { productionBatchId: query.productionBatchId } : {}),
      ...(query.manufacturingOrderId ? { manufacturingOrderId: query.manufacturingOrderId } : {}),
      ...(query.kind ? { kind: query.kind as never } : {}),
      ...(query.result ? { result: query.result as never } : {}),
      ...(query.search ? { inspectionNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.qualityInspection.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { inspectedAt: 'desc' },
        include: {
          defects: true,
          productionBatch: { select: { id: true, batchNo: true } },
          productionStage: { select: { id: true, code: true, name: true } },
          manufacturingOrder: { select: { id: true, moNo: true } },
          _count: { select: { reworkOrders: true } },
        },
      }),
      this.prisma.qualityInspection.count({ where }),
    ]);

    const inspectorIds = [...new Set(rows.map((r) => r.inspectorUserId).filter(Boolean))] as string[];
    const inspectors = await this.prisma.user.findMany({
      where: { id: { in: inspectorIds } },
      select: { id: true, fullName: true, employeeCode: true },
    });
    const byId = new Map(inspectors.map((i) => [i.id, i]));

    return paginated(
      rows.map((r) => ({ ...r, inspector: r.inspectorUserId ? (byId.get(r.inspectorUserId) ?? null) : null })),
      total,
      query,
    );
  }

  async getInspection(organizationId: string, id: string) {
    return this.presentInspection(this.prisma, organizationId, id);
  }

  // =========================================================================
  // rework orders
  // =========================================================================

  /**
   * Raise a rework ticket.
   *
   * The garments have already left work in progress — the inspection did that
   * when it recorded them as rework. This is the instruction to fix them: who,
   * by when, and which step they return to.
   */
  async createReworkOrder(organizationId: string, actorUserId: string, body: CreateReworkOrderRequest) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'quality.createRework',
        key: body.idempotencyKey,
        payload: body,
        entityType: 'ReworkOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const batch = await tx.productionBatch.findFirst({
            where: { id: body.productionBatchId, organizationId },
            include: { stageTasks: { orderBy: { sequence: 'asc' } } },
          });
          if (!batch) {
            throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Production batch not found' });
          }

          // A ticket can only cover quantity that is actually out in rework,
          // minus whatever open tickets already cover. Otherwise two tickets
          // for the same ten garments would each claim to have fixed them.
          const outstanding = batch.stageTasks.reduce<Decimal>(
            (acc, t) =>
              acc
                .plus(qty(t.reworkSentQty.toFixed()))
                .minus(qty(t.reworkReturnedQty.toFixed())),
            new Decimal(0),
          );
          const alreadyTicketed = await tx.reworkOrder.aggregate({
            where: { organizationId, productionBatchId: batch.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
            _sum: { qty: true, completedQty: true, scrappedQty: true },
          });
          const openTicketed = qty(alreadyTicketed._sum.qty?.toFixed() ?? '0')
            .minus(qty(alreadyTicketed._sum.completedQty?.toFixed() ?? '0'))
            .minus(qty(alreadyTicketed._sum.scrappedQty?.toFixed() ?? '0'));

          const available = Decimal.max(outstanding.minus(openTicketed), 0);
          const wanted = qty(body.qty);
          if (wanted.greaterThan(available)) {
            throw new ConflictException({
              code: 'REWORK_EXCEEDS_OUTSTANDING',
              message:
                'More garments than are actually out in rework, once open tickets are counted. Record the rework at the stage first.',
              details: {
                requestedQty: wanted.toFixed(4),
                outstandingQty: outstanding.toFixed(4),
                alreadyTicketedQty: openTicketed.toFixed(4),
                availableQty: available.toFixed(4),
              },
            });
          }

          const reworkOrderNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.REWORK_ORDER);
          const created = await tx.reworkOrder.create({
            data: {
              organizationId,
              reworkOrderNo,
              qualityInspectionId: body.qualityInspectionId ?? null,
              productionBatchId: batch.id,
              targetStageId: body.targetStageId ?? null,
              assignedUserId: body.assignedUserId ?? null,
              assignedJobWorkerId: body.assignedJobWorkerId ?? null,
              qty: new Prisma.Decimal(wanted.toFixed(4)),
              status: 'OPEN',
              reason: body.reason,
              dueDate: body.dueDate ? new Date(body.dueDate) : null,
            },
            select: { id: true, reworkOrderNo: true },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'CREATE',
              entityType: 'ReworkOrder', entityId: created.id,
              context: { reworkOrderNo, batchNo: batch.batchNo, qty: wanted.toFixed(4), reason: body.reason },
            },
            tx,
          );

          return { result: await this.presentRework(tx, organizationId, created.id), entityId: created.id };
        }),
    );
    return result;
  }

  /**
   * Close a rework ticket.
   *
   * Completed garments return to the stage they left — through the production
   * service, so the cumulative rework counters stay the authority and a
   * garment reworked twice is still one garment.
   *
   * Scrapped garments do NOT return. They are rejected at that stage, which is
   * what closes the batch arithmetic rather than leaving a quantity
   * permanently out.
   */
  async closeReworkOrder(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: CloseReworkOrderRequest,
  ) {
    const { result } = await this.idempotency.execute(
      {
        organizationId,
        scope: 'quality.closeRework',
        key: body.idempotencyKey,
        payload: { reworkOrderId: id, ...body },
        entityType: 'ReworkOrder',
      },
      () =>
        this.prisma.inTransaction(async (tx) => {
          const ticket = await tx.reworkOrder.findFirst({
            where: { id, organizationId },
            include: { productionBatch: { select: { id: true, batchNo: true } } },
          });
          if (!ticket) {
            throw new NotFoundException({ code: 'REWORK_ORDER_NOT_FOUND', message: 'Rework order not found' });
          }
          if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') {
            throw new ConflictException({
              code: 'REWORK_ORDER_CLOSED',
              message: `Rework order ${ticket.reworkOrderNo} is already ${ticket.status}`,
              details: { status: ticket.status },
            });
          }

          const completed = qty(body.completedQty);
          const scrapped = qty(body.scrappedQty);
          const open = qty(ticket.qty.toFixed())
            .minus(qty(ticket.completedQty.toFixed()))
            .minus(qty(ticket.scrappedQty.toFixed()));

          if (completed.plus(scrapped).greaterThan(open)) {
            throw new ConflictException({
              code: 'REWORK_CLOSE_EXCEEDS_OPEN',
              message: 'More garments than this ticket still has open',
              details: {
                submittedQty: completed.plus(scrapped).toFixed(4),
                openQty: open.toFixed(4),
                ticketQty: qty(ticket.qty.toFixed()).toFixed(4),
              },
            });
          }

          // Which step they go back to: the ticket's target, or the step that
          // actually has the rework outstanding.
          const targetTask = ticket.targetStageId
            ? await this.production.stageTaskFor(tx, organizationId, ticket.productionBatchId, ticket.targetStageId)
            : await tx.productionStageTask.findFirst({
                where: {
                  organizationId,
                  productionBatchId: ticket.productionBatchId,
                  reworkSentQty: { gt: 0 },
                },
                orderBy: { sequence: 'asc' },
                select: { id: true, sequence: true },
              });

          if (!targetTask) {
            throw new BadRequestException({
              code: 'NO_REWORK_TARGET_STAGE',
              message: 'Could not resolve the route step these garments return to',
              details: { reworkOrderId: id },
            });
          }

          // Both outcomes come back out of rework first; the difference is
          // what happens next.
          const returning = completed.plus(scrapped);
          if (returning.greaterThan(0)) {
            await this.production.applyReworkReturnWithin(
              tx, organizationId, targetTask.id, returning.toFixed(4),
              {
                actorUserId,
                movementKey: `${body.idempotencyKey}:rework-return`,
                remarks: `${ticket.reworkOrderNo} closed`,
              },
            );
          }

          // Scrapped garments are then rejected at that stage.
          if (scrapped.greaterThan(0)) {
            await this.production.applyStageOutcomeWithin(
              tx, organizationId, targetTask.id,
              { rejectedQty: scrapped.toFixed(4) },
              {
                actorUserId,
                movementKey: `${body.idempotencyKey}:rework-scrap`,
                remarks: body.scrapReason ?? `${ticket.reworkOrderNo}: scrapped`,
              },
            );
          }

          const nextCompleted = qty(ticket.completedQty.toFixed()).plus(completed);
          const nextScrapped = qty(ticket.scrappedQty.toFixed()).plus(scrapped);
          const fullyClosed = nextCompleted.plus(nextScrapped).greaterThanOrEqualTo(qty(ticket.qty.toFixed()));

          await tx.reworkOrder.update({
            where: { id },
            data: {
              completedQty: new Prisma.Decimal(nextCompleted.toFixed(4)),
              scrappedQty: new Prisma.Decimal(nextScrapped.toFixed(4)),
              status: fullyClosed
                ? nextCompleted.greaterThan(0) ? 'COMPLETED' : 'SCRAPPED'
                : 'IN_PROGRESS',
              completedAt: fullyClosed ? new Date() : null,
            },
          });

          await this.audit.record(
            {
              organizationId, actorUserId, action: 'POST',
              entityType: 'ReworkOrder', entityId: id,
              context: {
                reworkOrderNo: ticket.reworkOrderNo,
                batchNo: ticket.productionBatch.batchNo,
                completedQty: completed.toFixed(4),
                scrappedQty: scrapped.toFixed(4),
                scrapReason: body.scrapReason ?? null,
              },
            },
            tx,
          );

          return { result: await this.presentRework(tx, organizationId, id), entityId: id };
        }),
    );
    return result;
  }

  async listReworkOrders(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      productionBatchId?: string; status?: string; assignedJobWorkerId?: string;
    },
  ) {
    const where: Prisma.ReworkOrderWhereInput = {
      organizationId,
      ...(query.productionBatchId ? { productionBatchId: query.productionBatchId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.assignedJobWorkerId ? { assignedJobWorkerId: query.assignedJobWorkerId } : {}),
      ...(query.search ? { reworkOrderNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reworkOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          productionBatch: {
            select: {
              id: true, batchNo: true,
              manufacturingOrder: { select: { id: true, moNo: true } },
              manufacturingOrderItem: { select: { size: true, productVariant: { select: { sku: true } } } },
            },
          },
          qualityInspection: { select: { id: true, inspectionNo: true, result: true } },
          assignedJobWorker: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.reworkOrder.count({ where }),
    ]);

    return paginated(
      rows.map((r) => ({
        ...r,
        openQty: Decimal.max(
          qty(r.qty.toFixed()).minus(qty(r.completedQty.toFixed())).minus(qty(r.scrappedQty.toFixed())),
          0,
        ).toFixed(4),
        isOverdue:
          r.dueDate != null && r.dueDate < new Date() && ['OPEN', 'IN_PROGRESS'].includes(r.status),
      })),
      total,
      query,
    );
  }

  // =========================================================================
  // internals
  // =========================================================================

  private async presentInspection(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const row = await client.qualityInspection.findFirst({
      where: { id, organizationId },
      include: {
        defects: true,
        productionBatch: {
          select: {
            id: true, batchNo: true,
            manufacturingOrderItem: { select: { size: true, productVariant: { select: { sku: true } } } },
          },
        },
        productionStage: { select: { id: true, code: true, name: true } },
        manufacturingOrder: { select: { id: true, moNo: true } },
        reworkOrders: { select: { id: true, reworkOrderNo: true, status: true, qty: true } },
      },
    });
    if (!row) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found' });
    return row;
  }

  private async presentRework(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const row = await client.reworkOrder.findFirst({
      where: { id, organizationId },
      include: {
        productionBatch: { select: { id: true, batchNo: true } },
        qualityInspection: { select: { id: true, inspectionNo: true } },
        assignedJobWorker: { select: { id: true, code: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException({ code: 'REWORK_ORDER_NOT_FOUND', message: 'Rework order not found' });
    return {
      ...row,
      openQty: Decimal.max(
        qty(row.qty.toFixed()).minus(qty(row.completedQty.toFixed())).minus(qty(row.scrappedQty.toFixed())),
        0,
      ).toFixed(4),
    };
  }
}
