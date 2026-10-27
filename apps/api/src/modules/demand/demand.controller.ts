import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DemandChannel, DemandStatus, Priority } from '@prisma/client';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { DEMAND_SORT_KEYS, DemandService } from './demand.service';

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
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Demand number, SKU or product name' })
  @ApiQuery({ name: 'mapped', required: false, description: 'true or false' })
  @ApiQuery({ name: 'sortBy', required: false, enum: DEMAND_SORT_KEYS })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  list(
    @OrgId() orgId: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
    @Query('mapped') mapped?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // Enum values are checked here: an unknown status must be a 400 with a
    // reason, not a database error.
    const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], name: string): T | undefined => {
      if (!v) return undefined;
      if (!(allowed as readonly string[]).includes(v)) {
        throw new BadRequestException({ code: 'INVALID_FILTER', message: `Unknown ${name}: ${v}` });
      }
      return v as T;
    };
    return this.demand.list(orgId, {
      status: oneOf(status, Object.values(DemandStatus), 'status'),
      channel: oneOf(channel, Object.values(DemandChannel), 'channel'),
      priority: oneOf(priority, Object.values(Priority), 'priority'),
      search: search?.slice(0, 200) || undefined,
      mapped: mapped === 'true' ? true : mapped === 'false' ? false : undefined,
      sortBy: oneOf(sortBy, DEMAND_SORT_KEYS, 'sort column'),
      sortDir: sortDir === 'desc' ? 'desc' : 'asc',
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
