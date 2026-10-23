import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createLocationRequest, updateLocationRequest, type AuthenticatedUser } from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ZodBody } from '../../common/zod/zod.decorators';
import { LocationsService } from './locations.service';

@ApiTags('Stock Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'List stock locations with the quantity each holds' })
  @ApiQuery({ name: 'includeSystem', required: false, type: Boolean })
  list(@OrgId() orgId: string, @Query('includeSystem') includeSystem?: string) {
    return this.locations.list(orgId, { includeSystem: includeSystem === 'true' });
  }

  @Post()
  @RequirePermissions('admin.manage_locations')
  @ApiOperation({ summary: 'Create a stock location' })
  @ApiZodBody(createLocationRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createLocationRequest) body: z.infer<typeof createLocationRequest>,
  ) {
    return this.locations.create(orgId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('admin.manage_locations')
  @ApiOperation({ summary: 'Update a stock location' })
  @ApiZodBody(updateLocationRequest)
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateLocationRequest) body: z.infer<typeof updateLocationRequest>,
  ) {
    return this.locations.update(orgId, user.id, id, body);
  }
}
