import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION_CODES, createUserRequest, integrationWriteAccessRequest, paginationQuery, updateUserRequest,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { AdminService } from './admin.service';

const auditQuery = paginationQuery.extend({
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  action: z.string().trim().max(30).optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const rolePermissionsBody = z.object({
  permissions: z.array(z.string().refine((c) => PERMISSION_CODES.includes(c), 'Unknown permission code')).max(200),
});

const settingsBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).optional(),
  settings: z.record(z.unknown()).optional(),
});

@ApiTags('Administration')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @RequirePermissions('admin.manage_users')
  @ApiOperation({ summary: 'List users and their roles' })
  @ApiZodQuery(paginationQuery)
  listUsers(@OrgId() orgId: string, @ZodQuery(paginationQuery) query: z.infer<typeof paginationQuery>) {
    return this.admin.listUsers(orgId, query);
  }

  @Post('users')
  @RequirePermissions('admin.manage_users')
  @ApiOperation({ summary: 'Create a user' })
  @ApiZodBody(createUserRequest)
  createUser(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createUserRequest) body: z.infer<typeof createUserRequest>,
  ) {
    return this.admin.createUser(orgId, user.id, body);
  }

  @Patch('users/:id')
  @RequirePermissions('admin.manage_users')
  @ApiOperation({ summary: 'Update a user, their roles or their credentials' })
  @ApiZodBody(updateUserRequest)
  updateUser(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateUserRequest) body: z.infer<typeof updateUserRequest>,
  ) {
    return this.admin.updateUser(orgId, user.id, id, body);
  }

  @Get('roles')
  @RequirePermissions('admin.manage_roles')
  @ApiOperation({ summary: 'List roles with their permissions' })
  listRoles(@OrgId() orgId: string) {
    return this.admin.listRoles(orgId);
  }

  @Get('permissions')
  @RequirePermissions('admin.manage_roles')
  @ApiOperation({ summary: 'The permission catalogue and the default role matrix' })
  listPermissions() {
    return this.admin.listPermissionCatalogue();
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('admin.manage_roles')
  @ApiOperation({ summary: 'Replace the permissions held by a role' })
  @ApiZodBody(rolePermissionsBody)
  setRolePermissions(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(rolePermissionsBody) body: z.infer<typeof rolePermissionsBody>,
  ) {
    return this.admin.setRolePermissions(orgId, user.id, id, body.permissions);
  }

  @Get('audit')
  @RequirePermissions('admin.view_audit_log')
  @ApiOperation({ summary: 'The audit log' })
  @ApiZodQuery(auditQuery)
  listAudit(@OrgId() orgId: string, @ZodQuery(auditQuery) query: z.infer<typeof auditQuery>) {
    return this.admin.listAuditLog(orgId, query);
  }

  @Get('settings')
  @RequirePermissions('admin.manage_settings')
  @ApiOperation({ summary: 'Organisation settings, integration status and document sequences' })
  getSettings(@OrgId() orgId: string) {
    return this.admin.getSettings(orgId);
  }

  @Patch('integrations/:id/write-access')
  @RequirePermissions('admin.manage_settings')
  @ApiOperation({
    summary: "Allow or stop a connection's external writes",
    description: 'The per-connection gate. A reason is required and audited. For Unicommerce, writes also need UC_WRITE_ENABLED and are each confirmed by a person.',
  })
  @ApiZodBody(integrationWriteAccessRequest)
  setWriteAccess(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(integrationWriteAccessRequest) body: z.infer<typeof integrationWriteAccessRequest>,
  ) {
    return this.admin.setIntegrationWriteAccess(orgId, user.id, id, body);
  }

  @Patch('settings')
  @RequirePermissions('admin.manage_settings')
  @ApiOperation({ summary: 'Update organisation settings' })
  @ApiZodBody(settingsBody)
  updateSettings(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(settingsBody) body: z.infer<typeof settingsBody>,
  ) {
    return this.admin.updateSettings(orgId, user.id, {
      ...body,
      settings: body.settings as Prisma.InputJsonValue | undefined,
    });
  }

  @Get('approvals')
  @RequirePermissions('admin.manage_approvals')
  @ApiOperation({
    summary: 'Everything waiting on a decision',
    description:
      'Requisitions, purchase orders and BOM versions sitting in PENDING_APPROVAL, read from the documents themselves. Lists and links; approving happens on the document, where that document\'s permission check and state machine live.',
  })
  approvals(@OrgId() orgId: string) {
    return this.admin.pendingApprovals(orgId);
  }
}
