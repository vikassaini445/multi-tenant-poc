import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { requireEnv } from '../config/env';
import { PG_POOL } from './database.constants';
import { TenantTransactionService } from './tenant-transaction.service';

@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const pool = new Pool({
          connectionString: requireEnv('DATABASE_URL'),
          max: Number(process.env.DB_POOL_MAX ?? 10),
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
          application_name: 'mt-poc-api',
        });
        // An idle client erroring (e.g. server restart) must not crash the process.
        // Log the code only; messages can contain connection details.
        pool.on('error', (err: Error & { code?: string }) =>
          new Logger('PgPool').error(`Idle client error (${err.code ?? 'unknown'})`),
        );
        return pool;
      },
    },
    TenantTransactionService,
  ],
  exports: [TenantTransactionService],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.pool.ended) await this.pool.end();
  }
}
