import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('inventory.read')
  @ApiOperation({
    summary: 'Live operational figures',
    description:
      'Every figure is a real aggregate. Sections for modules that are not built yet report available:false with the phase they are due in.',
  })
  summary(@OrgId() orgId: string) {
    return this.dashboard.summary(orgId);
  }
}
