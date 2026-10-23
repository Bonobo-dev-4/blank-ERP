import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  balanceListQuery, materialConsumptionRequest, materialInwardRequest, materialIssueRequest,
  materialReturnRequest, materialTransferRequest, movementListQuery, stockAdjustmentRequest,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { InventoryService } from './inventory.service';

@ApiTags('Raw Material Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('balances')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Stock balances by material, lot and location' })
  @ApiZodQuery(balanceListQuery)
  balances(@OrgId() orgId: string, @ZodQuery(balanceListQuery) query: z.infer<typeof balanceListQuery>) {
    return this.inventory.listBalances(orgId, query);
  }

  @Get('movements')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'The immutable material movement ledger' })
  @ApiZodQuery(movementListQuery)
  movements(@OrgId() orgId: string, @ZodQuery(movementListQuery) query: z.infer<typeof movementListQuery>) {
    return this.inventory.listMovements(orgId, query);
  }

  @Get('alerts')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Live low-stock, minimum-stock and reorder-point alerts' })
  alerts(@OrgId() orgId: string) {
    return this.inventory.stockAlerts(orgId);
  }

  @Post('inward')
  @RequirePermissions('inventory.adjust')
  @ApiOperation({
    summary: 'Direct material inward (opening balances and corrections)',
    description:
      'Normal supplier deliveries must come through the goods receipt flow so they pass inspection first. This endpoint is for opening balances and authorised corrections, and requires an elevated permission.',
  })
  @ApiZodBody(materialInwardRequest)
  inward(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(materialInwardRequest) body: z.infer<typeof materialInwardRequest>,
  ) {
    return this.inventory.inward(orgId, user.id, body);
  }

  @Post('transfer')
  @RequirePermissions('inventory.transfer')
  @ApiOperation({ summary: 'Transfer stock between locations' })
  @ApiZodBody(materialTransferRequest)
  transfer(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(materialTransferRequest) body: z.infer<typeof materialTransferRequest>,
  ) {
    return this.inventory.transfer(orgId, user.id, body);
  }

  @Post('issue')
  @RequirePermissions('inventory.issue')
  @ApiOperation({
    summary: 'Issue material to production or a job worker',
    description:
      'Issuing moves stock between locations; it does not consume it. Owned quantity is unchanged until consumption is posted.',
  })
  @ApiZodBody(materialIssueRequest)
  issue(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(materialIssueRequest) body: z.infer<typeof materialIssueRequest>,
  ) {
    return this.inventory.issue(orgId, user.id, body);
  }

  @Post('return')
  @RequirePermissions('inventory.return')
  @ApiOperation({ summary: 'Return unconsumed material from production' })
  @ApiZodBody(materialReturnRequest)
  returnMaterial(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(materialReturnRequest) body: z.infer<typeof materialReturnRequest>,
  ) {
    return this.inventory.returnMaterial(orgId, user.id, body);
  }

  @Post('consume')
  @RequirePermissions('inventory.consume')
  @ApiOperation({
    summary: 'Post actual material consumption',
    description:
      'The only operation that permanently removes raw material from inventory. Bounded by what was issued to the department.',
  })
  @ApiZodBody(materialConsumptionRequest)
  consume(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(materialConsumptionRequest) body: z.infer<typeof materialConsumptionRequest>,
  ) {
    return this.inventory.consume(orgId, user.id, body);
  }

  @Post('adjust')
  @RequirePermissions('inventory.adjust')
  @ApiOperation({
    summary: 'Authorised stock adjustment',
    description: 'Elevated. A reason is mandatory and the adjustment is fully audited.',
  })
  @ApiZodBody(stockAdjustmentRequest)
  adjust(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(stockAdjustmentRequest) body: z.infer<typeof stockAdjustmentRequest>,
  ) {
    return this.inventory.adjust(orgId, user.id, body);
  }
}
