/**
 * Dev/demo helper standing in for an identity provider: prints a signed JWT
 * for a tenant. In production tokens come from the IdP, never from this script.
 *
 *   npm run token -- A            # seeded Tenant A
 *   npm run token -- <tenant-uuid> [subject]
 */
import { JwtService } from '@nestjs/jwt';
import { loadEnv, requireEnv } from '../src/config/env';
import { isTenantId } from '../src/tenants/tenant-id';

const SEEDED: Record<string, string> = {
  A: '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b',
  B: '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a',
};

loadEnv();
const [arg, subject = 'demo-user'] = process.argv.slice(2);
const tenantId = SEEDED[arg?.toUpperCase()] ?? arg;
if (!isTenantId(tenantId)) {
  console.error('Usage: npm run token -- <A|B|tenant-uuid> [subject]');
  process.exit(1);
}

const token = new JwtService().sign(
  { sub: subject, tenant_id: tenantId },
  {
    secret: requireEnv('JWT_SECRET'),
    algorithm: 'HS256',
    issuer: requireEnv('JWT_ISSUER'),
    audience: requireEnv('JWT_AUDIENCE'),
    expiresIn: '1h',
  },
);
console.log(token);
