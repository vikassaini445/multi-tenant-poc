/**
 * Test B — Missing tenant context.
 *
 * Database level: with no / empty tenant context the policies must return zero
 * rows (fail closed), never all rows. API level: requests without a trusted
 * tenant identity are rejected before touching the database.
 */
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { signJwt } from './helpers/auth';
import { assertIsRestrictedAppRole, createAppPool, expectPgError, inTenantTxRollback } from './helpers/db';
import { SEEDED_PATIENTS, TENANT_A } from './helpers/fixtures';

const countPatients = async (q: { query: Pool['query'] }) =>
  Number((await q.query<{ n: string }>('SELECT count(*) AS n FROM patients')).rows[0].n);

describe('Test B: missing tenant context (database level)', () => {
  let pool: Pool;

  beforeAll(async () => {
    // Size 1: every test below runs on the same physical connection.
    pool = createAppPool(1);
    await assertIsRestrictedAppRole(pool);
  });

  afterAll(async () => pool?.end());

  it('sanity: the table is not empty when a tenant context IS set', async () => {
    // Without this, every "0 rows" assertion below could pass on an empty table.
    expect(await inTenantTxRollback(pool, TENANT_A, countPatients)).toBeGreaterThan(0);
  });

  it('returns zero rows when the setting was never defined (fresh session)', async () => {
    const fresh = createAppPool(1);
    try {
      const { rows } = await fresh.query("SELECT current_setting('app.current_tenant', true) AS v");
      expect(rows[0].v).toBeNull();
      expect(await countPatients(fresh)).toBe(0);
    } finally {
      await fresh.end();
    }
  });

  it('returns zero rows inside a transaction that never sets the context', async () => {
    expect(await inTenantTxRollback(pool, null, countPatients)).toBe(0);
  });

  it('returns zero rows when the context is an empty string', async () => {
    expect(await inTenantTxRollback(pool, '', countPatients)).toBe(0);
  });

  it('returns zero rows on a connection where a previous transaction had set the context', async () => {
    await inTenantTxRollback(pool, TENANT_A, countPatients);
    // After SET LOCAL ends, the placeholder still exists on the session but is ''.
    const { rows } = await pool.query("SELECT current_setting('app.current_tenant', true) AS v");
    expect(rows[0].v === '' || rows[0].v === null).toBe(true);
    expect(await countPatients(pool)).toBe(0);
  });

  it('rejects (does not return rows for) a non-UUID tenant context', async () => {
    const err = await inTenantTxRollback(pool, "' OR 1=1 --", (c) => expectPgError(countPatients(c)));
    expect(err.code).toBe('22P02'); // invalid_text_representation
  });

  it('cannot INSERT without a tenant context', async () => {
    const err = await inTenantTxRollback(pool, null, (c) =>
      expectPgError(c.query('INSERT INTO patients (tenant_id, patient_name) VALUES ($1, $2)', [TENANT_A, 'x'])),
    );
    expect(err.code).toBe('42501');
  });

  it('cannot UPDATE or DELETE anything without a tenant context', async () => {
    const counts = await inTenantTxRollback(pool, null, async (c) => ({
      updated: (await c.query("UPDATE patients SET patient_name = 'pwned'")).rowCount,
      deleted: (await c.query('DELETE FROM patients')).rowCount,
    }));
    expect(counts).toEqual({ updated: 0, deleted: 0 });
  });
});

describe('Test B: missing tenant context (API level)', () => {
  let app: INestApplication;
  const leakedNames = Object.values(SEEDED_PATIENTS)
    .flat()
    .map((p) => p.patientName);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => app?.close());

  const expectRejected = (res: request.Response) => {
    expect(res.status).toBe(401);
    for (const name of leakedNames) expect(res.text).not.toContain(name);
  };

  it('rejects a request with no Authorization header', async () => {
    expectRejected(await request(app.getHttpServer()).get('/patients'));
  });

  it('rejects a non-Bearer Authorization header', async () => {
    expectRejected(await request(app.getHttpServer()).get('/patients').set('Authorization', `Basic ${TENANT_A}`));
  });

  it('rejects a validly signed token that has no tenant_id claim', async () => {
    const token = signJwt({ sub: 'user-without-tenant' });
    expectRejected(await request(app.getHttpServer()).get('/patients').set('Authorization', `Bearer ${token}`));
  });

  it('rejects a validly signed token whose tenant_id is empty or not a UUID', async () => {
    for (const tenant_id of ['', 'not-a-uuid', "' OR 1=1 --"]) {
      const token = signJwt({ sub: 'u', tenant_id });
      expectRejected(await request(app.getHttpServer()).get('/patients').set('Authorization', `Bearer ${token}`));
    }
  });

  it('rejects an expired token', async () => {
    const token = signJwt({ sub: 'u', tenant_id: TENANT_A }, { expiresInSec: -60 });
    expectRejected(await request(app.getHttpServer()).get('/patients').set('Authorization', `Bearer ${token}`));
  });
});
