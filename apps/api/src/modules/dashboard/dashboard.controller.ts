import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

/** Ninety days is the longest window the trend charts offer. */
const MAX_TREND_DAYS = 92;

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('inventory.read')
  @ApiOperation({
    summary: 'Live operational figures',
    description: 'Every figure is a real aggregate over current rows.',
  })
  summary(@OrgId() orgId: string) {
    return this.dashboard.summary(orgId);
  }

  @Get('trends')
  @RequirePermissions('inventory.read')
  @ApiQuery({ name: 'days', required: false, description: '7, 30 or 90; ignored when from/to are given' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date, inclusive' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date, inclusive' })
  @ApiOperation({
    summary: 'Daily production and stock-movement history',
    description:
      'Bucketed by day in the organisation timezone, read from the immutable stage and material ledgers. Reports hasProductionHistory=false rather than drawing zeros as data.',
  })
  trends(
    @OrgId() orgId: string,
    @Query('days') days?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ) {
    let from: Date;
    let to: Date;
    if (fromRaw || toRaw) {
      from = new Date(fromRaw ?? '');
      to = new Date(toRaw ?? '');
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException('from and to must both be valid dates');
      }
      // An inclusive "to" date means the whole of that day.
      if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw ?? '')) to = new Date(to.getTime() + 86_399_999);
    } else {
      const n = Number(days ?? 30);
      if (![7, 30, 90].includes(n)) throw new BadRequestException('days must be 7, 30 or 90');
      to = new Date();
      from = new Date(to.getTime() - (n - 1) * 86_400_000);
      from.setHours(0, 0, 0, 0);
    }
    if (from > to) throw new BadRequestException('from must be before to');
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_TREND_DAYS) {
      throw new BadRequestException(`The window can be at most ${MAX_TREND_DAYS} days`);
    }
    return this.dashboard.trends(orgId, from, to);
  }

  @Get('sync-pulse')
  @RequirePermissions('demand.read')
  @ApiOperation({
    summary: 'When each commerce system last synced',
    description: 'Newest imported Shopify order and newest Unicommerce status check. Read-only.',
  })
  syncPulse(@OrgId() orgId: string) {
    return this.dashboard.syncPulse(orgId);
  }
}
