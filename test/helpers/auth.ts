import { createHmac } from 'node:crypto';
import { requireEnv } from '../../src/config/env';

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

/**
 * Builds a compact HS256 JWT by hand so tests can also produce malformed and
 * forged tokens (wrong secret, alg "none", tampered payload).
 */
export function signJwt(
  payload: Record<string, unknown>,
  opts: { secret?: string; alg?: string; expiresInSec?: number } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: requireEnv('JWT_ISSUER'),
    aud: requireEnv('JWT_AUDIENCE'),
    iat: now,
    exp: now + (opts.expiresInSec ?? 300),
    ...payload,
  };
  const alg = opts.alg ?? 'HS256';
  const head = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  if (alg === 'none') return `${head}.${body}.`;
  const sig = createHmac('sha256', opts.secret ?? requireEnv('JWT_SECRET'))
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

export const tokenFor = (tenantId: string, sub = `user-of-${tenantId.slice(0, 8)}`) =>
  signJwt({ sub, tenant_id: tenantId });

/** Swap the payload of a valid token while keeping its original signature. */
export function tamperPayload(token: string, changes: Record<string, unknown>): string {
  const [head, body, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  return `${head}.${b64url(JSON.stringify({ ...claims, ...changes }))}.${sig}`;
}
