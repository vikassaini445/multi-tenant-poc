import { Pool, PoolClient } from 'pg';
import { requireEnv } from '../../src/config/env';

/** A pool connected as the APPLICATION role (DATABASE_URL), never the owner. */
export function createAppPool(max = 2): Pool {
  return new Pool({ connectionString: requireEnv('DATABASE_URL'), max });
}

/**
 * Guards every suite: if tests ran as a superuser, a BYPASSRLS role, or the
 * table owner, RLS tests could pass or fail for the wrong reason.
 */
export async function assertIsRestrictedAppRole(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean; owns_patients: boolean }>(`
    SELECT r.rolsuper,
           r.rolbypassrls,
           EXISTS (SELECT 1 FROM pg_class c
                   WHERE c.relname = 'patients' AND c.relowner = r.oid) AS owns_patients
    FROM pg_roles r WHERE r.rolname = current_user`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns_patients: false });
}

/**
 * Runs `fn` in a transaction with the tenant context set exactly the way the
 * application must set it, then ALWAYS rolls back so tests leave no data.
 * Test-only: independent of the app's TransactionService on purpose, so the
 * database policies are tested on their own.
 */
export async function inTenantTxRollback<T>(
  pool: Pool,
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId !== null) {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    }
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Resolves to the Postgres error, or fails the test if the promise resolved. */
export async function expectPgError(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('Expected a PostgreSQL error, but the query succeeded');
}
