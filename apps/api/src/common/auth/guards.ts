import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '@dnd/contracts';

export const IS_PUBLIC_KEY = 'dnd:isPublic';
export const PERMISSIONS_KEY = 'dnd:permissions';

/** Marks an endpoint as reachable without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declares the permissions an endpoint requires. ALL listed permissions must
 * be held. Applied on the controller method, so authorisation lives next to the
 * handler it protects and cannot be forgotten in a separate table.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

/**
 * Backend authorisation. The specification requires every critical action to
 * be validated server-side, so this guard is registered globally: an endpoint
 * is protected unless it explicitly opts out with @Public().
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException('Authentication required');

    const held = new Set(user.permissions);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `This action requires: ${missing.join(', ')}`,
        details: { required, missing },
      });
    }
    return true;
  }
}
