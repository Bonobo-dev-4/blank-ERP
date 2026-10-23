import { ExecutionContext, InternalServerErrorException, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedUser } from '@dnd/contracts';

/** The authenticated user, guaranteed present on any non-public endpoint. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new InternalServerErrorException(
        'CurrentUser used on an endpoint with no authentication guard',
      );
    }
    return user;
  },
);

/**
 * The caller's organisation id.
 *
 * Every query in this application is scoped by it. Taking it from the verified
 * token rather than a request parameter is what makes cross-organisation data
 * access impossible to reach by editing a URL.
 */
export const OrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
  if (!user?.organizationId) {
    throw new InternalServerErrorException('Organisation scope is unavailable on this request');
  }
  return user.organizationId;
});
