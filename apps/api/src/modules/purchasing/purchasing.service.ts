import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal, SYSTEM_LOCATIONS, UomConverter, amount, assertInspectionSplit, assertReceivable,
  assessPoClosure, dec, landedUnitCost, qty, rate, type UomCode,
} from '@dnd/domain';
import type {
  CreatePurchaseOrderRequest, CreateReceiptRequest, CreateRequisitionRequest,
  InspectReceiptRequest,
} from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DOC_SCOPES, NumberingService } from '../../common/services/numbering.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';
import { FabricRollsService } from '../materials/fabric-rolls.service';
import { LedgerService } from '../inventory/ledger.service';

/**
 * Raw material purchasing.
 *
 * The receiving flow is deliberately two-step:
 *
 *   createReceipt  -> quantity enters the QC HOLD location (owned, not usable)
 *   inspectReceipt -> accepted quantity is RELEASED to a usable location,
 *                     rejected quantity moves to the REJECTED location
 *
 * Stock therefore cannot reach a location production can draw on without
 * passing inspection, and both steps are ordinary ledger movements, so the
 * whole path is auditable.
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rolls: FabricRollsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // -------------------------------------------------------------------------
  // requisitions
  // -------------------------------------------------------------------------

  async listRequisitions(
    organizationId: string,
    query: { page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string; status?: string },
  ) {
    const where: Prisma.PurchaseRequisitionWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(searchFilter(query.search, ['requisitionNo']) ?? {}),
    };
    const args = pageArgs(query, ['requisitionNo', 'createdAt', 'requiredByDate'], 'createdAt');
    const [rows, total] = await Promise.all([
      this.prisma.purchaseRequisition.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { createdAt: 'desc' },
        include: {
          items: {
            include: {
              rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } },
              suggestedSupplier: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.purchaseRequisition.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async createRequisition(organizationId: string, actorUserId: string, body: CreateRequisitionRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const requisitionNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.PURCHASE_REQUISITION);
      const created = await tx.purchaseRequisition.create({
        data: {
          organizationId,
          requisitionNo,
          status: 'PENDING_APPROVAL',
          requiredByDate: body.requiredByDate ? new Date(body.requiredByDate) : null,
          mrpRunId: body.mrpRunId ?? null,
          raisedByUserId: actorUserId,
          remarks: body.remarks ?? null,
          items: {
            create: body.items.map((i) => ({
              rawMaterialId: i.rawMaterialId,
              requestedQty: new Prisma.Decimal(i.requestedQty),
              uom: i.uom,
              suggestedSupplierId: i.suggestedSupplierId ?? null,
              estimatedRate: i.estimatedRate ? new Prisma.Decimal(i.estimatedRate) : null,
              materialRequirementId: i.materialRequirementId ?? null,
              remarks: i.remarks ?? null,
            })),
          },
        },
        include: { items: true },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE',
          entityType: 'PurchaseRequisition', entityId: created.id,
          context: { requisitionNo, itemCount: body.items.length },
        },
        tx,
      );
      return created;
    });
  }

  async decideRequisition(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: { decision: 'APPROVE' | 'REJECT'; note?: string | null; itemApprovals?: { itemId: string; approvedQty: string }[] },
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const req = await tx.purchaseRequisition.findFirst({ where: { id, organizationId }, include: { items: true } });
      if (!req) throw new NotFoundException({ code: 'REQUISITION_NOT_FOUND', message: 'Requisition not found' });
      if (req.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException({
          code: 'REQUISITION_NOT_PENDING',
          message: `Requisition is ${req.status} and cannot be decided again`,
          details: { status: req.status },
        });
      }

      if (body.decision === 'APPROVE') {
        for (const item of req.items) {
          const override = body.itemApprovals?.find((a) => a.itemId === item.id);
          await tx.purchaseRequisitionItem.update({
            where: { id: item.id },
            data: {
              approvedQty: new Prisma.Decimal(override ? override.approvedQty : item.requestedQty.toFixed()),
            },
          });
        }
      }

      const updated = await tx.purchaseRequisition.update({
        where: { id },
        data: {
          status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
          rejectionReason: body.decision === 'REJECT' ? (body.note ?? 'Rejected') : null,
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId,
          action: body.decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
          entityType: 'PurchaseRequisition', entityId: id,
          context: { requisitionNo: req.requisitionNo, note: body.note ?? null, elevated: true },
        },
        tx,
      );
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // purchase orders
  // -------------------------------------------------------------------------

  async listPurchaseOrders(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      status?: string; supplierId?: string; rawMaterialId?: string; overdueOnly?: boolean;
    },
  ) {
    const where: Prisma.RawMaterialPurchaseOrderWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.rawMaterialId ? { items: { some: { rawMaterialId: query.rawMaterialId } } } : {}),
      ...(query.overdueOnly
        ? {
            expectedDate: { lt: new Date() },
            status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
          }
        : {}),
      ...(searchFilter(query.search, ['poNo', 'remarks']) ?? {}),
    };
    const args = pageArgs(query, ['poNo', 'orderDate', 'expectedDate', 'totalAmount', 'status'], 'orderDate');
    const [rows, total] = await Promise.all([
      this.prisma.rawMaterialPurchaseOrder.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { orderDate: 'desc' },
        include: {
          supplier: { select: { id: true, supplierCode: true, name: true } },
          items: {
            include: { rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true } } },
            orderBy: { lineNo: 'asc' },
          },
          _count: { select: { receipts: true } },
        },
      }),
      this.prisma.rawMaterialPurchaseOrder.count({ where }),
    ]);

    return paginated(
      rows.map((po) => ({
        ...po,
        // Outstanding quantity is what a buyer actually chases, so compute it
        // here rather than making every list screen work it out.
        pendingBaseQty: po.items
          .reduce<Decimal>(
            (acc, i) => acc.plus(Decimal.max(dec(i.orderedBaseQty.toFixed()).minus(dec(i.receivedBaseQty.toFixed())), 0)),
            new Decimal(0),
          )
          .toFixed(),
      })),
      total,
      query,
    );
  }

  async getPurchaseOrder(organizationId: string, id: string) {
    const po = await this.prisma.rawMaterialPurchaseOrder.findFirst({
      where: { id, organizationId },
      include: {
        supplier: true,
        items: {
          include: { rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, category: true } } },
          orderBy: { lineNo: 'asc' },
        },
        receipts: {
          include: { lines: true },
          orderBy: { receiptDate: 'desc' },
        },
      },
    });
    if (!po) throw new NotFoundException({ code: 'PO_NOT_FOUND', message: 'Purchase order not found' });

    const closure = assessPoClosure(
      po.items.map((i) => ({
        id: i.id, lineNo: i.lineNo, rawMaterialId: i.rawMaterialId,
        orderedBaseQty: i.orderedBaseQty.toFixed(),
        receivedBaseQty: i.receivedBaseQty.toFixed(),
        acceptedBaseQty: i.acceptedBaseQty.toFixed(),
        rejectedBaseQty: i.rejectedBaseQty.toFixed(),
      })),
      {
        overReceiptTolerancePct: po.overReceiptTolerancePct.toFixed(),
        underReceiptTolerancePct: po.underReceiptTolerancePct.toFixed(),
      },
    );

    return {
      ...po,
      items: po.items.map((i) => ({
        ...i,
        pendingBaseQty: Decimal.max(
          dec(i.orderedBaseQty.toFixed()).minus(dec(i.receivedBaseQty.toFixed())),
          0,
        ).toFixed(),
      })),
      closure,
    };
  }

  async createPurchaseOrder(organizationId: string, actorUserId: string, body: CreatePurchaseOrderRequest) {
    return this.prisma.inTransaction(async (tx) => {
      const poNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.PURCHASE_ORDER);
      const converter = await this.loadConverter(tx, organizationId);

      let subtotal = new Decimal(0);
      let tax = new Decimal(0);

      const items = await Promise.all(
        body.items.map(async (item, idx) => {
          const material = await tx.rawMaterial.findFirstOrThrow({
            where: { id: item.rawMaterialId, organizationId },
            select: { id: true, baseUom: true, materialCode: true },
          });

          // Purchase quantities are converted to the stocking unit up front so
          // receipts and MRP never have to guess what "2 rolls" means.
          const orderedBaseQty = converter.convert(
            item.orderedQty, item.uom, material.baseUom as UomCode, material.id,
          );

          const gross = dec(item.orderedQty).times(dec(item.rate));
          const discount = gross.times(dec(item.discountPct)).dividedBy(100);
          const net = gross.minus(discount);
          const lineTax = net.times(dec(item.taxPct)).dividedBy(100);
          subtotal = subtotal.plus(net);
          tax = tax.plus(lineTax);

          return {
            lineNo: idx + 1,
            rawMaterialId: item.rawMaterialId,
            orderedQty: new Prisma.Decimal(qty(item.orderedQty).toFixed()),
            uom: item.uom,
            orderedBaseQty: new Prisma.Decimal(orderedBaseQty.toFixed()),
            rate: new Prisma.Decimal(rate(item.rate).toFixed()),
            discountPct: new Prisma.Decimal(item.discountPct),
            taxPct: new Prisma.Decimal(item.taxPct),
            lineAmount: new Prisma.Decimal(amount(net).toFixed()),
            expectedDate: item.expectedDate ? new Date(item.expectedDate) : null,
            requisitionItemId: item.requisitionItemId ?? null,
            remarks: item.remarks ?? null,
          };
        }),
      );

      const freight = amount(body.freightAmount);
      const created = await tx.rawMaterialPurchaseOrder.create({
        data: {
          organizationId,
          poNo,
          supplierId: body.supplierId,
          status: 'PENDING_APPROVAL',
          orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
          deliverToLocationId: body.deliverToLocationId ?? null,
          overReceiptTolerancePct: new Prisma.Decimal(body.overReceiptTolerancePct),
          underReceiptTolerancePct: new Prisma.Decimal(body.underReceiptTolerancePct),
          subtotalAmount: new Prisma.Decimal(amount(subtotal).toFixed()),
          taxAmount: new Prisma.Decimal(amount(tax).toFixed()),
          freightAmount: new Prisma.Decimal(freight.toFixed()),
          totalAmount: new Prisma.Decimal(amount(subtotal.plus(tax).plus(freight)).toFixed()),
          currency: body.currency,
          paymentTerms: body.paymentTerms ?? null,
          raisedByUserId: actorUserId,
          remarks: body.remarks ?? null,
          items: { create: items },
        },
        include: { items: true, supplier: { select: { name: true } } },
      });

      // Record how much of each requisition line this PO covers.
      for (const item of body.items) {
        if (!item.requisitionItemId) continue;
        await tx.purchaseRequisitionItem.update({
          where: { id: item.requisitionItemId },
          data: { orderedQty: { increment: new Prisma.Decimal(qty(item.orderedQty).toFixed()) } },
        });
      }

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CREATE',
          entityType: 'RawMaterialPurchaseOrder', entityId: created.id,
          context: { poNo, supplier: created.supplier.name, totalAmount: created.totalAmount.toFixed() },
        },
        tx,
      );
      return created;
    });
  }

  async decidePurchaseOrder(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: { decision: 'APPROVE' | 'REJECT'; note?: string | null },
  ) {
    return this.prisma.inTransaction(async (tx) => {
      const po = await tx.rawMaterialPurchaseOrder.findFirst({ where: { id, organizationId } });
      if (!po) throw new NotFoundException({ code: 'PO_NOT_FOUND', message: 'Purchase order not found' });
      if (po.status !== 'PENDING_APPROVAL' && po.status !== 'DRAFT') {
        throw new BadRequestException({
          code: 'PO_NOT_PENDING',
          message: `Purchase order is ${po.status} and cannot be approved`,
          details: { status: po.status },
        });
      }

      const updated = await tx.rawMaterialPurchaseOrder.update({
        where: { id },
        data: {
          status: body.decision === 'APPROVE' ? 'APPROVED' : 'CANCELLED',
          approvedByUserId: body.decision === 'APPROVE' ? actorUserId : null,
          approvedAt: body.decision === 'APPROVE' ? new Date() : null,
          cancelReason: body.decision === 'REJECT' ? (body.note ?? 'Rejected at approval') : null,
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId,
          action: body.decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
          entityType: 'RawMaterialPurchaseOrder', entityId: id,
          context: { poNo: po.poNo, note: body.note ?? null, elevated: true },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Close a purchase order short.
   *
   * Explicit and permissioned, because a PO is not closed just because some
   * stock arrived: a short delivery leaves outstanding quantity that someone
   * has to decide to give up on.
   */
  async closePurchaseOrder(organizationId: string, actorUserId: string, id: string, reason: string) {
    return this.prisma.inTransaction(async (tx) => {
      const po = await tx.rawMaterialPurchaseOrder.findFirst({
        where: { id, organizationId },
        include: { items: true },
      });
      if (!po) throw new NotFoundException({ code: 'PO_NOT_FOUND', message: 'Purchase order not found' });
      if (po.status === 'CLOSED' || po.status === 'CANCELLED') {
        throw new BadRequestException({
          code: 'PO_ALREADY_CLOSED',
          message: `Purchase order is already ${po.status}`,
        });
      }

      const updated = await tx.rawMaterialPurchaseOrder.update({
        where: { id },
        data: { status: 'CLOSED', closedByUserId: actorUserId, closedAt: new Date(), closeReason: reason },
      });

      const pending = po.items.reduce<Decimal>(
        (acc, i) => acc.plus(Decimal.max(dec(i.orderedBaseQty.toFixed()).minus(dec(i.receivedBaseQty.toFixed())), 0)),
        new Decimal(0),
      );

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'CANCEL',
          entityType: 'RawMaterialPurchaseOrder', entityId: id,
          context: { poNo: po.poNo, reason, abandonedQty: qty(pending).toFixed(), elevated: true },
        },
        tx,
      );
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // goods receipts
  // -------------------------------------------------------------------------

  async listReceipts(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      status?: string; supplierId?: string; purchaseOrderId?: string;
    },
  ) {
    const where: Prisma.RawMaterialReceiptWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
      ...(searchFilter(query.search, ['grnNo', 'supplierInvoiceNo', 'supplierDcNo']) ?? {}),
    };
    const args = pageArgs(query, ['grnNo', 'receiptDate', 'status'], 'receiptDate');
    const [rows, total] = await Promise.all([
      this.prisma.rawMaterialReceipt.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { receiptDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, poNo: true } },
          targetLocation: { select: { id: true, code: true, name: true } },
          barcode: { select: { code: true } },
          lines: {
            include: { rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, category: true } } },
            orderBy: { lineNo: 'asc' },
          },
        },
      }),
      this.prisma.rawMaterialReceipt.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async getReceipt(organizationId: string, id: string) {
    const receipt = await this.prisma.rawMaterialReceipt.findFirst({
      where: { id, organizationId },
      include: {
        supplier: true,
        purchaseOrder: { select: { id: true, poNo: true, overReceiptTolerancePct: true, underReceiptTolerancePct: true } },
        targetLocation: true,
        barcode: true,
        lines: {
          include: {
            rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, category: true } },
            purchaseItem: { select: { id: true, lineNo: true, orderedBaseQty: true, receivedBaseQty: true } },
            lots: { include: { fabricRolls: { select: { id: true, rollNo: true, currentLength: true, status: true } } } },
          },
          orderBy: { lineNo: 'asc' },
        },
      },
    });
    if (!receipt) throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'Goods receipt not found' });
    return receipt;
  }

  /**
   * Record a goods receipt.
   *
   * Everything happens in one transaction: lots are created, fabric rolls are
   * registered with their barcodes, the PO's received quantity is updated, and
   * each line posts a PURCHASE_INWARD movement into the QC HOLD location. The
   * stock is now owned but deliberately not issuable.
   */
  async createReceipt(organizationId: string, actorUserId: string, body: CreateReceiptRequest) {
    return this.idempotency.execute(
      { organizationId, scope: 'purchasing.receipt', key: body.idempotencyKey, payload: body, entityType: 'RawMaterialReceipt' },
      async () => {
        const result = await this.prisma.inTransaction(
          async (tx) => {
            const converter = await this.loadConverter(tx, organizationId);
            const qcHoldId = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.QC_HOLD_RM);
            const externalId = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.EXTERNAL);

            const po = body.purchaseOrderId
              ? await tx.rawMaterialPurchaseOrder.findFirstOrThrow({
                  where: { id: body.purchaseOrderId, organizationId },
                  include: { items: true },
                })
              : null;

            if (po && !['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
              throw new BadRequestException({
                code: 'PO_NOT_RECEIVABLE',
                message: `Purchase order ${po.poNo} is ${po.status}; only an approved or partially received order can take a delivery`,
                details: { poNo: po.poNo, status: po.status },
              });
            }

            const grnNo = await this.numbering.next(tx, organizationId, DOC_SCOPES.GOODS_RECEIPT);

            // Receipt value, needed to apportion freight across the lines.
            const receiptValue = body.lines.reduce<Decimal>(
              (acc, l) => acc.plus(dec(l.receivedQty).times(dec(l.rate ?? '0'))),
              new Decimal(0),
            );

            const receipt = await tx.rawMaterialReceipt.create({
              data: {
                organizationId,
                grnNo,
                purchaseOrderId: body.purchaseOrderId ?? null,
                supplierId: body.supplierId,
                status: 'PENDING_INSPECTION',
                receiptDate: body.receiptDate ? new Date(body.receiptDate) : new Date(),
                supplierInvoiceNo: body.supplierInvoiceNo ?? null,
                supplierDcNo: body.supplierDcNo ?? null,
                vehicleNo: body.vehicleNo ?? null,
                targetLocationId: body.targetLocationId,
                receivedByUserId: actorUserId,
                freightAmount: new Prisma.Decimal(amount(body.freightAmount).toFixed()),
                remarks: body.remarks ?? null,
                idempotencyKey: body.idempotencyKey,
              },
              select: { id: true, grnNo: true },
            });

            // One scannable barcode per delivery, so the storekeeper can pull
            // the GRN up at the inspection bench without typing anything.
            const { buildReceiptCode } = await import('@dnd/domain');
            const receiptBarcode = buildReceiptCode(receipt.grnNo);
            await tx.barcodeIdentifier.create({
              data: {
                organizationId,
                code: receiptBarcode,
                kind: 'GOODS_RECEIPT',
                receiptId: receipt.id,
                labelData: { grnNo: receipt.grnNo, lineCount: body.lines.length },
              },
            });

            const createdLines: {
              lineNo: number; materialCode: string; receivedBaseQty: string;
              lotCode: string; rolls: { rollNo: string; barcode: string }[];
            }[] = [];

            for (let i = 0; i < body.lines.length; i += 1) {
              const line = body.lines[i]!;
              const material = await tx.rawMaterial.findFirstOrThrow({
                where: { id: line.rawMaterialId, organizationId },
                select: { id: true, materialCode: true, baseUom: true, category: true },
              });

              const receivedBaseQty = converter.convert(
                line.receivedQty, line.uom, material.baseUom as UomCode, material.id,
              );

              // Tolerance check against the purchase line, if this is a PO
              // delivery. Partial deliveries are normal; over-receipt beyond
              // the agreed tolerance is refused.
              if (line.purchaseItemId && po) {
                const poItem = po.items.find((x) => x.id === line.purchaseItemId);
                if (!poItem) {
                  throw new BadRequestException({
                    code: 'PO_LINE_MISMATCH',
                    message: 'The cited purchase order line does not belong to this purchase order',
                    details: { purchaseItemId: line.purchaseItemId, poNo: po.poNo },
                  });
                }
                assertReceivable(
                  {
                    id: poItem.id, lineNo: poItem.lineNo, rawMaterialId: poItem.rawMaterialId,
                    orderedBaseQty: poItem.orderedBaseQty.toFixed(),
                    receivedBaseQty: poItem.receivedBaseQty.toFixed(),
                    acceptedBaseQty: poItem.acceptedBaseQty.toFixed(),
                    rejectedBaseQty: poItem.rejectedBaseQty.toFixed(),
                  },
                  receivedBaseQty.toFixed(),
                  {
                    overReceiptTolerancePct: po.overReceiptTolerancePct.toFixed(),
                    underReceiptTolerancePct: po.underReceiptTolerancePct.toFixed(),
                  },
                );
              }

              const unitCost = landedUnitCost({
                lineQty: line.receivedQty,
                lineRate: line.rate ?? '0',
                freightAmount: body.freightAmount,
                receiptTotalValue: receiptValue,
              });

              const receiptLine = await tx.rawMaterialReceiptLine.create({
                data: {
                  receiptId: receipt.id,
                  lineNo: i + 1,
                  purchaseItemId: line.purchaseItemId ?? null,
                  rawMaterialId: line.rawMaterialId,
                  receivedQty: new Prisma.Decimal(qty(line.receivedQty).toFixed()),
                  uom: line.uom,
                  receivedBaseQty: new Prisma.Decimal(receivedBaseQty.toFixed()),
                  rate: line.rate ? new Prisma.Decimal(line.rate) : null,
                  landedUnitCost: new Prisma.Decimal(unitCost.toFixed()),
                  supplierLotRef: line.supplierLotRef ?? null,
                  shade: line.shade ?? null,
                  width: line.width ? new Prisma.Decimal(line.width) : null,
                  gsm: line.gsm ?? null,
                  remarks: line.remarks ?? null,
                },
                select: { id: true, lineNo: true },
              });

              // Each receipt line creates its own lot: that is what makes shade
              // and width traceable per delivery rather than averaged away.
              const lotCode = await this.numbering.next(tx, organizationId, DOC_SCOPES.MATERIAL_LOT);
              const lot = await tx.materialLot.create({
                data: {
                  organizationId,
                  rawMaterialId: line.rawMaterialId,
                  lotCode,
                  supplierLotRef: line.supplierLotRef ?? null,
                  shade: line.shade ?? null,
                  width: line.width ? new Prisma.Decimal(line.width) : null,
                  gsm: line.gsm ?? null,
                  unitCost: new Prisma.Decimal(unitCost.toFixed()),
                  receivedAt: new Date(),
                  supplierId: body.supplierId,
                  receiptLineId: receiptLine.id,
                },
                select: { id: true, lotCode: true },
              });

              const { buildLotCode } = await import('@dnd/domain');
              await tx.barcodeIdentifier.create({
                data: {
                  organizationId,
                  code: buildLotCode(lot.lotCode),
                  kind: 'MATERIAL_LOT',
                  materialLotId: lot.id,
                  labelData: {
                    lotCode: lot.lotCode,
                    materialCode: material.materialCode,
                    shade: line.shade ?? null,
                    qty: receivedBaseQty.toFixed(),
                    uom: material.baseUom,
                  },
                },
              });

              // Ledger: supplier -> QC hold. Not yet issuable.
              await this.ledger.postMovement(tx, {
                organizationId,
                movementType: 'PURCHASE_INWARD',
                rawMaterialId: line.rawMaterialId,
                materialLotId: lot.id,
                sourceLocationId: externalId,
                destinationLocationId: qcHoldId,
                enteredQty: qty(line.receivedQty).toFixed(),
                enteredUom: line.uom,
                unitCost: unitCost.toFixed(),
                referenceType: 'RawMaterialReceipt',
                referenceId: receipt.id,
                referenceLineId: receiptLine.id,
                referenceNo: receipt.grnNo,
                reason: 'Supplier delivery received into QC hold',
                operatorUserId: actorUserId,
                idempotencyKey: `${body.idempotencyKey}:${i}`,
              });

              // Fabric rolls, when the delivery was counted roll by roll.
              let rolls: { rollNo: string; barcode: string }[] = [];
              if (line.rolls && line.rolls.length > 0) {
                const rollTotal = line.rolls.reduce<Decimal>((a, r) => a.plus(dec(r.length)), new Decimal(0));
                if (!qty(rollTotal).equals(qty(line.receivedQty))) {
                  throw new BadRequestException({
                    code: 'ROLL_LENGTHS_MISMATCH',
                    message: 'Individual roll lengths must add up to exactly the received quantity',
                    details: {
                      lineNo: i + 1,
                      receivedQty: qty(line.receivedQty).toFixed(),
                      rollTotal: qty(rollTotal).toFixed(),
                      rollCount: line.rolls.length,
                    },
                  });
                }
                const created = await this.rolls.createForReceipt(tx, organizationId, {
                  rawMaterialId: line.rawMaterialId,
                  materialLotId: lot.id,
                  locationId: qcHoldId,
                  supplierId: body.supplierId,
                  receiptLineId: receiptLine.id,
                  shade: line.shade ?? null,
                  width: line.width ?? null,
                  gsm: line.gsm ?? null,
                  purchaseRate: line.rate ?? null,
                  lengthUom: line.uom,
                  rolls: line.rolls.map((r) => ({ length: r.length, rollNo: r.rollNo ?? null })),
                });
                rolls = created.map((r) => ({ rollNo: r.rollNo, barcode: r.barcode }));
              }

              if (line.purchaseItemId) {
                await tx.rawMaterialPurchaseItem.update({
                  where: { id: line.purchaseItemId },
                  data: { receivedBaseQty: { increment: new Prisma.Decimal(receivedBaseQty.toFixed()) } },
                });
              }

              createdLines.push({
                lineNo: receiptLine.lineNo,
                materialCode: material.materialCode,
                receivedBaseQty: receivedBaseQty.toFixed(),
                lotCode: lot.lotCode,
                rolls,
              });
            }

            // Re-evaluate the PO status now the receipt is in.
            if (po) await this.refreshPoStatus(tx, po.id);

            await this.audit.record(
              {
                organizationId, actorUserId, action: 'POST',
                entityType: 'RawMaterialReceipt', entityId: receipt.id,
                context: { grnNo: receipt.grnNo, poNo: po?.poNo ?? null, lineCount: createdLines.length },
              },
              tx,
            );

            return {
              id: receipt.id,
              grnNo: receipt.grnNo,
              barcode: receiptBarcode,
              status: 'PENDING_INSPECTION',
              lines: createdLines,
            };
          },
          { timeoutMs: 30_000 },
        );
        return { result, entityId: result.id };
      },
    );
  }

  /**
   * Inspect a receipt: release accepted stock, quarantine the rejected part.
   *
   * The accepted and rejected quantities must account for exactly the quantity
   * received on each line, so nothing is left stranded in QC hold with no
   * record of what was decided about it.
   */
  async inspectReceipt(
    organizationId: string,
    actorUserId: string,
    receiptId: string,
    body: InspectReceiptRequest,
  ) {
    return this.idempotency.execute(
      { organizationId, scope: 'purchasing.inspect', key: body.idempotencyKey, payload: { receiptId, ...body }, entityType: 'RawMaterialReceipt' },
      async () => {
        const result = await this.prisma.inTransaction(
          async (tx) => {
            const receipt = await tx.rawMaterialReceipt.findFirst({
              where: { id: receiptId, organizationId },
              include: { lines: true },
            });
            if (!receipt) throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'Goods receipt not found' });
            if (receipt.status !== 'PENDING_INSPECTION') {
              throw new BadRequestException({
                code: 'RECEIPT_NOT_INSPECTABLE',
                message: `Receipt is ${receipt.status}; only a receipt pending inspection can be inspected`,
                details: { grnNo: receipt.grnNo, status: receipt.status },
              });
            }

            const qcHoldId = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.QC_HOLD_RM);
            const rejectedId = await this.ledger.systemLocationId(tx, organizationId, SYSTEM_LOCATIONS.REJECTED_RM);

            const outcomes: {
              lineNo: number; acceptedQty: string; rejectedQty: string; result: string;
            }[] = [];

            for (let i = 0; i < body.lines.length; i += 1) {
              const decision = body.lines[i]!;
              const line = receipt.lines.find((l) => l.id === decision.receiptLineId);
              if (!line) {
                throw new BadRequestException({
                  code: 'RECEIPT_LINE_NOT_FOUND',
                  message: 'An inspected line does not belong to this receipt',
                  details: { receiptLineId: decision.receiptLineId },
                });
              }

              assertInspectionSplit(
                {
                  receivedBaseQty: line.receivedBaseQty.toFixed(),
                  acceptedBaseQty: decision.acceptedQty,
                  rejectedBaseQty: decision.rejectedQty,
                },
                { grnNo: receipt.grnNo, lineNo: line.lineNo },
              );

              const lot = await tx.materialLot.findFirstOrThrow({
                where: { receiptLineId: line.id },
                select: { id: true },
              });

              const accepted = qty(decision.acceptedQty);
              const rejected = qty(decision.rejectedQty);

              if (accepted.greaterThan(0)) {
                await this.ledger.postMovement(tx, {
                  organizationId,
                  movementType: 'QC_RELEASE',
                  rawMaterialId: line.rawMaterialId,
                  materialLotId: lot.id,
                  sourceLocationId: qcHoldId,
                  destinationLocationId: receipt.targetLocationId,
                  enteredQty: accepted.toFixed(),
                  enteredUom: line.uom,
                  unitCost: line.landedUnitCost?.toFixed() ?? null,
                  referenceType: 'RawMaterialReceipt',
                  referenceId: receipt.id,
                  referenceLineId: line.id,
                  referenceNo: receipt.grnNo,
                  reason: 'Accepted at incoming inspection',
                  operatorUserId: actorUserId,
                  idempotencyKey: `${body.idempotencyKey}:${i}:acc`,
                });

                await this.ledger.recomputeAverageCost(tx, organizationId, line.rawMaterialId);
              }

              if (rejected.greaterThan(0)) {
                await this.ledger.postMovement(tx, {
                  organizationId,
                  movementType: 'QC_REJECT',
                  rawMaterialId: line.rawMaterialId,
                  materialLotId: lot.id,
                  sourceLocationId: qcHoldId,
                  destinationLocationId: rejectedId,
                  enteredQty: rejected.toFixed(),
                  enteredUom: line.uom,
                  referenceType: 'RawMaterialReceipt',
                  referenceId: receipt.id,
                  referenceLineId: line.id,
                  referenceNo: receipt.grnNo,
                  reason: decision.rejectionReason ?? 'Rejected at incoming inspection',
                  operatorUserId: actorUserId,
                  idempotencyKey: `${body.idempotencyKey}:${i}:rej`,
                });
              }

              const inspectionResult = rejected.isZero()
                ? 'PASS'
                : accepted.isZero()
                  ? 'FAIL'
                  : 'HOLD';

              await tx.rawMaterialReceiptLine.update({
                where: { id: line.id },
                data: {
                  acceptedBaseQty: new Prisma.Decimal(accepted.toFixed()),
                  rejectedBaseQty: new Prisma.Decimal(rejected.toFixed()),
                  inspectionResult,
                  rejectionReason: decision.rejectionReason ?? null,
                },
              });

              await this.applyRollInspection(tx, {
                organizationId,
                receiptLineId: line.id,
                targetLocationId: receipt.targetLocationId,
                rejectedLocationId: rejectedId,
                rejectedQty: rejected,
                rollDecisions: decision.rollDecisions ?? [],
                grnNo: receipt.grnNo,
                lineNo: line.lineNo,
              });

              if (line.purchaseItemId) {
                await tx.rawMaterialPurchaseItem.update({
                  where: { id: line.purchaseItemId },
                  data: {
                    acceptedBaseQty: { increment: new Prisma.Decimal(accepted.toFixed()) },
                    rejectedBaseQty: { increment: new Prisma.Decimal(rejected.toFixed()) },
                  },
                });
              }

              outcomes.push({
                lineNo: line.lineNo,
                acceptedQty: accepted.toFixed(),
                rejectedQty: rejected.toFixed(),
                result: inspectionResult,
              });
            }

            const updated = await tx.rawMaterialReceipt.update({
              where: { id: receiptId },
              data: {
                status: 'POSTED',
                inspectedByUserId: actorUserId,
                inspectedAt: body.inspectionDate ? new Date(body.inspectionDate) : new Date(),
                postedByUserId: actorUserId,
                postedAt: new Date(),
              },
              select: { id: true, grnNo: true, purchaseOrderId: true },
            });

            if (updated.purchaseOrderId) await this.refreshPoStatus(tx, updated.purchaseOrderId);

            await this.audit.record(
              {
                organizationId, actorUserId, action: 'APPROVE',
                entityType: 'RawMaterialReceipt', entityId: receiptId,
                context: { grnNo: updated.grnNo, lines: outcomes },
              },
              tx,
            );

            return { id: updated.id, grnNo: updated.grnNo, status: 'POSTED', lines: outcomes };
          },
          { timeoutMs: 30_000 },
        );
        return { result, entityId: result.id };
      },
    );
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /**
   * Apply an inspection outcome to the individual fabric rolls of a line.
   *
   * The invariant being protected is that, for every (material, lot, location),
   * the sum of roll lengths equals the ledger balance. Moving whole rolls when
   * only part of the delivery was rejected would break it silently, so a
   * partial rejection must say which roll the bad length came off, and the roll
   * is physically split to match.
   */
  private async applyRollInspection(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      receiptLineId: string;
      targetLocationId: string;
      rejectedLocationId: string;
      rejectedQty: Decimal;
      rollDecisions: readonly { fabricRollId: string; rejectedLength: string }[];
      grnNo: string;
      lineNo: number;
    },
  ): Promise<void> {
    const rolls = await tx.fabricRoll.findMany({ where: { receiptLineId: input.receiptLineId } });
    if (rolls.length === 0) return;

    if (input.rejectedQty.greaterThan(0)) {
      const declared = input.rollDecisions.reduce<Decimal>(
        (acc, d) => acc.plus(qty(d.rejectedLength)),
        new Decimal(0),
      );
      if (!qty(declared).equals(input.rejectedQty)) {
        throw new BadRequestException({
          code: 'ROLL_REJECTION_NOT_ALLOCATED',
          message:
            'This line was received as individual fabric rolls, so the rejected length must be allocated across specific rolls',
          details: {
            grnNo: input.grnNo,
            lineNo: input.lineNo,
            rejectedQty: input.rejectedQty.toFixed(),
            allocatedQty: qty(declared).toFixed(),
            rollCount: rolls.length,
          },
        });
      }
    }

    const rejectionByRoll = new Map(
      input.rollDecisions.map((d) => [d.fabricRollId, qty(d.rejectedLength)]),
    );

    for (const [rollId] of rejectionByRoll) {
      if (!rolls.some((r) => r.id === rollId)) {
        throw new BadRequestException({
          code: 'ROLL_NOT_ON_LINE',
          message: 'A roll named in the inspection does not belong to this receipt line',
          details: { fabricRollId: rollId, grnNo: input.grnNo, lineNo: input.lineNo },
        });
      }
    }

    const rejectedNumbers = rejectionByRoll.size
      ? await this.numbering.nextBatch(tx, input.organizationId, DOC_SCOPES.FABRIC_ROLL, rejectionByRoll.size)
      : [];
    let rejectedIdx = 0;

    for (const roll of rolls) {
      const rejectLength = rejectionByRoll.get(roll.id) ?? new Decimal(0);
      const original = qty(roll.originalLength.toFixed());

      if (rejectLength.lessThanOrEqualTo(0)) {
        // Wholly accepted.
        await tx.fabricRoll.update({
          where: { id: roll.id },
          data: {
            locationId: input.targetLocationId,
            status: 'AVAILABLE',
            qcStatus: 'PASS',
            version: { increment: 1 },
          },
        });
        continue;
      }

      if (rejectLength.greaterThan(original)) {
        throw new BadRequestException({
          code: 'ROLL_REJECTION_EXCEEDS_LENGTH',
          message: 'Rejected length exceeds the length of that roll',
          details: {
            fabricRollId: roll.id,
            rollNo: roll.rollNo,
            rejectedLength: rejectLength.toFixed(),
            rollLength: original.toFixed(),
          },
        });
      }

      if (rejectLength.equals(original)) {
        // The whole roll is rejected: no split needed.
        await tx.fabricRoll.update({
          where: { id: roll.id },
          data: {
            locationId: input.rejectedLocationId,
            status: 'BLOCKED',
            qcStatus: 'FAIL',
            version: { increment: 1 },
          },
        });
        continue;
      }

      // Partial rejection: the bad length is cut off, so the accepted roll
      // shrinks and the offcut becomes its own barcoded roll in the rejected
      // location. Both lengths together still equal what was received.
      const keep = qty(original.minus(rejectLength));
      await tx.fabricRoll.update({
        where: { id: roll.id },
        data: {
          originalLength: new Prisma.Decimal(keep.toFixed()),
          currentLength: new Prisma.Decimal(keep.toFixed()),
          locationId: input.targetLocationId,
          status: 'AVAILABLE',
          qcStatus: 'PASS',
          version: { increment: 1 },
        },
      });

      const rejectedRollNo = `${rejectedNumbers[rejectedIdx] ?? roll.rollNo}-REJ`;
      rejectedIdx += 1;

      const offcut = await tx.fabricRoll.create({
        data: {
          organizationId: input.organizationId,
          rollNo: rejectedRollNo,
          rawMaterialId: roll.rawMaterialId,
          materialLotId: roll.materialLotId,
          locationId: input.rejectedLocationId,
          supplierId: roll.supplierId,
          receiptLineId: roll.receiptLineId,
          shade: roll.shade,
          color: roll.color,
          width: roll.width,
          gsm: roll.gsm,
          originalLength: new Prisma.Decimal(rejectLength.toFixed()),
          currentLength: new Prisma.Decimal(rejectLength.toFixed()),
          lengthUom: roll.lengthUom,
          purchaseRate: roll.purchaseRate,
          status: 'BLOCKED',
          qcStatus: 'FAIL',
          defectNotes: `Offcut rejected at incoming inspection of ${input.grnNo}, from roll ${roll.rollNo}`,
          receivedAt: roll.receivedAt,
        },
        select: { id: true, rollNo: true },
      });

      const { buildRollCode } = await import('@dnd/domain');
      await tx.barcodeIdentifier.create({
        data: {
          organizationId: input.organizationId,
          code: buildRollCode(offcut.rollNo),
          kind: 'FABRIC_ROLL',
          fabricRollId: offcut.id,
          labelData: {
            rollNo: offcut.rollNo,
            length: rejectLength.toFixed(),
            status: 'REJECTED',
            parentRollNo: roll.rollNo,
          },
        },
      });
    }
  }

  /**
   * Recompute a PO's status from its lines.
   * Never closes the order: RECEIVED means every line is satisfied within the
   * agreed under-receipt tolerance, and anything short stays
   * PARTIALLY_RECEIVED until a buyer closes it explicitly.
   */
  private async refreshPoStatus(tx: Prisma.TransactionClient, purchaseOrderId: string): Promise<void> {
    const po = await tx.rawMaterialPurchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { items: true },
    });
    if (['CLOSED', 'CANCELLED'].includes(po.status)) return;

    const assessment = assessPoClosure(
      po.items.map((i) => ({
        id: i.id, lineNo: i.lineNo, rawMaterialId: i.rawMaterialId,
        orderedBaseQty: i.orderedBaseQty.toFixed(),
        receivedBaseQty: i.receivedBaseQty.toFixed(),
        acceptedBaseQty: i.acceptedBaseQty.toFixed(),
        rejectedBaseQty: i.rejectedBaseQty.toFixed(),
      })),
      {
        overReceiptTolerancePct: po.overReceiptTolerancePct.toFixed(),
        underReceiptTolerancePct: po.underReceiptTolerancePct.toFixed(),
      },
    );

    if (assessment.status !== po.status && assessment.status !== 'APPROVED') {
      await tx.rawMaterialPurchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: assessment.status },
      });
    }
  }

  private async loadConverter(tx: Prisma.TransactionClient, organizationId: string): Promise<UomConverter> {
    const rules = await tx.uomConversion.findMany({
      where: { organizationId },
      select: { rawMaterialId: true, fromUom: true, toUom: true, factor: true },
    });
    return new UomConverter(
      rules.map((r) => ({
        rawMaterialId: r.rawMaterialId,
        fromUom: r.fromUom as UomCode,
        toUom: r.toUom as UomCode,
        factor: r.factor.toFixed(),
      })),
    );
  }
}
