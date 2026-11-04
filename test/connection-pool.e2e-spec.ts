/**
 * Test D — Connection pool isolation.
 *
 * With a pool of size 1 every transaction reuses the same physical
 * connection (asserted via pg_backend_pid()), so any tenant context that
 * survived a transaction would show up in the next one.
 */
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { PG_POOL } from '../src/database/database.constants';
import { TenantTransactionService } from '../src/database/tenant-transaction.service';
import { PatientDto, createTestApp } from './helpers/app';
import { tokenFor } from './helpers/auth';
import { assertIsRestrictedAppRole } from './helpers/db';
import { TENANT_A, TENANT_B, seededIds } from './helpers/fixtures';

type Snapshot = { pid: number; contextAtStart: string | null; tenants: string[]; ids: string[] };

describe('Test D: connection pool isolation', () => {
  let app: INestApplication;
  let pool: Pool;
  let tx: TenantTransactionService;

  beforeAll(async () => {
    app = await createTestApp(1);
    pool = app.get<Pool>(PG_POOL);
    tx = app.get(TenantTransactionService);
    expect(pool.options.max).toBe(1);
    await assertIsRestrictedAppRole(pool);
  });

  afterAll(async () => app?.close());

  afterEach(() => {
    // No test may leave a connection checked out or a caller waiting.
    expect(pool.totalCount).toBeLessThanOrEqual(1);
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });

  /** Runs through the application's TenantTransactionService. */
  const snapshot = (tenant: string) =>
    tx.run(tenant, async (q): Promise<Snapshot> => {
      const meta = await q.query<{ pid: number; ctx: string | null }>(
        "SELECT pg_backend_pid() AS pid, current_setting('app.current_tenant', true) AS ctx",
      );
      const rows = (await q.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM patients')).rows;
      return {
        pid: meta.rows[0].pid,
        contextAtStart: meta.rows[0].ctx,
        tenants: [...new Set(rows.map((r) => r.tenant_id))],
        ids: rows.map((r) => r.id).sort(),
      };
    });

  it('A transaction, then B transaction on the SAME reused connection: B sees only B', async () => {
    const a = await snapshot(TENANT_A);
    const b = await snapshot(TENANT_B);

    expect(b.pid).toBe(a.pid); // really the same physical connection
    expect(a).toMatchObject({ contextAtStart: TENANT_A, tenants: [TENANT_A], ids: seededIds(TENANT_A).sort() });
    expect(b).toMatchObject({ contextAtStart: TENANT_B, tenants: [TENANT_B], ids: seededIds(TENANT_B).sort() });
  });

  it('after a committed tenant transaction, the reused connection has no tenant context', async () => {
    const a = await snapshot(TENANT_A);
    const { rows } = await pool.query<{ pid: number; ctx: string | null; n: string }>(
      "SELECT pg_backend_pid() AS pid, current_setting('app.current_tenant', true) AS ctx, (SELECT count(*) FROM patients) AS n",
    );
    expect(rows[0].pid).toBe(a.pid);
    expect(rows[0].ctx === '' || rows[0].ctx === null).toBe(true);
    expect(rows[0].n).toBe('0');
  });

  it('after a FAILED (rolled back) transaction, context does not leak and the connection is returned', async () => {
    const boom = new Error('work failed');
    await expect(
      tx.run(TENANT_A, async (q) => {
        await q.query('SELECT 1 FROM patients');
        throw boom;
      }),
    ).rejects.toBe(boom);

    const b = await snapshot(TENANT_B);
    expect(b).toMatchObject({ contextAtStart: TENANT_B, tenants: [TENANT_B] });

    const { rows } = await pool.query("SELECT current_setting('app.current_tenant', true) AS ctx");
    expect(rows[0].ctx === '' || rows[0].ctx === null).toBe(true);
  });

  it('after a SQL error inside the transaction, context does not leak and the connection is returned', async () => {
    await expect(tx.run(TENANT_A, (q) => q.query('SELECT * FROM no_such_table'))).rejects.toMatchObject({
      code: '42P01',
    });
    const b = await snapshot(TENANT_B);
    expect(b).toMatchObject({ contextAtStart: TENANT_B, tenants: [TENANT_B] });
  });

  it('a SQL error swallowed by the work function is not reported as a successful commit', async () => {
    // PostgreSQL turns COMMIT of an aborted transaction into ROLLBACK silently.
    await expect(
      tx.run(TENANT_A, async (q) => {
        await q.query('SELECT * FROM no_such_table').catch(() => undefined);
        return 'looks fine';
      }),
    ).rejects.toThrow();
  });

  it('a query handle that escapes the work function cannot be used after the transaction ends', async () => {
    let escaped: { query: (sql: string) => Promise<unknown> } | undefined;
    await tx.run(TENANT_A, async (q) => {
      escaped = q;
    });
    // Without a guard this would run on a pooled connection that may now belong to another tenant.
    await expect(escaped!.query('SELECT id FROM patients')).rejects.toThrow();
  });

  it('rejects a non-UUID tenant before touching the database', async () => {
    await expect(tx.run("' OR 1=1 --", async () => 'unreachable')).rejects.toThrow();
    await expect(tx.run('', async () => 'unreachable')).rejects.toThrow();
  });

  it('concurrent transactions for both tenants never see each other (service level, pool size 1)', async () => {
    const tenants = Array.from({ length: 40 }, (_, i) => (i % 2 ? TENANT_B : TENANT_A));
    const results = await Promise.all(tenants.map((t) => snapshot(t)));
    results.forEach((r, i) => {
      expect(r.contextAtStart).toBe(tenants[i]);
      expect(r.tenants).toEqual([tenants[i]]);
      expect(r.ids).toEqual(seededIds(tenants[i]).sort());
    });
  });

  it('concurrent API requests for both tenants never see each other (pool size 1)', async () => {
    const server = app.getHttpServer();
    const tenants = Array.from({ length: 30 }, (_, i) => (i % 3 ? TENANT_A : TENANT_B));
    const responses = await Promise.all(
      tenants.map((t) => request(server).get('/patients').set('Authorization', `Bearer ${tokenFor(t)}`)),
    );
    responses.forEach((res, i) => {
      expect(res.status).toBe(200);
      const body = res.body as PatientDto[];
      expect(body.map((p) => p.id).sort()).toEqual(seededIds(tenants[i]).sort());
      expect(body.every((p) => p.tenantId === tenants[i])).toBe(true);
    });
  });
});

describe('Test D: concurrent interleaved transactions on a multi-connection pool', () => {
  let app: INestApplication;
  let tx: TenantTransactionService;

  beforeAll(async () => {
    app = await createTestApp(4);
    tx = app.get(TenantTransactionService);
  });

  afterAll(async () => app?.close());

  it('transactions that overlap in time on different connections stay isolated', async () => {
    const tenants = Array.from({ length: 24 }, (_, i) => (i % 2 ? TENANT_B : TENANT_A));
    const results = await Promise.all(
      tenants.map((t) =>
        tx.run(t, async (q) => {
          // Sleep so transactions are genuinely open at the same time and interleave.
          await q.query('SELECT pg_sleep(0.05)');
          const { rows } = await q.query<{ tenant_id: string }>('SELECT tenant_id FROM patients');
          return [...new Set(rows.map((r) => r.tenant_id))];
        }),
      ),
    );
    results.forEach((seen, i) => expect(seen).toEqual([tenants[i]]));
  });
});
