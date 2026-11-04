/**
 * Database setup runner.
 *
 *   bootstrap  - as superuser (ADMIN_DATABASE_URL): create/harden the owner and
 *                application roles. Role names/passwords come from
 *                MIGRATION_DATABASE_URL and DATABASE_URL.
 *   migrate    - as owner (MIGRATION_DATABASE_URL): apply database/migrations/*.sql
 *                in filename order, each in its own transaction, recorded in
 *                schema_migrations.
 *   seed       - as owner: apply database/seed/*.sql.
 *
 * Usage: ts-node scripts/migrate.ts bootstrap migrate seed
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadEnv, requireEnv } from '../src/config/env';

// Resolved from the working directory so it works under ts-node and from dist/.
const DATABASE_DIR = join(process.cwd(), 'database');

function credentialsFrom(url: string): { user: string; password: string; database: string } {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function bootstrap(): Promise<void> {
  const owner = credentialsFrom(requireEnv('MIGRATION_DATABASE_URL'));
  const app = credentialsFrom(requireEnv('DATABASE_URL'));
  if (owner.user === app.user) {
    throw new Error('Owner and application roles must be different');
  }

  await withClient(requireEnv('ADMIN_DATABASE_URL'), async (client) => {
    const ident = (s: string) => client.escapeIdentifier(s);
    const literal = (s: string) => client.escapeLiteral(s);
    // Role attributes are (re)applied on every run so a manually loosened role
    // gets hardened again.
    const roleAttrs = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

    for (const role of [owner, app]) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.user]);
      const verb = rowCount ? 'ALTER' : 'CREATE';
      // DDL cannot take bind parameters; values are escaped by node-postgres.
      await client.query(
        `${verb} ROLE ${ident(role.user)} WITH ${roleAttrs} ${role === app ? 'NOINHERIT' : ''} PASSWORD ${literal(role.password)}`,
      );
    }

    const db = ident(owner.database);
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query(`GRANT CONNECT, CREATE ON DATABASE ${db} TO ${ident(owner.user)}`);
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${ident(app.user)}`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${ident(owner.user)}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(app.user)}`);
    // An open transaction holds its tenant context and locks; don't let a
    // leaked one live forever.
    await client.query(
      `ALTER ROLE ${ident(app.user)} SET idle_in_transaction_session_timeout = '30s'`,
    );
  });
  console.log(`bootstrap: roles ${owner.user} (owner) and ${app.user} (app) ready`);
}

async function migrate(): Promise<void> {
  const appRole = credentialsFrom(requireEnv('DATABASE_URL')).user;
  await withClient(requireEnv('MIGRATION_DATABASE_URL'), async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    const dir = join(DATABASE_DIR, 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        // Lets migrations GRANT to the app role without hard-coding its name.
        await client.query("SELECT set_config('migration.app_role', $1, true)", [appRole]);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migrate: applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migrate: ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log('migrate: up to date');
  });
}

async function seed(): Promise<void> {
  await withClient(requireEnv('MIGRATION_DATABASE_URL'), async (client) => {
    const dir = join(DATABASE_DIR, 'seed');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      // Seed files manage their own transactions (they must SET LOCAL a tenant).
      await client.query(readFileSync(join(dir, file), 'utf8'));
      console.log(`seed: applied ${file}`);
    }
  });
}

const steps: Record<string, () => Promise<void>> = { bootstrap, migrate, seed };

async function main(): Promise<void> {
  loadEnv();
  const requested = process.argv.slice(2);
  if (requested.length === 0 || requested.some((s) => !steps[s])) {
    throw new Error(`Usage: migrate.ts <${Object.keys(steps).join('|')}>...`);
  }
  for (const step of requested) {
    await steps[step]();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
