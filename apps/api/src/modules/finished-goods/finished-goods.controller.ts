import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@dnd/contracts';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { FinishedGoodsService, type CreateInwardBody } from './finished-goods.service';

@ApiTags('Finished Goods')
@Controller('finished-goods')
export class FinishedGoodsController {
  constructor(private readonly fg: FinishedGoodsService) {}

  @Get('balances')
  @RequirePermissions('finished_goods.read')
  @ApiOperation({ summary: 'Finished stock on hand, by SKU and location' })
  @ApiQuery({ name: 'search', required: false })
  balances(@OrgId() orgId: string, @Query('search') search?: string) {
    return this.fg.balances(orgId, { search });
  }

  @Get('awaiting-inward')
  @RequirePermissions('finished_goods.read')
  @ApiOperation({
    summary: 'Orders with garments finished but not yet received',
    description: 'Completed minus already inwarded. This difference is the ceiling on what may be received.',
  })
  awaitingInward(@OrgId() orgId: string) {
    return this.fg.awaitingInward(orgId);
  }

  @Get('inwards')
  @RequirePermissions('finished_goods.read')
  @ApiOperation({ summary: 'Finished goods inward documents' })
  @ApiQuery({ name: 'status', required: false })
  listInwards(@OrgId() orgId: string, @Query('status') status?: string) {
    return this.fg.listInwards(orgId, { status });
  }

  @Post('inwards')
  @RequirePermissions('finished_goods.inward')
  @ApiOperation({
    summary: 'Record finished garments against an order',
    description:
      'Refused if it would exceed what the order actually completed — receiving more than was made creates garments nobody produced.',
  })
  createInward(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateInwardBody,
  ) {
    return this.fg.createInward(orgId, user.id, body);
  }

  @Post('inwards/:id/post')
  @RequirePermissions('finished_goods.inward')
  @ApiOperation({
    summary: 'Post the inward — stock exists from here',
    description:
      'One movement per line, the balance moved by the same amount, and the order advanced, in one transaction.',
  })
  postInward(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { idempotencyKey: string; locationId: string },
  ) {
    return this.fg.postInward(orgId, user.id, id, body);
  }
}
