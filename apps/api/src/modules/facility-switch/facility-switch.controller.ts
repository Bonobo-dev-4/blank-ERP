import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  facilitySwitchOptionsQuery, facilitySwitchPreflightRequest, facilitySwitchResolveRequest,
  facilitySwitchStartRequest, idempotencyKeyHeader, type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { FacilitySwitchService } from './facility-switch.service';

@ApiTags('Facility switch')
@Controller()
export class FacilitySwitchController {
  constructor(private readonly switches: FacilitySwitchService) {}

  @Get('orders/:orderId/facility-switch/options')
  @RequirePermissions('demand.switch_facility')
  @ApiOperation({
    summary: 'Live Unicommerce items, facilities and stock for a switch',
    description: 'Reads the sale order, every configured facility and the selected item\'s stock live. Changes nothing.',
  })
  @ApiZodQuery(facilitySwitchOptionsQuery)
  options(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @ZodQuery(facilitySwitchOptionsQuery) query: z.infer<typeof facilitySwitchOptionsQuery>,
  ) {
    return this.switches.options(user, orderId, query);
  }

  @Post('orders/:orderId/facility-switch/preflight')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('demand.switch_facility')
  @ApiOperation({
    summary: 'Check one item against one facility, and issue a 30-second confirmation',
    description: 'Every check is re-run live. A token is issued only when all pass; it binds the confirmation to exactly what was checked and is not a reservation.',
  })
  @ApiZodBody(facilitySwitchPreflightRequest)
  preflight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @ZodBody(facilitySwitchPreflightRequest) body: z.infer<typeof facilitySwitchPreflightRequest>,
  ) {
    return this.switches.preflight(user, orderId, body);
  }

  @Post('orders/:orderId/facility-switch')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('demand.switch_facility')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'One per confirmed switch. Repeating it returns the same operation.' })
  @ApiOperation({
    summary: 'Switch one sale-order item to another facility',
    description: 'Records the operation, re-validates everything, sends ONE request to Unicommerce, and verifies the result by reading the order back. Returns at once; poll the operation for the outcome.',
  })
  @ApiZodBody(facilitySwitchStartRequest)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(facilitySwitchStartRequest) body: z.infer<typeof facilitySwitchStartRequest>,
  ) {
    const parsed = idempotencyKeyHeader.safeParse(key ?? '');
    if (!parsed.success) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'An Idempotency-Key header (16-200 characters) is required.' });
    }
    return this.switches.start(user, orderId, body, parsed.data);
  }

  @Get('orders/:orderId/facility-switch/history')
  @RequirePermissions('demand.read')
  @ApiOperation({ summary: 'Every facility switch on this order, with its event history' })
  history(@CurrentUser() user: AuthenticatedUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.switches.history(user, orderId);
  }

  @Get('facility-switch/operations')
  @RequirePermissions('demand.read')
  @ApiOperation({ summary: 'Recent facility switches; `open=true` for those needing a person' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('open') open?: string,
  ) {
    return this.switches.list(user, { status: status || undefined, open: open === 'true' });
  }

  @Get('facility-switch/operations/:id')
  @RequirePermissions('demand.read')
  @ApiOperation({ summary: 'One facility switch: state, verification and history' })
  operation(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.switches.operation(user, id);
  }

  @Post('facility-switch/operations/:id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('demand.switch_facility')
  @ApiOperation({
    summary: 'Read Unicommerce again for a switch whose outcome is open',
    description: 'Never re-sends the switch. Resolves a pending verification from what the order now shows.',
  })
  verify(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.switches.verify(user, id);
  }

  @Post('facility-switch/operations/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('demand.switch_facility')
  @ApiOperation({
    summary: 'Close what needs a person: production reviewed, or a pending switch confirmed as not applied',
  })
  @ApiZodBody(facilitySwitchResolveRequest)
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(facilitySwitchResolveRequest) body: z.infer<typeof facilitySwitchResolveRequest>,
  ) {
    return this.switches.resolve(user, id, body);
  }
}
