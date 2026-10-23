import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  bomListQuery, bomVersionListQuery, createBomRequest, createBomVersionRequest,
  decideBomVersionRequest, explodeBomRequest, updateBomVersionRequest,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { BomService } from './bom.service';

@ApiTags('Bill of Materials')
@Controller('bom')
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Get()
  @RequirePermissions('bom.read')
  @ApiOperation({ summary: 'List bills of material with their approved and latest versions' })
  @ApiZodQuery(bomListQuery)
  list(@OrgId() orgId: string, @ZodQuery(bomListQuery) query: z.infer<typeof bomListQuery>) {
    return this.bom.list(orgId, query);
  }

  @Get('versions')
  @RequirePermissions('bom.read')
  @ApiOperation({ summary: 'Every BOM version, newest first — the revision history' })
  @ApiZodQuery(bomVersionListQuery)
  listVersions(
    @OrgId() orgId: string,
    @ZodQuery(bomVersionListQuery) query: z.infer<typeof bomVersionListQuery>,
  ) {
    return this.bom.listVersions(orgId, query);
  }

  @Get(':id')
  @RequirePermissions('bom.read')
  @ApiOperation({ summary: 'One BOM with every version and its lines' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.bom.get(orgId, id);
  }

  @Get('versions/:versionId')
  @RequirePermissions('bom.read')
  @ApiOperation({ summary: 'One BOM version with lines, alternatives and size overrides' })
  getVersion(@OrgId() orgId: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.bom.getVersion(orgId, versionId);
  }

  @Get('versions/:versionId/diff')
  @RequirePermissions('bom.read')
  @ApiOperation({
    summary: 'Compare this version with another',
    description:
      'Answers the question an approver actually has — what changed — rather than asking them to read every line twice.',
  })
  @ApiQuery({ name: 'against', required: true, description: 'The other version id' })
  diff(
    @OrgId() orgId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query('against', ParseUUIDPipe) against: string,
  ) {
    return this.bom.diff(orgId, against, versionId);
  }

  @Post('versions/:versionId/explode')
  @RequirePermissions('bom.read')
  @ApiOperation({
    summary: 'Explode a version into material requirements',
    description:
      'Read-only preview. The figures a released order is costed against come from the snapshot written at release, not from here.',
  })
  @ApiZodBody(explodeBomRequest)
  explode(
    @OrgId() orgId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @ZodBody(explodeBomRequest) body: z.infer<typeof explodeBomRequest>,
  ) {
    return this.bom.explode(orgId, versionId, body);
  }

  @Post()
  @RequirePermissions('bom.write')
  @ApiOperation({ summary: 'Create a BOM with its first draft version' })
  @ApiZodBody(createBomRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createBomRequest) body: z.infer<typeof createBomRequest>,
  ) {
    return this.bom.create(orgId, user.id, body);
  }

  @Post(':id/versions')
  @RequirePermissions('bom.write')
  @ApiOperation({
    summary: 'Start a new draft version',
    description: 'Omitting the lines clones them from the version it is based on.',
  })
  @ApiZodBody(createBomVersionRequest)
  createVersion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(createBomVersionRequest) body: z.infer<typeof createBomVersionRequest>,
  ) {
    return this.bom.createVersion(orgId, user.id, id, body);
  }

  @Patch('versions/:versionId')
  @RequirePermissions('bom.write')
  @ApiOperation({
    summary: 'Replace the lines of a draft version',
    description: 'Only a DRAFT version may be edited. An approved version is immutable.',
  })
  @ApiZodBody(updateBomVersionRequest)
  updateVersion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @ZodBody(updateBomVersionRequest) body: z.infer<typeof updateBomVersionRequest>,
  ) {
    return this.bom.updateVersion(orgId, user.id, versionId, body);
  }

  @Post('versions/:versionId/submit')
  @RequirePermissions('bom.write')
  @ApiOperation({ summary: 'Send a draft version for approval' })
  submitVersion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.bom.submitVersion(orgId, user.id, versionId);
  }

  @Post('versions/:versionId/decision')
  @RequirePermissions('bom.approve')
  @ApiOperation({
    summary: 'Approve or reject a pending version',
    description:
      'Approving supersedes the previously approved version rather than replacing it, so orders released against the old one keep a readable lineage.',
  })
  @ApiZodBody(decideBomVersionRequest)
  decideVersion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @ZodBody(decideBomVersionRequest) body: z.infer<typeof decideBomVersionRequest>,
  ) {
    return this.bom.decideVersion(orgId, user.id, versionId, body);
  }
}
