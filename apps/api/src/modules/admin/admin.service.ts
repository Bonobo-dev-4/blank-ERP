import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLE_CODES, type RoleCode } from '@dnd/contracts';
import type { CreateUserRequest } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- users --------------------------------------------------------------

  async listUsers(
    organizationId: string,
    query: { page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string },
  ) {
    const where: Prisma.UserWhereInput = {
      organizationId,
      ...(searchFilter(query.search, ['email', 'fullName', 'employeeCode']) ?? {}),
    };
    const args = pageArgs(query, ['email', 'fullName', 'createdAt', 'lastLoginAt'], 'fullName');
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where, ...args,
        select: {
          id: true, email: true, fullName: true, employeeCode: true, status: true,
          lastLoginAt: true, createdAt: true,
          userRoles: { select: { role: { select: { id: true, code: true, name: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async createUser(organizationId: string, actorUserId: string, body: CreateUserRequest) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId, id: { in: body.roleIds } },
      select: { id: true, code: true },
    });
    if (roles.length !== body.roleIds.length) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'One or more roles do not exist' });
    }

    const created = await this.prisma.user.create({
      data: {
        organizationId,
        email: body.email.toLowerCase().trim(),
        fullName: body.fullName,
        employeeCode: body.employeeCode ?? null,
        passwordHash: await AuthService.hash(body.password),
        pinHash: body.pin ? await AuthService.hash(body.pin) : null,
        userRoles: { create: body.roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true, email: true, fullName: true, employeeCode: true, status: true },
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'CREATE',
      entityType: 'User', entityId: created.id,
      // Credentials are never written to the audit log.
      context: { email: created.email, roles: roles.map((r) => r.code), elevated: true },
    });
    return created;
  }

  async updateUser(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: Partial<CreateUserRequest> & { status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' },
  ) {
    const before = await this.prisma.user.findFirst({
      where: { id, organizationId },
      include: { userRoles: true },
    });
    if (!before) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    const data: Prisma.UserUpdateInput = {
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...(body.email !== undefined ? { email: body.email.toLowerCase().trim() } : {}),
      ...(body.employeeCode !== undefined ? { employeeCode: body.employeeCode } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.password ? { passwordHash: await AuthService.hash(body.password) } : {}),
      ...(body.pin ? { pinHash: await AuthService.hash(body.pin) } : {}),
    };

    const after = await this.prisma.inTransaction(async (tx) => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: body.roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      return tx.user.update({
        where: { id },
        data,
        select: { id: true, email: true, fullName: true, employeeCode: true, status: true },
      });
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'User', entityId: id,
      diff: this.audit.diffOf(before as never, after as never),
      context: { rolesChanged: Boolean(body.roleIds), elevated: true },
    });
    return after;
  }

  // --- roles and permissions ---------------------------------------------

  async listRoles(organizationId: string) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: r._count.userRoles,
      permissions: r.rolePermissions.map((rp) => rp.permission.code).sort(),
      elevatedPermissions: r.rolePermissions.filter((rp) => rp.permission.elevated).map((rp) => rp.permission.code).sort(),
    }));
  }

  /** The permission catalogue, grouped by module, for the roles screen. */
  listPermissionCatalogue() {
    const byModule = new Map<string, typeof PERMISSIONS[number][]>();
    for (const p of PERMISSIONS) {
      const list = byModule.get(p.module);
      if (list) list.push(p);
      else byModule.set(p.module, [p]);
    }
    return {
      modules: [...byModule.entries()].map(([module, permissions]) => ({ module, permissions })),
      roleDefaults: ROLE_CODES.map((code) => ({
        code,
        label: ROLE_LABELS[code],
        permissionCount: ROLE_PERMISSIONS[code].length,
        permissions: ROLE_PERMISSIONS[code],
      })),
    };
  }

  async setRolePermissions(
    organizationId: string,
    actorUserId: string,
    roleId: string,
    permissionCodes: readonly string[],
  ) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    if (role.code === 'SUPER_ADMIN') {
      throw new BadRequestException({
        code: 'ROLE_PROTECTED',
        message: 'The Super Admin role always holds every permission and cannot be narrowed',
      });
    }

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: [...permissionCodes] } },
      select: { id: true, code: true },
    });
    const unknown = permissionCodes.filter((c) => !permissions.some((p) => p.code === c));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_PERMISSION',
        message: 'One or more permission codes are not in the catalogue',
        details: { unknown },
      });
    }

    await this.prisma.inTransaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      });
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'Role', entityId: roleId,
      context: { roleCode: role.code, permissionCount: permissions.length, elevated: true },
    });
    return this.listRoles(organizationId);
  }

  // --- audit log ---------------------------------------------------------

  async listAuditLog(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string; search?: string;
      entityType?: string; entityId?: string; action?: string; actorUserId?: string;
      from?: string; to?: string;
    },
  ) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action as never } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return paginated(
      rows.map((r) => ({ ...r, actor: r.actorUserId ? (actorById.get(r.actorUserId) ?? null) : null })),
      total,
      query,
    );
  }

  // --- settings ----------------------------------------------------------

  async getSettings(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, code: true, name: true, timezone: true, currency: true, settings: true, status: true },
    });
    const [integrations, sequences] = await Promise.all([
      this.prisma.integrationConnection.findMany({
        where: { organizationId },
        select: {
          id: true, provider: true, name: true, isEnabled: true, allowExternalWrites: true,
          apiVersion: true, healthStatus: true, lastHealthCheckAt: true, lastSyncAt: true, config: true,
        },
      }),
      this.prisma.numberSequence.findMany({
        where: { organizationId },
        select: { scope: true, prefix: true, padding: true, nextValue: true },
        orderBy: { scope: 'asc' },
      }),
    ]);
    return { organization: org, integrations, documentSequences: sequences };
  }

  async updateSettings(
    organizationId: string,
    actorUserId: string,
    body: { name?: string; timezone?: string; currency?: string; settings?: Prisma.InputJsonValue },
  ) {
    const before = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const after = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.settings !== undefined ? { settings: body.settings } : {}),
      },
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'Organization', entityId: organizationId,
      diff: this.audit.diffOf(before as never, after as never),
      context: { elevated: true },
    });
    return after;
  }
}

export type { RoleCode };
