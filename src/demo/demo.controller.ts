import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Controller, Get, Header, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { requireEnv } from '../config/env';

/**
 * Demo users for the browser page, mapped server-side to the seeded tenants
 * (database/seed/001_tenants_and_patients.sql). The tenant is decided here by
 * who logged in — never by anything the client sends.
 */
const DEMO_USERS: Record<string, { tenantId: string; tenantName: string }> = {
  alice: { tenantId: '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b', tenantName: 'Tenant A' },
  bob: { tenantId: '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a', tenantName: 'Tenant B' },
};

const PUBLIC_DIR = join(process.cwd(), 'public');
// Inline scripts are blocked; the page loads /demo.js from this origin only.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Dev/demo only: everything here 404s unless DEMO_LOGIN_ENABLED=true. */
@Controller()
export class DemoController {
  constructor(private readonly jwt: JwtService) {}

  private assertEnabled(): void {
    if (process.env.DEMO_LOGIN_ENABLED !== 'true') throw new NotFoundException();
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', CSP)
  page(): string {
    this.assertEnabled();
    return readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
  }

  @Get('demo.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  script(): string {
    this.assertEnabled();
    return readFileSync(join(PUBLIC_DIR, 'demo.js'), 'utf8');
  }

  @Post('auth/demo-login')
  async login(@Body() body: { username?: unknown; password?: unknown } = {}) {
    this.assertEnabled();
    const { username, password } = body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') throw new UnauthorizedException();

    const user = Object.hasOwn(DEMO_USERS, username) ? DEMO_USERS[username] : undefined;
    // Compare fixed-length digests so the check is constant-time.
    const passwordOk = timingSafeEqual(digest(password), digest(requireEnv('DEMO_PASSWORD')));
    if (!user || !passwordOk) throw new UnauthorizedException();

    const accessToken = await this.jwt.signAsync({ sub: username, tenant_id: user.tenantId });
    return { accessToken, username, tenantId: user.tenantId, tenantName: user.tenantName };
  }
}
