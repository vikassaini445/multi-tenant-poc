/**
 * Verifies the security configuration the other suites rely on: RLS enabled
 * AND forced, per-command policies present, and the application role unable
 * to switch RLS off or escalate.
 */
import { Pool } from 'pg';
import { assertIsRestrictedAppRole, createAppPool, expectPgError, inTenantTxRollback } from './helpers/db';
import { TENANT_A } from './helpers/fixtures';

describe('Database hardening (application role)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createAppPool(1);
    await assertIsRestrictedAppRole(pool);
  });

  afterAll(async () => pool?.end());

  it('has RLS enabled and forced on patients', async () => {
    const { rows } = await pool.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.patients'::regclass",
    );
    expect(rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('has a policy for each of SELECT, INSERT, UPDATE and DELETE', async () => {
    const { rows } = await pool.query<{ cmd: string }>(
      "SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patients' ORDER BY cmd",
    );
    expect(rows.map((r) => r.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });

  it('is not superuser, has no BYPASSRLS, does not own patients, and is a member of no role', async () => {
    await assertIsRestrictedAppRole(pool);
    const { rowCount } = await pool.query(
      'SELECT 1 FROM pg_auth_members m JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = current_user',
    );
    expect(rowCount).toBe(0);
  });

  it.each([
    'ALTER TABLE patients DISABLE ROW LEVEL SECURITY',
    'ALTER TABLE patients NO FORCE ROW LEVEL SECURITY',
    'DROP POLICY patients_select ON patients',
    'CREATE POLICY allow_all ON patients USING (true)',
    'ALTER TABLE patients OWNER TO CURRENT_USER',
  ])('cannot run: %s', async (sql) => {
    const err = await expectPgError(pool.query(sql));
    expect(err.code).toBe('42501'); // insufficient_privilege / must be owner
  });

  it('cannot SET ROLE to the owner role', async () => {
    const { rows } = await pool.query<{ relowner: string }>(
      "SELECT pg_get_userbyid(relowner) AS relowner FROM pg_class WHERE oid = 'public.patients'::regclass",
    );
    const err = await expectPgError(pool.query(`SET ROLE ${rows[0].relowner}`));
    expect(err.code).toBe('42501');
  });

  it('cannot TRUNCATE patients (bypasses RLS, so must not be granted)', async () => {
    const err = await expectPgError(pool.query('TRUNCATE patients'));
    expect(err.code).toBe('42501');
  });

  it('row_security = off makes the query fail instead of bypassing policies', async () => {
    const err = await inTenantTxRollback(pool, TENANT_A, async (c) => {
      await c.query('SET LOCAL row_security = off');
      return expectPgError(c.query('SELECT * FROM patients'));
    });
    expect(err.code).toBe('42501');
    expect(err.message).toMatch(/row-level security/);
  });
});
