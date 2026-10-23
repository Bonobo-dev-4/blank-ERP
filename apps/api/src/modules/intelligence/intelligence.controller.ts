import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { ForecastMethod } from '@dnd/domain';
import { RequirePermissions } from '../../common/auth/guards';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { IntelligenceService } from './intelligence.service';

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

@ApiTags('Intelligence')
@Controller('intelligence')
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get('forecast')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'Sales velocity and demand forecast per SKU',
    description:
      'Rule-based, from imported Shopify history. Demand is net of cancellation and refund — forecasting from gross ordered quantity would forecast returns as demand. Nothing is persisted.',
  })
  @ApiQuery({ name: 'lookbackDays', required: false })
  @ApiQuery({ name: 'horizonDays', required: false })
  @ApiQuery({ name: 'method', required: false, enum: ['WEIGHTED_VELOCITY', 'MOVING_AVERAGE'] })
  forecast(
    @OrgId() orgId: string,
    @Query('lookbackDays') lookbackDays?: string,
    @Query('horizonDays') horizonDays?: string,
    @Query('method') method?: string,
  ) {
    return this.intelligence.forecast(orgId, {
      lookbackDays: num(lookbackDays, 56),
      horizonDays: num(horizonDays, 30),
      method: (method as ForecastMethod) || undefined,
    });
  }

  @Get('replenishment')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'Raw material replenishment suggestions',
    description:
      'Velocity from what production consumed, not from sales — a garment sold today was cut weeks ago. Confirmed incoming quantity on open purchase orders is subtracted so nothing is ordered twice.',
  })
  @ApiQuery({ name: 'lookbackDays', required: false })
  @ApiQuery({ name: 'safetyStockDays', required: false })
  replenishment(
    @OrgId() orgId: string,
    @Query('lookbackDays') lookbackDays?: string,
    @Query('safetyStockDays') safetyStockDays?: string,
  ) {
    return this.intelligence.replenishment(orgId, {
      lookbackDays: num(lookbackDays, 56),
      safetyStockDays: Number(safetyStockDays) || 0,
    });
  }
}
