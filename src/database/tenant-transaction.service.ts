import { Inject, Injectable } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { isTenantId } from '../tenants/tenant-id';
import { PG_POOL } from './database.constants';

/**
 * The only handle tenant-scoped code gets. It exposes `query` and nothing
 * else (no release, no access to the pool), and stops working once the
 * transaction is over.
 */
export interface TenantQueryRunner {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

@Injectable()
export class TenantTransactionService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Runs `work` inside a transaction whose tenant context is `tenantId`.
   *
   * One connection is checked out for the whole unit of work; the context is
   * transaction-local (set_config(..., true) == SET LOCAL) so it disappears at
   * COMMIT/ROLLBACK and cannot follow the connection back into the pool.
   */
  async run<T>(tenantId: string, work: (tx: TenantQueryRunner) => Promise<T>): Promise<T> {
    if (!isTenantId(tenantId)) {
      throw new Error('Invalid tenant id');
    }

    const client = await this.pool.connect();
    let active = true;
    // Set when the connection's state is unknown; release(err) then destroys it
    // instead of returning it to the pool.
    let discardReason: Error | undefined;

    const runner: TenantQueryRunner = {
      query: <R extends QueryResultRow>(text: string, params?: unknown[]) => {
        if (!active) {
          return Promise.reject(new Error('Tenant transaction has already ended'));
        }
        return client.query<R>(text, params);
      },
    };

    try {
      await client.query('BEGIN');
      // SET LOCAL cannot take bind parameters; set_config(name, value, is_local => true)
      // is its parameterized equivalent.
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      const result = await work(runner);

      active = false;
      const commit = await client.query('COMMIT');
      // If any statement failed (even one `work` caught), Postgres answers
      // COMMIT with ROLLBACK instead of an error. Don't report success.
      if (commit.command !== 'COMMIT') {
        throw new Error('Transaction was rolled back by the database');
      }
      return result;
    } catch (err) {
      active = false;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        discardReason = rollbackErr as Error;
      }
      throw err;
    } finally {
      active = false;
      client.release(discardReason);
    }
  }
}
