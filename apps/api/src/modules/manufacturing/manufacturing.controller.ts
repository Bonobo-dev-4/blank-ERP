import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cancelManufacturingOrderRequest, createManufacturingOrderRequest,
  holdManufacturingOrderRequest, manufacturingOrderListQuery,
  releaseManufacturingOrderRequest, reserveMaterialRequest,
  updateManufacturingOrderRequest, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { ManufacturingService } from './manufacturing.service';

@ApiTags('Manufacturing Orders')
@Controller('manufacturing')
export class ManufacturingController {
  constructor(private readonly manufacturing: ManufacturingService) {}

  @Get('orders')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'List manufacturing orders' })
  @ApiZodQuery(manufacturingOrderListQuery)
  list(
    @OrgId() orgId: string,
    @ZodQuery(manufacturingOrderListQuery) query: z.infer<typeof manufacturingOrderListQuery>,
  ) {
    return this.manufacturing.list(orgId, query);
  }

  @Get('orders/:id')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({ summary: 'One order with its BOM snapshot, reservations and requirements' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturing.get(orgId, id);
  }

  @Get('orders/:id/readiness')
  @RequirePermissions('manufacturing.read')
  @ApiOperation({
    summary: 'Live material readiness for an order',
    description:
      'What the planner sees before deciding to release: required, available, reserved elsewhere, shortage and how many garments current stock actually covers. Read-only — nothing here is persisted.',
  })
  readiness(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturing.readiness(orgId, id);
  }

  @Post('orders')
  @RequirePermissions('manufacturing.write')
  @ApiOperation({ summary: 'Create a manufacturing order' })
  @ApiZodBody(createManufacturingOrderRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createManufacturingOrderRequest) body: z.infer<typeof createManufacturingOrderRequest>,
  ) {
    return this.manufacturing.create(orgId, user.id, body);
  }

  @Patch('orders/:id')
  @RequirePermissions('manufacturing.write')
  @ApiOperation({
    summary: 'Edit an order before release',
    description: 'Refused once the order is released: the floor is already working to those quantities.',
  })
  @ApiZodBody(updateManufacturingOrderRequest)
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateManufacturingOrderRequest) body: z.infer<typeof updateManufacturingOrderRequest>,
  ) {
    return this.manufacturing.update(orgId, user.id, id, body);
  }

  @Post('orders/:id/reserve')
  @RequirePermissions('mrp.reserve')
  @ApiOperation({
    summary: 'Reserve stock against this order',
    description:
      'A claim, not a movement: the material does not leave the warehouse, but no other order can promise it. Re-running tops up an existing reservation rather than double-booking.',
  })
  @ApiZodBody(reserveMaterialRequest)
  reserve(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(reserveMaterialRequest) body: z.infer<typeof reserveMaterialRequest>,
  ) {
    return this.manufacturing.reserve(orgId, user.id, id, body);
  }

  @Post('orders/:id/release')
  @RequirePermissions('manufacturing.release')
  @ApiOperation({
    summary: 'Release an order to the floor',
    description:
      'Freezes the BOM version onto the order and copies its lines into an immutable snapshot that costing and issue limits read from. Releasing while short of a critical material additionally requires manufacturing.release_with_shortage and a written reason.',
  })
  @ApiZodBody(releaseManufacturingOrderRequest)
  release(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(releaseManufacturingOrderRequest) body: z.infer<typeof releaseManufacturingOrderRequest>,
  ) {
    return this.manufacturing.release(orgId, user, id, body);
  }

  @Post('orders/:id/hold')
  @RequirePermissions('manufacturing.write')
  @ApiOperation({ summary: 'Put an order on hold, or take it off hold' })
  @ApiZodBody(holdManufacturingOrderRequest)
  hold(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(holdManufacturingOrderRequest) body: z.infer<typeof holdManufacturingOrderRequest>,
  ) {
    return this.manufacturing.setHold(orgId, user.id, id, body.hold, body.reason);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('manufacturing.cancel')
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Releases every reservation the order held. An order nobody will make must not keep material promised.',
  })
  @ApiZodBody(cancelManufacturingOrderRequest)
  cancel(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(cancelManufacturingOrderRequest) body: z.infer<typeof cancelManufacturingOrderRequest>,
  ) {
    return this.manufacturing.cancel(orgId, user.id, id, body.reason);
  }
}
