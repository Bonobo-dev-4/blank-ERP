import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import type { AuthenticatedUser } from '@dnd/contracts';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { SyncService } from './sync.service';

@ApiTags('Sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('push/backlog')
  @RequirePermissions('sync.read')
  @ApiOperation({
    summary: 'Stock waiting to be pushed externally',
    description:
      'Reports why the push cannot run as prominently as what it would send. There is no execute endpoint: the transport refuses write paths, and enabling it is a reviewed change rather than a flag.',
  })
  backlog(@OrgId() orgId: string) {
    return this.sync.pushBacklog(orgId);
  }

  @Get('reconciliation')
  @RequirePermissions('sync.reconcile')
  @ApiOperation({
    summary: 'Compare internal stock against Unicommerce',
    description:
      'Read-only, and available today. A facility that cannot be read is reported as unreadable rather than as zero, because treating the two alike would invent a variance.',
  })
  @ApiQuery({ name: 'facilityCode', required: false })
  @ApiQuery({ name: 'limit', required: false })
  reconciliation(
    @OrgId() orgId: string,
    @Query('facilityCode') facilityCode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sync.reconciliation(orgId, { facilityCode, limit: Number(limit) || 25 });
  }

  @Post('orders/resync')
  @RequirePermissions('demand.import')
  @ApiOperation({
    summary: 'Refresh order state from Shopify and Unicommerce',
    description:
      'Re-imports Shopify orders changed since the newest version held (overlap is safe: the stale-version guard refuses older copies), and carries Unicommerce statuses onto ours, matched by order number. One side failing does not stop the other.',
  })
  resyncOrders(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sync.resyncOrders(orgId, user.id);
  }
}
