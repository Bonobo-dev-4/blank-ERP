import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('production')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'Production throughput and loss',
    description:
      'Per-stage received, completed, rejected and outstanding rework, plus first-pass yield. Stage figures are never summed: a garment passes through every stage.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  production(@OrgId() orgId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.production(orgId, { from, to });
  }

  @Get('consumption')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'Material consumption against the frozen BOM',
    description:
      'Actual consumption and wastage per material, compared with the BOM snapshot taken at release rather than the live BOM.',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  consumption(@OrgId() orgId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.consumption(orgId, { from, to });
  }

  @Get('costing')
  @RequirePermissions('reports.view_costing')
  @ApiOperation({
    summary: 'Planned against actual cost per order',
    description:
      'Planned from the frozen BOM, actual from the ledger. Unit cost divides by ACCEPTED units, so rejected garments carry their own cost.',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  costing(@OrgId() orgId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.costing(orgId, { from, to });
  }

  @Get('job-workers')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'Job worker performance',
    description:
      'Counted from the stage tasks assigned to each worker, which is where the work happened — an order can be raised and never worked.',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  jobWorkers(@OrgId() orgId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.jobWorkers(orgId, { from, to });
  }
}
