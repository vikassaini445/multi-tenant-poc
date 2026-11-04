import { ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { AuthenticatedRequest } from './auth.types';

/**
 * The authenticated tenant ID. Fails closed if JwtAuthGuard did not run
 * (e.g. someone forgot @UseGuards on a new route).
 */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const tenantId = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.tenantId;
  if (!tenantId) throw new UnauthorizedException();
  return tenantId;
});
