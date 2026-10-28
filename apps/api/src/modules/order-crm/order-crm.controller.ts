import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setCrmRemarksRequest, setDispatchDateRequest, setOrderPriorityRequest, useShopifyDispatchDateRequest,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ZodBody } from '../../common/zod/zod.decorators';
import { OrderCrmService } from './order-crm.service';

@ApiTags('Order CRM')
@Controller()
export class OrderCrmController {
  constructor(private readonly crm: OrderCrmService) {}

  @Patch('orders/:id/dispatch-date')
  @RequirePermissions('demand.manage_crm')
  @ApiOperation({
    summary: 'Set, change or clear the expected dispatch date',
    description: 'A CRM date locks the order against Shopify sync. Changing or clearing an existing date needs a reason. Updates the needed-by date of linked manufacturing demand.',
  })
  @ApiZodBody(setDispatchDateRequest)
  setDispatchDate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(setDispatchDateRequest) body: z.infer<typeof setDispatchDateRequest>,
  ) {
    return this.crm.setDispatchDate(user, id, body);
  }

  @Post('orders/:id/dispatch-date/use-shopify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('demand.manage_crm')
  @ApiOperation({ summary: "Return the dispatch date to Shopify's: unlock, and take what Shopify says now" })
  @ApiZodBody(useShopifyDispatchDateRequest)
  useShopify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(useShopifyDispatchDateRequest) body: z.infer<typeof useShopifyDispatchDateRequest>,
  ) {
    return this.crm.useShopifyDate(user, id, body.reason);
  }

  @Patch('orders/:id/priority')
  @RequirePermissions('demand.manage_crm')
  @ApiOperation({ summary: 'Set the CRM priority: VIP, HIGH, MEDIUM or NORMAL' })
  @ApiZodBody(setOrderPriorityRequest)
  setPriority(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(setOrderPriorityRequest) body: z.infer<typeof setOrderPriorityRequest>,
  ) {
    return this.crm.setPriority(user, id, body);
  }

  @Patch('orders/:id/crm-remarks')
  @RequirePermissions('demand.manage_crm')
  @ApiOperation({ summary: 'Save CRM remarks on an order' })
  @ApiZodBody(setCrmRemarksRequest)
  setRemarks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(setCrmRemarksRequest) body: z.infer<typeof setCrmRemarksRequest>,
  ) {
    return this.crm.setRemarks(user, id, body.remarks);
  }

  @Get('orders/:id/crm-history')
  @RequirePermissions('demand.read')
  @ApiOperation({ summary: 'Every change to priority, dispatch date and remarks, newest first' })
  history(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.history(orgId, id);
  }

  @Post('order-crm/rescan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('demand.manage_crm')
  @ApiOperation({
    summary: 'Read dispatch dates and approved priorities again from stored Shopify data',
    description: 'No Shopify call. CRM-set dates and priorities are never changed.',
  })
  rescan(@CurrentUser() user: AuthenticatedUser) {
    return this.crm.rescan(user);
  }
}
