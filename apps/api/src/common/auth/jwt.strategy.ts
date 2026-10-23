import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '@dnd/contracts';
import type { AppConfig } from '../../config/configuration';

export interface JwtPayload {
  readonly sub: string;
  readonly org: string;
  readonly email: string;
  readonly name: string;
  readonly code: string | null;
  readonly roles: string[];
  readonly perms: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  /**
   * Roles and permissions are carried in the access token, which is why the
   * token lifetime is short (15 minutes by default): a permission revoked in
   * the admin screen must stop working quickly without a database read on every
   * single request from every barcode terminal.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub || !payload?.org) throw new UnauthorizedException('Malformed access token');
    return {
      id: payload.sub,
      organizationId: payload.org,
      email: payload.email,
      fullName: payload.name,
      employeeCode: payload.code,
      roles: payload.roles ?? [],
      permissions: payload.perms ?? [],
    };
  }
}
