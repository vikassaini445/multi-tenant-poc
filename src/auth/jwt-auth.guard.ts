import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isTenantId } from '../tenants/tenant-id';
import { AccessTokenClaims, AuthenticatedRequest } from './auth.types';

const BEARER_RE = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Establishes the request's tenant from a verified JWT and nothing else.
 * Headers like X-Tenant-Id, query strings and bodies are never consulted.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? BEARER_RE.exec(header) : null;
    if (!match) throw new UnauthorizedException();

    let claims: AccessTokenClaims;
    try {
      // Algorithm, issuer, audience and expiry are enforced by the verify
      // options configured in AuthModule.
      claims = await this.jwt.verifyAsync<AccessTokenClaims & object>(match[1]);
    } catch {
      throw new UnauthorizedException();
    }

    if (typeof claims.sub !== 'string' || !claims.sub || !isTenantId(claims.tenant_id)) {
      throw new UnauthorizedException();
    }

    req.auth = Object.freeze({ subject: claims.sub, tenantId: claims.tenant_id });
    return true;
  }
}
