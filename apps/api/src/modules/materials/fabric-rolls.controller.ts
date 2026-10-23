import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createFabricRollRequest, inspectionResult, rollIssueRequest, rollListQuery,
  rollReturnRequest, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { FabricRollsService } from './fabric-rolls.service';

const qcBody = z.object({
  result: z.enum(['PASS', 'FAIL']),
  notes: z.string().trim().max(1000).nullish(),
});

const suggestQuery = z.object({
  rawMaterialId: z.string().uuid(),
  requiredLength: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),
  shade: z.string().trim().max(80).optional(),
  minimumWidth: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(),
});

@ApiTags('Fabric Rolls')
@Controller('fabric-rolls')
export class FabricRollsController {
  constructor(private readonly rolls: FabricRollsService) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'List fabric rolls with their remaining length' })
  @ApiZodQuery(rollListQuery)
  list(@OrgId() orgId: string, @ZodQuery(rollListQuery) query: z.infer<typeof rollListQuery>) {
    return this.rolls.list(orgId, query);
  }

  @Get('suggest')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Suggest which rolls to open for a required length' })
  @ApiZodQuery(suggestQuery)
  suggest(@OrgId() orgId: string, @ZodQuery(suggestQuery) query: z.infer<typeof suggestQuery>) {
    return this.rolls.suggestForLength(orgId, query);
  }

  @Get('reconciliation')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Check roll lengths against the material ledger' })
  reconcile(@OrgId() orgId: string) {
    return this.rolls.reconcileRollLengths(orgId);
  }

  @Get(':id')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'One fabric roll with its full movement history' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rolls.get(orgId, id);
  }

  @Post()
  @RequirePermissions('inventory.manage_rolls')
  @ApiOperation({ summary: 'Register a fabric roll' })
  @ApiZodBody(createFabricRollRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createFabricRollRequest) body: z.infer<typeof createFabricRollRequest>,
  ) {
    return this.rolls.createStandalone(orgId, user.id, body);
  }

  @Post(':id/qc')
  @RequirePermissions('purchasing.inspect')
  @ApiOperation({ summary: 'Record the inspection result for a roll' })
  @ApiZodBody(qcBody)
  qc(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(qcBody) body: z.infer<typeof qcBody>,
  ) {
    return this.rolls.setQcResult(orgId, user.id, id, body.result, body.notes ?? null);
  }

  @Post('issue')
  @RequirePermissions('inventory.issue')
  @ApiOperation({ summary: 'Issue a length off a roll to production' })
  @ApiZodBody(rollIssueRequest)
  issue(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(rollIssueRequest) body: z.infer<typeof rollIssueRequest>,
  ) {
    return this.rolls.issue(orgId, user.id, body);
  }

  @Post('return')
  @RequirePermissions('inventory.return')
  @ApiOperation({ summary: 'Return unused fabric to a roll' })
  @ApiZodBody(rollReturnRequest)
  return(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(rollReturnRequest) body: z.infer<typeof rollReturnRequest>,
  ) {
    return this.rolls.returnToRoll(orgId, user.id, body);
  }
}

export { inspectionResult };
