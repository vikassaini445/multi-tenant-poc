/**
 * Demo login + browser page. The server maps a demo user to its tenant; the
 * client can never choose the tenant, and the whole feature is off unless
 * DEMO_LOGIN_ENABLED=true.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PatientDto, createTestApp } from './helpers/app';
import { TENANT_A, TENANT_B, seededIds } from './helpers/fixtures';

const PASSWORD = () => process.env.DEMO_PASSWORD as string;

describe('Demo login (enabled)', () => {
  let app: INestApplication;
  const login = (body: object) => request(app.getHttpServer()).post('/auth/demo-login').send(body);

  beforeAll(async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    process.env.DEMO_PASSWORD = 'demo-password-for-tests';
    app = await createTestApp();
  });

  afterAll(async () => {
    delete process.env.DEMO_LOGIN_ENABLED;
    await app?.close();
  });

  it.each([
    ['alice', TENANT_A],
    ['bob', TENANT_B],
  ])('%s gets a token for their own tenant, which returns only that tenant’s patients', async (username, tenant) => {
    const res = await login({ username, password: PASSWORD() });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(tenant);

    const patients = await request(app.getHttpServer())
      .get('/patients')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(patients.status).toBe(200);
    expect((patients.body as PatientDto[]).map((p) => p.id).sort()).toEqual(seededIds(tenant).sort());
  });

  it('ignores a tenant_id supplied in the login body', async () => {
    const res = await login({ username: 'alice', password: PASSWORD(), tenant_id: TENANT_B, tenantId: TENANT_B });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(TENANT_A);
  });

  it.each([
    ['wrong password', { username: 'alice', password: 'nope' }],
    ['unknown user', { username: 'mallory', password: 'demo-password-for-tests' }],
    ['missing fields', {}],
    ['non-string fields', { username: ['alice'], password: { $ne: '' } }],
  ])('rejects %s with 401', async (_label, body) => {
    const res = await login(body);
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('serves the demo page and its script', async () => {
    const page = await request(app.getHttpServer()).get('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    const js = await request(app.getHttpServer()).get('/demo.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
  });
});

describe('Demo login (disabled — the default)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.DEMO_LOGIN_ENABLED;
    process.env.DEMO_PASSWORD = 'demo-password-for-tests';
    app = await createTestApp();
  });

  afterAll(async () => app?.close());

  it('returns 404 for the login endpoint and the page', async () => {
    const server = app.getHttpServer();
    expect((await request(server).post('/auth/demo-login').send({ username: 'alice', password: PASSWORD() })).status).toBe(404);
    expect((await request(server).get('/')).status).toBe(404);
  });
});
