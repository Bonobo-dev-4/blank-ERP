import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  completeCuttingRequest, createCuttingOrderRequest, createJobWorkOrderRequest,
  cuttingOrderListQuery, issueFabricRequest, jobWorkListQuery, receiveJobWorkRequest,
  serialiseBatchRequest, unitListQuery, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { CuttingService } from './cutting.service';

@ApiTags('Cutting and Job Work')
@Controller()
export class CuttingController {
  constructor(private readonly cutting: CuttingService) {}

  // --- cutting ------------------------------------------------------------

  @Get('cutting/orders')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'List cutting orders with their fabric position' })
  @ApiZodQuery(cuttingOrderListQuery)
  list(@OrgId() orgId: string, @ZodQuery(cuttingOrderListQuery) query: z.infer<typeof cuttingOrderListQuery>) {
    return this.cutting.listCuttingOrders(orgId, query);
  }

  @Get('cutting/orders/:id')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'One cutting order: plan, fabric issued, used, wasted and returned' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cutting.getCuttingOrder(orgId, id);
  }

  @Post('cutting/orders')
  @RequirePermissions('production.record_stage')
  @ApiOperation({ summary: 'Plan a cut against a production batch' })
  @ApiZodBody(createCuttingOrderRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createCuttingOrderRequest) body: z.infer<typeof createCuttingOrderRequest>,
  ) {
    return this.cutting.createCuttingOrder(orgId, user.id, body);
  }

  @Post('cutting/orders/:id/issue-fabric')
  @RequirePermissions('inventory.issue')
  @ApiOperation({
    summary: 'Issue fabric to the cutting table',
    description:
      'A TRANSFER, not a consumption: the owned quantity is unchanged, the fabric has simply moved to the cutting department. Only completing the cut retires it.',
  })
  @ApiZodBody(issueFabricRequest)
  issueFabric(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(issueFabricRequest) body: z.infer<typeof issueFabricRequest>,
  ) {
    return this.cutting.issueFabric(orgId, user.id, id, body);
  }

  @Post('cutting/orders/:id/complete')
  @RequirePermissions('inventory.consume')
  @ApiOperation({
    summary: 'Complete the cut and post its fabric consumption',
    description:
      'The one operation that retires fabric, and it happens exactly once per cutting order. Consumed plus wasted plus returned cannot exceed what was issued — a cutting table cannot consume fabric it was never given.',
  })
  @ApiZodBody(completeCuttingRequest)
  complete(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(completeCuttingRequest) body: z.infer<typeof completeCuttingRequest>,
  ) {
    return this.cutting.completeCutting(orgId, user.id, id, body);
  }

  // --- job work -----------------------------------------------------------

  @Get('job-work/workers')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'Active job workers' })
  listWorkers(@OrgId() orgId: string) {
    return this.cutting.listJobWorkers(orgId);
  }

  @Get('job-work/orders')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'List job work orders' })
  @ApiZodQuery(jobWorkListQuery)
  listJobWork(@OrgId() orgId: string, @ZodQuery(jobWorkListQuery) query: z.infer<typeof jobWorkListQuery>) {
    return this.cutting.listJobWorkOrders(orgId, query);
  }

  @Get('job-work/orders/:id')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'One job work order with its per-batch lines and charge' })
  getJobWork(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cutting.getJobWorkOrder(orgId, id);
  }

  @Post('job-work/orders')
  @RequirePermissions('production.assign')
  @ApiOperation({ summary: 'Send work out to a job worker' })
  @ApiZodBody(createJobWorkOrderRequest)
  createJobWork(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createJobWorkOrderRequest) body: z.infer<typeof createJobWorkOrderRequest>,
  ) {
    return this.cutting.createJobWorkOrder(orgId, user.id, body);
  }

  @Post('job-work/orders/:id/receive')
  @RequirePermissions('production.record_stage')
  @ApiOperation({
    summary: 'Receive work back from a job worker',
    description:
      'Moves the batch stage counters exactly as an in-house stage would, and charges on good pieces only — a worker who returns 90 good and 10 rejected is not paid for 100.',
  })
  @ApiZodBody(receiveJobWorkRequest)
  receiveJobWork(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(receiveJobWorkRequest) body: z.infer<typeof receiveJobWorkRequest>,
  ) {
    return this.cutting.receiveJobWork(orgId, user.id, id, body);
  }

  // --- unit serialisation -------------------------------------------------

  @Get('production/units')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'Serialised garments' })
  @ApiZodQuery(unitListQuery)
  listUnits(@OrgId() orgId: string, @ZodQuery(unitListQuery) query: z.infer<typeof unitListQuery>) {
    return this.cutting.listUnits(orgId, query);
  }

  @Post('production/batches/:id/serialise')
  @RequirePermissions('production.print_labels')
  @ApiOperation({
    summary: 'Give each garment in a batch its own barcode',
    description:
      'Worth doing only where a single garment has to be traceable on its own. For everything else the batch is the unit.',
  })
  @ApiZodBody(serialiseBatchRequest)
  serialise(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(serialiseBatchRequest) body: z.infer<typeof serialiseBatchRequest>,
  ) {
    return this.cutting.serialiseBatch(orgId, user.id, id, body);
  }
}
