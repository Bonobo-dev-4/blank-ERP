import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  mrpRunListQuery, requisitionFromMrpRequest, runMrpRequest, shortageListQuery,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { MrpService } from './mrp.service';

@ApiTags('Material Requirement Planning')
@Controller('mrp')
export class MrpController {
  constructor(private readonly mrp: MrpService) {}

  @Get('runs')
  @RequirePermissions('mrp.run')
  @ApiOperation({ summary: 'List MRP runs' })
  @ApiZodQuery(mrpRunListQuery)
  listRuns(@OrgId() orgId: string, @ZodQuery(mrpRunListQuery) query: z.infer<typeof mrpRunListQuery>) {
    return this.mrp.listRuns(orgId, query);
  }

  @Get('runs/:id')
  @RequirePermissions('mrp.run')
  @ApiOperation({
    summary: 'One MRP run with its aggregated requirement lines',
    description:
      'A run is a snapshot with a timestamp, not a live view: requisitions are raised from it, and those quantities must still mean something when someone approves them an hour later.',
  })
  getRun(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.mrp.getRun(orgId, id);
  }

  @Post('runs')
  @RequirePermissions('mrp.run')
  @ApiOperation({
    summary: 'Run material requirement planning',
    description:
      'Plans either existing manufacturing orders or an ad-hoc quantity. Open purchase orders are reported as incoming supply with their expected date, never counted as stock.',
  })
  @ApiZodBody(runMrpRequest)
  run(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(runMrpRequest) body: z.infer<typeof runMrpRequest>,
  ) {
    return this.mrp.run(orgId, user.id, body);
  }

  @Get('shortages')
  @RequirePermissions('mrp.run')
  @ApiOperation({ summary: 'Material shortages across completed runs' })
  @ApiZodQuery(shortageListQuery)
  listShortages(
    @OrgId() orgId: string,
    @ZodQuery(shortageListQuery) query: z.infer<typeof shortageListQuery>,
  ) {
    return this.mrp.listShortages(orgId, query);
  }

  @Post('requisitions')
  @RequirePermissions('purchasing.write_requisition')
  @ApiOperation({
    summary: 'Raise a purchase requisition from MRP suggestions',
    description:
      'Quantities are taken from the request rather than recomputed, so a suggestion a planner adjusted is the one that gets raised.',
  })
  @ApiZodBody(requisitionFromMrpRequest)
  createRequisition(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(requisitionFromMrpRequest) body: z.infer<typeof requisitionFromMrpRequest>,
  ) {
    return this.mrp.createRequisitionFromRun(orgId, user.id, body);
  }
}
