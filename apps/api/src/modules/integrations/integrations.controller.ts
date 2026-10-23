import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { importShopifyOrdersRequest, shopifyOrderListQuery, type AuthenticatedUser } from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { ShopifyService } from './shopify.service';

@ApiTags('Integrations')
@Controller('integrations/shopify')
export class IntegrationsController {
  constructor(private readonly shopify: ShopifyService) {}

  @Get('status')
  @RequirePermissions('admin.manage_integrations')
  @ApiOperation({
    summary: 'Shopify configuration status',
    description: 'Reports whether the connector is configured and what is missing. Never reveals the token.',
  })
  status() {
    return this.shopify.status();
  }

  @Post('verify')
  @RequirePermissions('admin.manage_integrations')
  @ApiOperation({
    summary: 'Probe the live store',
    description:
      'Answers what the schema cannot: which sourceName values this shop emits, whether the token can read orders and historical orders, and what the plan’s rate budget is. Read-only.',
  })
  verify(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shopify.verify(orgId, user.id);
  }

  @Post('orders/import')
  @RequirePermissions('demand.import')
  @ApiOperation({
    summary: 'Import orders updated since the last run',
    description:
      'Incremental by updatedAt, with a stale-version guard: Shopify delivers updates out of order, and an older version overwriting a newer one would resurrect cancelled lines. Read-only — this connector cannot write to Shopify.',
  })
  @ApiZodBody(importShopifyOrdersRequest)
  importOrders(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(importShopifyOrdersRequest) body: z.infer<typeof importShopifyOrdersRequest>,
  ) {
    return this.shopify.importOrders(orgId, user.id, body);
  }

  @Get('orders')
  @RequirePermissions('demand.read')
  @ApiOperation({ summary: 'Imported Shopify orders with their derived demand' })
  @ApiZodQuery(shopifyOrderListQuery)
  listOrders(
    @OrgId() orgId: string,
    @ZodQuery(shopifyOrderListQuery) query: z.infer<typeof shopifyOrderListQuery>,
  ) {
    return this.shopify.listOrders(orgId, query);
  }
}
