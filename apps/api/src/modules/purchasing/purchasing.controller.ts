import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  approvePurchaseOrderRequest, approveRequisitionRequest, closePurchaseOrderRequest,
  createPurchaseOrderRequest, createReceiptRequest, createRequisitionRequest,
  inspectReceiptRequest, paginationQuery, purchaseOrderListQuery,
  receiptListQuery, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { PurchasingService } from './purchasing.service';

const requisitionListQuery = paginationQuery.extend({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED']).optional(),
});

@ApiTags('Purchasing')
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  // --- requisitions -------------------------------------------------------

  @Get('requisitions')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'List purchase requisitions' })
  @ApiZodQuery(requisitionListQuery)
  listRequisitions(
    @OrgId() orgId: string,
    @ZodQuery(requisitionListQuery) query: z.infer<typeof requisitionListQuery>,
  ) {
    return this.purchasing.listRequisitions(orgId, query);
  }

  @Post('requisitions')
  @RequirePermissions('purchasing.write_requisition')
  @ApiOperation({ summary: 'Raise a purchase requisition' })
  @ApiZodBody(createRequisitionRequest)
  createRequisition(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createRequisitionRequest) body: z.infer<typeof createRequisitionRequest>,
  ) {
    return this.purchasing.createRequisition(orgId, user.id, body);
  }

  @Post('requisitions/:id/decision')
  @RequirePermissions('purchasing.approve_requisition')
  @ApiOperation({ summary: 'Approve or reject a purchase requisition' })
  @ApiZodBody(approveRequisitionRequest)
  decideRequisition(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(approveRequisitionRequest) body: z.infer<typeof approveRequisitionRequest>,
  ) {
    return this.purchasing.decideRequisition(orgId, user.id, id, body);
  }

  // --- purchase orders ----------------------------------------------------

  @Get('orders')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'List raw material purchase orders' })
  @ApiZodQuery(purchaseOrderListQuery)
  listOrders(
    @OrgId() orgId: string,
    @ZodQuery(purchaseOrderListQuery) query: z.infer<typeof purchaseOrderListQuery>,
  ) {
    return this.purchasing.listPurchaseOrders(orgId, query);
  }

  @Get('orders/:id')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'One purchase order with receipts and closure assessment' })
  getOrder(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getPurchaseOrder(orgId, id);
  }

  @Post('orders')
  @RequirePermissions('purchasing.write_po')
  @ApiOperation({ summary: 'Create a raw material purchase order' })
  @ApiZodBody(createPurchaseOrderRequest)
  createOrder(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createPurchaseOrderRequest) body: z.infer<typeof createPurchaseOrderRequest>,
  ) {
    return this.purchasing.createPurchaseOrder(orgId, user.id, body);
  }

  @Post('orders/:id/decision')
  @RequirePermissions('purchasing.approve_po')
  @ApiOperation({ summary: 'Approve or reject a purchase order' })
  @ApiZodBody(approvePurchaseOrderRequest)
  decideOrder(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(approvePurchaseOrderRequest) body: z.infer<typeof approvePurchaseOrderRequest>,
  ) {
    return this.purchasing.decidePurchaseOrder(orgId, user.id, id, body);
  }

  @Post('orders/:id/close')
  @RequirePermissions('purchasing.close_po')
  @ApiOperation({
    summary: 'Close a purchase order short',
    description:
      'A purchase order is never closed automatically on a short delivery. Closing it abandons the outstanding quantity, so a reason is mandatory and the action is audited.',
  })
  @ApiZodBody(closePurchaseOrderRequest)
  closeOrder(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(closePurchaseOrderRequest) body: z.infer<typeof closePurchaseOrderRequest>,
  ) {
    return this.purchasing.closePurchaseOrder(orgId, user.id, id, body.reason);
  }

  // --- goods receipts -----------------------------------------------------

  @Get('receipts')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'List goods receipts' })
  @ApiZodQuery(receiptListQuery)
  listReceipts(
    @OrgId() orgId: string,
    @ZodQuery(receiptListQuery) query: z.infer<typeof receiptListQuery>,
  ) {
    return this.purchasing.listReceipts(orgId, query);
  }

  @Get('receipts/:id')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'One goods receipt with its lots and fabric rolls' })
  getReceipt(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getReceipt(orgId, id);
  }

  @Post('receipts')
  @RequirePermissions('purchasing.receive')
  @ApiOperation({
    summary: 'Record a goods receipt',
    description:
      'Creates lots and fabric roll barcodes, updates the purchase order, and posts the quantity into the QC hold location. Accepted stock only becomes issuable after inspection.',
  })
  @ApiZodBody(createReceiptRequest)
  createReceipt(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createReceiptRequest) body: z.infer<typeof createReceiptRequest>,
  ) {
    return this.purchasing.createReceipt(orgId, user.id, body);
  }

  @Post('receipts/:id/inspect')
  @RequirePermissions('purchasing.inspect')
  @ApiOperation({
    summary: 'Inspect a goods receipt and release accepted stock',
    description:
      'Accepted plus rejected quantity must equal exactly the quantity received on each line.',
  })
  @ApiZodBody(inspectReceiptRequest)
  inspectReceipt(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(inspectReceiptRequest) body: z.infer<typeof inspectReceiptRequest>,
  ) {
    return this.purchasing.inspectReceipt(orgId, user.id, id, body);
  }
}

