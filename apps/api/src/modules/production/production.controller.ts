import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  batchListQuery, createBatchesRequest, forwardStageRequest, recordScanRequest,
  releaseBatchRequest, resolveScanRequest, returnFromReworkRequest, scanHistoryQuery,
  splitBatchRequest, stageOutcomeRequest, stageTaskListQuery, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { ProductionService } from './production.service';

const sendToReworkRequest = returnFromReworkRequest
  .omit({ returnQty: true })
  .extend({ reworkQty: returnFromReworkRequest.shape.returnQty });

@ApiTags('Production')
@Controller('production')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  // --- master data --------------------------------------------------------

  @Get('stages')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'Configured production stages, in route order' })
  listStages(@OrgId() orgId: string) {
    return this.production.listStages(orgId);
  }

  @Get('routes')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'Production routes with their ordered steps' })
  listRoutes(@OrgId() orgId: string) {
    return this.production.listRoutes(orgId);
  }

  // --- batches ------------------------------------------------------------

  @Get('batches')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'List production batches with their route progress' })
  @ApiZodQuery(batchListQuery)
  listBatches(@OrgId() orgId: string, @ZodQuery(batchListQuery) query: z.infer<typeof batchListQuery>) {
    return this.production.listBatches(orgId, query);
  }

  @Get('batches/:id')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({
    summary: 'One batch: every route step, its counters and its movement history',
    description:
      'Stage quantities are never summed. Cutting 100, stitching 85 and finishing 60 means 60 garments exist and work is in progress, not 245.',
  })
  getBatch(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.production.getBatch(orgId, id);
  }

  @Post('batches')
  @RequirePermissions('manufacturing.split')
  @ApiOperation({
    summary: 'Create production batches for a released order',
    description:
      'Batches are created explicitly rather than at release, because a batch is a physical bundle whose size is a floor decision. Omitting the list creates one batch per order line for its unbatched released quantity.',
  })
  @ApiZodBody(createBatchesRequest)
  createBatches(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createBatchesRequest) body: z.infer<typeof createBatchesRequest>,
  ) {
    return this.production.createBatches(orgId, user.id, body);
  }

  @Post('batches/:id/split')
  @RequirePermissions('manufacturing.split')
  @ApiOperation({
    summary: 'Split a batch that has not yet entered the route',
    description:
      'Refused once quantity has been released into the route: garments at a stage are in a physical bundle, and splitting them on paper would make the records disagree with the floor.',
  })
  @ApiZodBody(splitBatchRequest)
  splitBatch(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(splitBatchRequest) body: z.infer<typeof splitBatchRequest>,
  ) {
    return this.production.splitBatch(orgId, user.id, id, body);
  }

  @Post('batches/:id/release')
  @RequirePermissions('production.record_stage')
  @ApiOperation({ summary: 'Put quantity into the first step of the route' })
  @ApiZodBody(releaseBatchRequest)
  releaseIntoRoute(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(releaseBatchRequest) body: z.infer<typeof releaseBatchRequest>,
  ) {
    return this.production.releaseIntoRoute(orgId, user.id, id, body);
  }

  // --- stage transitions --------------------------------------------------

  @Get('stage-tasks')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'Route steps, filterable to those holding work in progress' })
  @ApiZodQuery(stageTaskListQuery)
  listStageTasks(
    @OrgId() orgId: string,
    @ZodQuery(stageTaskListQuery) query: z.infer<typeof stageTaskListQuery>,
  ) {
    return this.production.listStageTasks(orgId, query);
  }

  @Post('stage-tasks/:id/outcome')
  @RequirePermissions('production.record_stage')
  @ApiOperation({
    summary: 'Record what a stage did with the garments it holds',
    description:
      'Bounded by the stage’s own work in progress, so a second identical submission fails rather than silently doubling the numbers.',
  })
  @ApiZodBody(stageOutcomeRequest)
  recordOutcome(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(stageOutcomeRequest) body: z.infer<typeof stageOutcomeRequest>,
  ) {
    return this.production.recordOutcome(orgId, user.id, id, body);
  }

  @Post('stage-tasks/:id/forward')
  @RequirePermissions('production.record_stage')
  @ApiOperation({
    summary: 'Hand accepted quantity to the next route step',
    description:
      'Capped at what the stage has completed and not yet forwarded. Skipping a step needs production.override_stage and a written reason.',
  })
  @ApiZodBody(forwardStageRequest)
  forward(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(forwardStageRequest) body: z.infer<typeof forwardStageRequest>,
  ) {
    return this.production.forward(orgId, user, id, body);
  }

  @Post('stage-tasks/:id/rework/send')
  @RequirePermissions('production.record_stage')
  @ApiOperation({ summary: 'Send work in progress out to rework' })
  @ApiZodBody(sendToReworkRequest)
  sendToRework(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(sendToReworkRequest) body: z.infer<typeof sendToReworkRequest>,
  ) {
    return this.production.sendToRework(orgId, user.id, id, body);
  }

  @Post('stage-tasks/:id/rework/return')
  @RequirePermissions('production.record_stage')
  @ApiOperation({
    summary: 'Bring reworked quantity back to the stage it left',
    description:
      'The counters are cumulative, so a garment reworked twice is still one garment.',
  })
  @ApiZodBody(returnFromReworkRequest)
  returnFromRework(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(returnFromReworkRequest) body: z.infer<typeof returnFromReworkRequest>,
  ) {
    return this.production.returnFromRework(orgId, user.id, id, body);
  }

  // --- scanning -----------------------------------------------------------

  @Post('scan/resolve')
  @RequirePermissions('production.scan')
  @ApiOperation({
    summary: 'What is this code, and what can be done with it here?',
    description:
      'Read-only. The scan station looks a code up and shows what it found before asking for a quantity, because a scan that silently does the wrong thing to the wrong batch is far harder to unpick than one that asks.',
  })
  @ApiZodBody(resolveScanRequest)
  resolveScan(
    @OrgId() orgId: string,
    @ZodBody(resolveScanRequest) body: z.infer<typeof resolveScanRequest>,
  ) {
    return this.production.resolveScan(orgId, body.code, body.productionStageId);
  }

  @Post('scan')
  @RequirePermissions('production.scan')
  @ApiOperation({
    summary: 'Record a scan and apply the transition it represents',
    description:
      'The idempotency key is generated on the device at the moment of the physical scan, so a replay from the offline queue is provably the same event. A refused scan is still recorded: five rejected scans at one station is a label or training problem, and it is invisible if only successes are stored.',
  })
  @ApiZodBody(recordScanRequest)
  recordScan(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(recordScanRequest) body: z.infer<typeof recordScanRequest>,
  ) {
    return this.production.recordScan(orgId, user, body);
  }

  @Get('scans')
  @RequirePermissions('production.scan')
  @ApiOperation({ summary: 'Scan history, accepted and refused' })
  @ApiZodQuery(scanHistoryQuery)
  listScans(@OrgId() orgId: string, @ZodQuery(scanHistoryQuery) query: z.infer<typeof scanHistoryQuery>) {
    return this.production.listScans(orgId, query);
  }
}
