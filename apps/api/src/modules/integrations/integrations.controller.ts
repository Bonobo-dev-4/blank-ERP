import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { importShopifyOrdersRequest, shopifyOrderListQuery, type AuthenticatedUser } from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { ShopifyService } from './shopify.service';
import { ShopifyProductService } from './shopify-product.service';

@ApiTags('Integrations')
@Controller('integrations/shopify')
export class IntegrationsController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly shopifyProducts: ShopifyProductService,
  ) {}

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

  @Post('products/import')
  @RequirePermissions('products.import')
  @ApiOperation({
    summary: 'Pull the catalogue from Shopify',
    description:
      'Shopify is where a garment is created, so the ERP mirrors it rather than keeping a second catalogue in step by hand. Every variant gets an external mapping, which is what makes an imported ORDER line resolve to a real product.',
  })
  importProducts(
    @OrgId() orgId: string,
    @Body() body: { idempotencyKey: string; limit?: number; activeOnly?: boolean },
  ) {
    return this.shopifyProducts.importProducts(orgId, body);
  }

  @Post('products/relink-orders')
  @RequirePermissions('products.manage_mappings')
  @ApiOperation({
    summary: 'Attach already-imported order lines to products',
    description:
      'Order lines imported before the catalogue existed sit unmapped and nothing else goes back to fix them. Matched on SKU, which Shopify and Unicommerce share.',
  })
  relinkOrders(@OrgId() orgId: string) {
    return this.shopifyProducts.relinkOrderLines(orgId);
  }

  @Get('orders/:id')
  @RequirePermissions('demand.read')
  @ApiOperation({
    summary: 'One order, with every line and where it has got to',
    description:
      'What was bought, what is still owed, and how far production has taken it — the three questions an operator asks in sequence, on one screen. Stage figures are per stage and never summed.',
  })
  getOrder(@OrgId() orgId: string, @Param('id') id: string) {
    return this.shopify.getOrder(orgId, id);
  }
}
