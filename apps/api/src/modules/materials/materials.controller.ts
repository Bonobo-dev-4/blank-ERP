import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createRawMaterialRequest, materialListQuery, paginationQuery,
  updateRawMaterialRequest, uomConversionPreviewQuery, upsertUomConversionRequest,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { MaterialsService } from './materials.service';

const lotListQuery = paginationQuery.extend({ rawMaterialId: z.string().uuid().optional() });

@ApiTags('Raw Materials')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @RequirePermissions('materials.read')
  @ApiOperation({ summary: 'List raw materials with their live stock position' })
  @ApiZodQuery(materialListQuery)
  list(@OrgId() orgId: string, @ZodQuery(materialListQuery) query: z.infer<typeof materialListQuery>) {
    return this.materials.list(orgId, query);
  }

  @Get('uom-conversions')
  @RequirePermissions('materials.read')
  @ApiOperation({ summary: 'List configured unit conversions' })
  listConversions(@OrgId() orgId: string) {
    return this.materials.listConversions(orgId);
  }

  @Post('uom-conversions')
  @RequirePermissions('materials.manage_uom')
  @ApiOperation({ summary: 'Create or update a unit conversion' })
  @ApiZodBody(upsertUomConversionRequest)
  upsertConversion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(upsertUomConversionRequest) body: z.infer<typeof upsertUomConversionRequest>,
  ) {
    return this.materials.upsertConversion(orgId, user.id, body);
  }

  @Get('uom-conversions/preview')
  @RequirePermissions('materials.read')
  @ApiOperation({ summary: 'Preview a unit conversion without applying it' })
  @ApiZodQuery(uomConversionPreviewQuery)
  previewConversion(
    @OrgId() orgId: string,
    @ZodQuery(uomConversionPreviewQuery) query: z.infer<typeof uomConversionPreviewQuery>,
  ) {
    return this.materials.previewConversion(orgId, query);
  }

  @Get('lots')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'List material lots' })
  @ApiZodQuery(lotListQuery)
  listLots(@OrgId() orgId: string, @ZodQuery(lotListQuery) query: z.infer<typeof lotListQuery>) {
    return this.materials.listLots(orgId, query);
  }

  @Get(':id')
  @RequirePermissions('materials.read')
  @ApiOperation({ summary: 'One raw material with its stock breakdown by location and lot' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.get(orgId, id);
  }

  @Post()
  @RequirePermissions('materials.write')
  @ApiOperation({ summary: 'Create a raw material' })
  @ApiZodBody(createRawMaterialRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createRawMaterialRequest) body: z.infer<typeof createRawMaterialRequest>,
  ) {
    return this.materials.create(orgId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('materials.write')
  @ApiOperation({ summary: 'Update a raw material' })
  @ApiZodBody(updateRawMaterialRequest)
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateRawMaterialRequest) body: z.infer<typeof updateRawMaterialRequest>,
  ) {
    return this.materials.update(orgId, user.id, id, body);
  }
}
