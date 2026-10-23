import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@dnd/contracts';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { FulfilmentService } from './fulfilment.service';

@ApiTags('Fulfilment')
@Controller('fulfilment')
export class FulfilmentController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Get('board')
  @RequirePermissions('demand.read')
  @ApiOperation({
    summary: 'Route every open demand line',
    description:
      'Buckets demand into dispatch, switch facility, manufacture, or needs-check. Stock is read one call PER FACILITY rather than per SKU, so the whole board costs about seventeen calls however many lines it holds.',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skipStockCheck', required: false, description: 'Skip Unicommerce entirely — fast, and marks the search incomplete.' })
  @ApiQuery({ name: 'facilities', required: false, description: 'Comma-separated codes. Narrowing makes the search incomplete by definition.' })
  board(
    @OrgId() orgId: string,
    @Query('limit') limit?: string,
    @Query('skipStockCheck') skipStockCheck?: string,
    @Query('facilities') facilities?: string,
  ) {
    return this.fulfilment.board(orgId, {
      limit: Number(limit) || 200,
      skipStockCheck: skipStockCheck === 'true',
      facilities: facilities?.split(',').map((f) => f.trim()).filter(Boolean),
    });
  }

  @Post('demand/:id/reject')
  @RequirePermissions('demand.approve')
  @ApiOperation({
    summary: 'Send a dispatchable line to production anyway',
    description:
      'Overrides available stock, so a reason is required — a rejection with no reason is indistinguishable from a misclick, and this one costs weeks of production.',
  })
  reject(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.fulfilment.reject(orgId, user.id, id, body?.reason ?? '');
  }

  @Post('demand/:id/unreject')
  @RequirePermissions('demand.approve')
  @ApiOperation({ summary: 'Undo a rejection, putting the line back under the stock arithmetic' })
  unreject(@OrgId() orgId: string, @Param('id') id: string) {
    return this.fulfilment.unreject(orgId, id);
  }
}
