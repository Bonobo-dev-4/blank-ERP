import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { AuthenticatedUser, LoginResponse } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import type { AppConfig } from '../../config/configuration';
import type { JwtPayload } from '../../common/auth/jwt.strategy';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly audit: AuditService,
  ) {}

  static hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  async login(
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<LoginResponse> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });

    // Compare against a dummy hash when the user does not exist so the response
    // time does not reveal which emails are registered.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok || user.status !== 'ACTIVE') {
      if (user) {
        await this.audit.record({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'LOGIN_FAILED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
          context: { reason: !ok ? 'BAD_PASSWORD' : 'INACTIVE' },
        });
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }

    return this.issueTokens(user.id, meta);
  }

  /**
   * Shop-floor terminal sign-in.
   *
   * Employee code plus a short PIN, because an operator wearing gloves at a
   * cutting table cannot type a password. The trade-off is handled by the
   * permission matrix: a BARCODE_OPERATOR can record stage quantities and
   * nothing else, so a shared terminal grants very little authority.
   */
  async pinLogin(
    employeeCode: string,
    pin: string,
    meta: { ip?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<LoginResponse> {
    const user = await this.prisma.user.findFirst({
      where: { employeeCode: employeeCode.trim(), status: 'ACTIVE' },
      select: { id: true, pinHash: true, organizationId: true },
    });

    const hash = user?.pinHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(pin, hash);

    if (!user || !user.pinHash || !ok) {
      throw new UnauthorizedException({
        code: 'INVALID_PIN',
        message: 'Employee code or PIN is incorrect',
      });
    }
    return this.issueTokens(user.id, meta);
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Session has expired' });
    }
    return this.issueTokens(payload.sub);
  }

  async loadUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });
    return toAuthenticatedUser(user);
  }

  private async issueTokens(
    userId: string,
    meta: { ip?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<LoginResponse> {
    const user = await this.loadUser(userId);

    const payload: JwtPayload = {
      sub: user.id,
      org: user.organizationId,
      email: user.email,
      name: user.fullName,
      code: user.employeeCode,
      roles: [...user.roles],
      perms: [...user.permissions],
    };

    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessTtl,
      }),
      this.jwt.signAsync(
        { sub: user.id },
        {
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
        },
      ),
    ]);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorLabel: user.fullName,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      context: meta.deviceId ? { deviceId: meta.deviceId } : undefined,
    });

    return { accessToken, refreshToken, expiresInSeconds: parseTtlSeconds(accessTtl), user };
  }
}

type UserWithRoles = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  userRoles: { role: { code: string; rolePermissions: { permission: { code: string } }[] } }[];
};

export function toAuthenticatedUser(user: UserWithRoles): AuthenticatedUser {
  const permissions = new Set<string>();
  for (const ur of user.userRoles) {
    for (const rp of ur.role.rolePermissions) permissions.add(rp.permission.code);
  }
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    fullName: user.fullName,
    employeeCode: user.employeeCode,
    roles: user.userRoles.map((r) => r.role.code).sort(),
    permissions: [...permissions].sort(),
  };
}

function parseTtlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 900;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return 900;
  }
}
