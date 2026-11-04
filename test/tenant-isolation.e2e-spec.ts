/**
 * Test A — Tenant isolation enforced by PostgreSQL itself.
 *
 * Runs as the application role through a plain pg pool (no app code), so a
 * pass proves the database policies isolate tenants on their own. No query
 * here filters by tenant in SQL unless it is explicitly trying to reach the
 * other tenant's rows.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertIsRestrictedAppRole, createAppPool, expectPgError, inTenantTxRollback } from './helpers/db';
import { TENANT_A, TENANT_B, seededIds } from './helpers/fixtures';

type Row = { id: string; tenant_id: string; patient_name: string };

describe('Test A: tenant isolation (database level)', () => {
  let pool: Pool;
  // Records created by this test (committed through the INSERT policy) on top of the seed.
  const created: Record<string, { id: string; name: string }> = {
    [TENANT_A]: { id: randomUUID(), name: `Isolation-A-${randomUUID().slice(0, 8)}` },
    [TENANT_B]: { id: randomUUID(), name: `Isolation-B-${randomUUID().slice(0, 8)}` },
  };

  async function commitAs(tenant: string, sql: string, params: unknown[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
      await client.query(sql, params);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = createAppPool(2);
    await assertIsRestrictedAppRole(pool);
    for (const tenant of [TENANT_A, TENANT_B]) {
      await commitAs(tenant, 'INSERT INTO patients (id, tenant_id, patient_name) VALUES ($1, $2, $3)', [
        created[tenant].id,
        tenant,
        created[tenant].name,
      ]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    for (const tenant of [TENANT_A, TENANT_B]) {
      await commitAs(tenant, 'DELETE FROM patients WHERE id = $1', [created[tenant].id]).catch(() => undefined);
    }
    await pool.end();
  });

  describe.each([
    ['Tenant A', TENANT_A, TENANT_B],
    ['Tenant B', TENANT_B, TENANT_A],
  ])('%s context', (_label, self, other) => {
    const ownIds = () => [...seededIds(self), created[self].id].sort();
    const otherIds = () => [...seededIds(other), created[other].id];

    it('sees exactly its own records with an unfiltered SELECT', async () => {
      const rows = await inTenantTxRollback(pool, self, async (c) =>
        (await c.query<Row>('SELECT id, tenant_id, patient_name FROM patients')).rows,
      );
      expect(rows.map((r) => r.id).sort()).toEqual(ownIds());
      expect(rows.every((r) => r.tenant_id === self)).toBe(true);
    });

    it("cannot read the other tenant's records even when asking for them explicitly", async () => {
      const result = await inTenantTxRollback(pool, self, async (c) => ({
        byTenant: (await c.query('SELECT id FROM patients WHERE tenant_id = $1', [other])).rowCount,
        byId: (await c.query('SELECT id FROM patients WHERE id = ANY($1::uuid[])', [otherIds()])).rowCount,
        count: (await c.query<{ n: string }>('SELECT count(*) AS n FROM patients WHERE tenant_id <> $1', [self]))
          .rows[0].n,
      }));
      expect(result).toEqual({ byTenant: 0, byId: 0, count: '0' });
    });

    it("cannot INSERT a row for the other tenant (WITH CHECK)", async () => {
      const err = await inTenantTxRollback(pool, self, (c) =>
        expectPgError(
          c.query('INSERT INTO patients (tenant_id, patient_name) VALUES ($1, $2)', [other, 'Cross-tenant insert']),
        ),
      );
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/row-level security/);
    });

    it("cannot UPDATE the other tenant's rows (USING hides them)", async () => {
      const updated = await inTenantTxRollback(pool, self, async (c) =>
        (await c.query("UPDATE patients SET patient_name = 'pwned' WHERE id = ANY($1::uuid[])", [otherIds()]))
          .rowCount,
      );
      expect(updated).toBe(0);
    });

    it('cannot move its own row into the other tenant (UPDATE WITH CHECK)', async () => {
      const err = await inTenantTxRollback(pool, self, (c) =>
        expectPgError(c.query('UPDATE patients SET tenant_id = $1 WHERE id = $2', [other, created[self].id])),
      );
      expect(err.code).toBe('42501');
    });

    it('cannot move its rows into the other tenant with a column-free UPDATE (UPDATE WITH CHECK alone)', async () => {
      // With a WHERE/RETURNING that reads columns, Postgres also applies the
      // SELECT policy to the new row, which would hide a missing UPDATE
      // WITH CHECK. No WHERE here, so only the UPDATE policy can block it.
      const err = await inTenantTxRollback(pool, self, (c) =>
        expectPgError(c.query('UPDATE patients SET tenant_id = $1', [other])),
      );
      expect(err.code).toBe('42501');
    });

    it("cannot DELETE the other tenant's rows", async () => {
      const deleted = await inTenantTxRollback(pool, self, async (c) =>
        (await c.query('DELETE FROM patients WHERE id = ANY($1::uuid[])', [otherIds()])).rowCount,
      );
      expect(deleted).toBe(0);
    });
  });

  it('cross-tenant write attempts left the other tenant’s data untouched', async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      const rows = await inTenantTxRollback(pool, tenant, async (c) =>
        (await c.query<Row>('SELECT id, patient_name FROM patients')).rows,
      );
      expect(rows.map((r) => r.id).sort()).toEqual([...seededIds(tenant), created[tenant].id].sort());
      expect(rows.some((r) => r.patient_name === 'pwned')).toBe(false);
    }
  });
});
