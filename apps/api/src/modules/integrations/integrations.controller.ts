import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  demandChannel, importShopifyOrdersRequest, refreshShopifyOrderDetailsRequest, shopifyOrderListQuery,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { ShopifyService, type OrderViewer } from './shopify.service';
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
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(shopifyOrderListQuery) query: z.infer<typeof shopifyOrderListQuery>,
  ) {
    return this.shopify.listOrders(orgId, query, orderViewer(user));
  }

  @Post('orders/refresh-details')
  @RequirePermissions('demand.import')
  @ApiOperation({
    summary: 'Fill in detail for orders imported before it was collected',
    description:
      'Re-reads, by id, orders that have no price breakdown yet — newest first, `limit` per call — and reports how many remain. Touches only orders already in the ERP. Read-only against Shopify.',
  })
  @ApiZodBody(refreshShopifyOrderDetailsRequest)
  refreshOrderDetails(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(refreshShopifyOrderDetailsRequest) body: z.infer<typeof refreshShopifyOrderDetailsRequest>,
  ) {
    return this.shopify.refreshOrderDetails(orgId, user.id, body.limit);
  }

  @Post('orders/:id/refresh')
  @RequirePermissions('demand.import')
  @ApiOperation({
    summary: 'Re-read one order from Shopify',
    description: 'Fetches the current version of this order by id and stores it. Read-only against Shopify.',
  })
  async refreshOrder(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const order = await this.shopify.getOrder(orgId, id);
    const result = await this.shopify.refreshOrders(orgId, user.id, [order.shopify.orderId]);
    return { ...result, order: await this.shopify.getOrder(orgId, order.id, orderViewer(user)) };
  }

  // Declared before `orders/:id`, so "facets" is never read as an order id.
  @Get('orders/facets')
  @RequirePermissions('demand.read')
  @ApiOperation({ summary: 'Filter values for the order list, with counts' })
  orderFacets(@OrgId() orgId: string, @Query('channel') channel?: string) {
    const parsed = channel ? demandChannel.safeParse(channel) : null;
    return this.shopify.orderFacets(orgId, parsed?.success ? parsed.data : undefined);
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
      'What was bought, what is still owed, and how far production has taken it — the three questions an operator asks in sequence, on one screen. Stage figures are per stage and never summed. Includes the Shopify product and variant ids per line, the price breakdown and tracking; the customer, contact and addresses only with demand.view_customer.',
  })
  getOrder(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.shopify.getOrder(orgId, id, orderViewer(user));
  }
}

/** Contact details and addresses are personal data, behind their own grant. */
function orderViewer(user: AuthenticatedUser): OrderViewer {
  return { canSeeCustomer: user.permissions.includes('demand.view_customer') };
}
