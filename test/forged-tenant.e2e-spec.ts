/**
 * Test C — Forged tenant ID.
 *
 * Authenticated as Tenant A, the caller tries to reach Tenant B by putting
 * B's ID in headers, query string, body, or by forging the token itself.
 * The trusted identity (verified JWT) must always win.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PatientDto, createTestApp } from './helpers/app';
import { signJwt, tamperPayload, tokenFor } from './helpers/auth';
import { SEEDED_PATIENTS, TENANT_A, TENANT_B, seededIds } from './helpers/fixtures';

describe('Test C: forged tenant ID (API level)', () => {
  let app: INestApplication;
  const tokenA = tokenFor(TENANT_A);
  const bNames = SEEDED_PATIENTS[TENANT_B].map((p) => p.patientName);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => app?.close());

  const get = () => request(app.getHttpServer()).get('/patients');

  /** 200, only Tenant A's seeded rows, nothing from B anywhere in the body. */
  function expectOnlyTenantA(res: request.Response) {
    expect(res.status).toBe(200);
    const body = res.body as PatientDto[];
    expect(body.map((p) => p.id).sort()).toEqual(seededIds(TENANT_A).sort());
    expect(body.every((p) => p.tenantId === TENANT_A)).toBe(true);
    for (const name of bNames) expect(res.text).not.toContain(name);
    expect(res.text).not.toContain(TENANT_B);
  }

  it('sanity: Tenant B’s own token does return Tenant B’s records', async () => {
    // Proves the endpoint returns data for B at all, so the A-only assertions below are meaningful.
    const res = await get().set('Authorization', `Bearer ${tokenFor(TENANT_B)}`);
    expect(res.status).toBe(200);
    expect((res.body as PatientDto[]).map((p) => p.id).sort()).toEqual(seededIds(TENANT_B).sort());
  });

  it('baseline: Tenant A sees only Tenant A', async () => {
    expectOnlyTenantA(await get().set('Authorization', `Bearer ${tokenA}`));
  });

  it.each(['X-Tenant-Id', 'Tenant-Id', 'X-Tenant', 'tenant_id'])('ignores forged header %s', async (header) => {
    expectOnlyTenantA(await get().set('Authorization', `Bearer ${tokenA}`).set(header, TENANT_B));
  });

  it('ignores forged query parameters', async () => {
    expectOnlyTenantA(
      await get().set('Authorization', `Bearer ${tokenA}`).query({ tenant_id: TENANT_B, tenantId: TENANT_B }),
    );
  });

  it('ignores a forged JSON body', async () => {
    expectOnlyTenantA(
      await get()
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ tenant_id: TENANT_B, tenantId: TENANT_B }),
    );
  });

  it('ignores header, query and body forged all at once', async () => {
    expectOnlyTenantA(
      await get()
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', TENANT_B)
        .query({ tenant_id: TENANT_B })
        .send({ tenant_id: TENANT_B }),
    );
  });

  it('a forged tenant header without any token is still rejected', async () => {
    const res = await get().set('X-Tenant-Id', TENANT_B);
    expect(res.status).toBe(401);
  });

  describe('forged tokens claiming Tenant B are rejected', () => {
    const cases: Array<[string, string]> = [
      ['signed with the wrong secret', signJwt({ sub: 'x', tenant_id: TENANT_B }, { secret: 'attacker-secret' })],
      ['using alg "none"', signJwt({ sub: 'x', tenant_id: TENANT_B }, { alg: 'none' })],
      ["Tenant A's token with its payload changed to Tenant B", tamperPayload(tokenA, { tenant_id: TENANT_B })],
      ['with the wrong issuer', signJwt({ sub: 'x', tenant_id: TENANT_B, iss: 'evil-issuer' })],
      ['with the wrong audience', signJwt({ sub: 'x', tenant_id: TENANT_B, aud: 'other-api' })],
    ];

    it.each(cases)('%s', async (_label, token) => {
      const res = await get().set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      for (const name of bNames) expect(res.text).not.toContain(name);
    });
  });
});
