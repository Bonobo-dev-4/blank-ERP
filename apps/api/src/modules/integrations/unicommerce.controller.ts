import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/guards';
import { UnicommerceService } from './unicommerce.service';

@ApiTags('Integrations')
@Controller('integrations/unicommerce')
export class UnicommerceController {
  constructor(private readonly unicommerce: UnicommerceService) {}

  @Get('status')
  @RequirePermissions('admin.manage_integrations')
  @ApiOperation({
    summary: 'Unicommerce configuration status',
    description:
      'Reports whether the connector is configured, and flags a plaintext transport. Never reveals credentials.',
  })
  status() {
    return this.unicommerce.status();
  }

  @Post('verify')
  @RequirePermissions('admin.manage_integrations')
  @ApiOperation({
    summary: 'Probe the live tenant',
    description:
      'Signs in, resolves every configured facility code, and reads recent orders. Reports what this account CANNOT see as prominently as what it can, because the blind spots are what change decisions. Read-only.',
  })
  verify() {
    return this.unicommerce.verify();
  }

  @Get('facilities')
  @RequirePermissions('sync.read')
  @ApiOperation({
    summary: 'Resolve the facility master',
    description:
      'Uses facility/get, the only call that distinguishes a wrong code from a real facility this account cannot see.',
  })
  facilities() {
    return this.unicommerce.facilities();
  }

  @Get('availability')
  @RequirePermissions('sync.read')
  @ApiOperation({
    summary: 'Where else is this piece available?',
    description:
      'Searches every configured facility. The result is structurally partial — five facilities are invisible to the service account — so it lists what it could not check and sets isComplete accordingly. Do not report "unavailable" on an incomplete search.',
  })
  @ApiQuery({ name: 'sku', required: true })
  @ApiQuery({ name: 'facilities', required: false, description: 'Comma-separated codes; defaults to all configured.' })
  availability(@Query('sku') sku: string, @Query('facilities') facilities?: string) {
    const codes = facilities?.split(',').map((c) => c.trim()).filter(Boolean);
    return this.unicommerce.availability(sku, codes?.length ? codes : undefined);
  }

  @Get('orders')
  @RequirePermissions('sync.read')
  @ApiOperation({
    summary: 'Orders in a date range',
    description:
      'Chunked to the 31-day cap the API enforces. Tenant-wide: this endpoint ignores the facility header, so per-line facilityCode is the only honest source of where an order is served from.',
  })
  @ApiQuery({ name: 'from', required: true, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO date' })
  orders(@Query('from') from: string, @Query('to') to: string) {
    return this.unicommerce.searchOrders(new Date(from), new Date(to));
  }

  @Get('order')
  @RequirePermissions('sync.read')
  @ApiOperation({
    summary: 'One order with its lines',
    description:
      'Line quantities are stage counters and are reported separately on purpose: summing allocated + inProcess + completed would count the same garment several times as it moves.',
  })
  @ApiQuery({ name: 'code', required: true })
  order(@Query('code') code: string) {
    return this.unicommerce.order(code);
  }
}
