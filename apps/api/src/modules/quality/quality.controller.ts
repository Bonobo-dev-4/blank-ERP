import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  closeReworkOrderRequest, createInspectionRequest, createReworkOrderRequest,
  inspectionListQuery, reworkListQuery, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { QualityService } from './quality.service';

@ApiTags('Quality')
@Controller('quality')
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Get('inspections')
  @RequirePermissions('quality.read')
  @ApiOperation({ summary: 'List quality inspections with their defects' })
  @ApiZodQuery(inspectionListQuery)
  listInspections(
    @OrgId() orgId: string,
    @ZodQuery(inspectionListQuery) query: z.infer<typeof inspectionListQuery>,
  ) {
    return this.quality.listInspections(orgId, query);
  }

  @Get('inspections/:id')
  @RequirePermissions('quality.read')
  @ApiOperation({ summary: 'One inspection, its checklist and its defects' })
  getInspection(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quality.getInspection(orgId, id);
  }

  @Post('inspections')
  @RequirePermissions('quality.inspect')
  @ApiOperation({
    summary: 'Record an inspection',
    description:
      'Passed, failed, rework and hold must add up to exactly the inspected quantity — a garment that was looked at has an outcome. The verdict moves the stage counters through the production service, so QC and the floor can never report different numbers for the same garments.',
  })
  @ApiZodBody(createInspectionRequest)
  createInspection(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createInspectionRequest) body: z.infer<typeof createInspectionRequest>,
  ) {
    return this.quality.createInspection(orgId, user.id, body);
  }

  @Get('rework')
  @RequirePermissions('quality.read')
  @ApiOperation({ summary: 'List rework tickets' })
  @ApiZodQuery(reworkListQuery)
  listRework(@OrgId() orgId: string, @ZodQuery(reworkListQuery) query: z.infer<typeof reworkListQuery>) {
    return this.quality.listReworkOrders(orgId, query);
  }

  @Post('rework')
  @RequirePermissions('quality.manage_rework')
  @ApiOperation({
    summary: 'Raise a rework ticket',
    description:
      'Covers quantity already recorded as rework at a stage, less whatever open tickets already claim. Two tickets cannot both claim to have fixed the same ten garments.',
  })
  @ApiZodBody(createReworkOrderRequest)
  createRework(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createReworkOrderRequest) body: z.infer<typeof createReworkOrderRequest>,
  ) {
    return this.quality.createReworkOrder(orgId, user.id, body);
  }

  @Post('rework/:id/close')
  @RequirePermissions('quality.manage_rework')
  @ApiOperation({
    summary: 'Close a rework ticket',
    description:
      'Completed garments return to the stage they left. Scrapped garments are rejected there instead, which closes the batch arithmetic rather than leaving quantity permanently out.',
  })
  @ApiZodBody(closeReworkOrderRequest)
  closeRework(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(closeReworkOrderRequest) body: z.infer<typeof closeReworkOrderRequest>,
  ) {
    return this.quality.closeReworkOrder(orgId, user.id, id, body);
  }
}
