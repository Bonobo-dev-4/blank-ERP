import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { DemandService } from './demand.service';

@ApiTags('Demand')
@Controller('demand')
export class DemandController {
  constructor(private readonly demand: DemandService) {}

  @Get()
  @RequirePermissions('demand.read')
  @ApiOperation({
    summary: 'Manufacturing demand',
    description:
      'What the factory is being asked to make, deduplicated by what the demand IS rather than by the document it arrived in.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'channel', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  list(
    @OrgId() orgId: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.demand.list(orgId, {
      status, channel,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
    });
  }

  @Post('promote/shopify')
  @RequirePermissions('demand.import')
  @ApiOperation({
    summary: 'Promote imported Shopify lines into demand',
    description:
      'Explicit, not a side effect of import: an order line records what a customer bought, demand is a decision about what to make. Only lines that still owe the customer something are promoted, and the same economic demand arriving from two systems collapses onto one row.',
  })
  promote(
    @OrgId() orgId: string,
    @Body() body: { idempotencyKey: string; since?: string; limit?: number },
  ) {
    return this.demand.promoteShopifyOrders(orgId, body);
  }
}
