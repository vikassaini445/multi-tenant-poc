# Development Log

Built with Claude Code (Claude Opus 5.5), 2026-11-04. Each phase below is one
git commit; `git log --stat` shows the exact files per phase.

**Prompt used:** the single task prompt in
[prompts/01-initial-prompt.md](prompts/01-initial-prompt.md) (verbatim). No
other prompts were given unless listed in a later phase.

---

## Phase 1 — Repository inspection and project setup

**What was done**

- Inspected the working directory (`/home/vikass`): it is a home directory, not
  a project and not a git repo. Created a new `multi-tenant-poc/` directory and
  initialised git there, leaving everything else untouched.
- Found host ports 5432 and 5433 already used by other local Postgres
  instances, so Docker Compose maps Postgres to host port **5434**
  (`POSTGRES_HOST_PORT` overrides it).
- Scaffolded `package.json`, TypeScript config, Docker Compose (Postgres 16),
  `.env.example`, and the database setup runner `scripts/migrate.ts`.
- Implemented the role bootstrap step (run once, as superuser).

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`,
`tsconfig.build.json`, `.gitignore`, `.env.example`, `docker-compose.yml`,
`src/config/env.ts`, `scripts/migrate.ts`, `docs/`.

**Decisions**

| Decision | Reason |
|---|---|
| NestJS **11**, not 12 | NestJS 12 ships as ESM only (`"type": "module"`); Jest + ts-jest with ESM is fragile. 11 is CommonJS and maintained. |
| TypeScript **5.9**, not 7 | ts-jest 29 declares `typescript >=4.3 <7`. |
| `overrides.multer = 2.5.0` | `npm audit --omit=dev` reported 2 high advisories in multer (pulled in by `@nestjs/platform-express`). The POC has no upload endpoint, but pinning the patched version costs nothing. Production audit is now 0 vulnerabilities; remaining advisories are in dev-only Jest tooling. |
| Role names/passwords are derived from `MIGRATION_DATABASE_URL` / `DATABASE_URL` | One source of truth; no separate password variables that can drift. |
| Bootstrap uses `ALTER ROLE` when the role exists | Re-running re-hardens a role that was loosened by hand (e.g. someone granted `BYPASSRLS`). |
| App role is `NOINHERIT`, no memberships, `idle_in_transaction_session_timeout=30s` | It can never inherit the owner's privileges; a leaked open transaction (which still holds its tenant context) is killed by the server. |
| `REVOKE ALL ON DATABASE ... FROM PUBLIC`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC` | Only the owner can create objects; the app role cannot create its own tables/functions. |

**Issues found in Claude Code's own output**

1. First draft of `scripts/migrate.ts` computed the `database/` directory with
   a nested `endsWith('dist')` ternary. Tracing it showed it did resolve
   correctly under both ts-node and `dist/`, but it was needlessly hard to
   verify. Replaced on self-review (before first run) with
   `join(process.cwd(), 'database')`. Not a functional bug — a readability fix.

**Verification (actually run)**

```
$ docker compose up -d --wait        -> container healthy
$ npm run db:bootstrap               -> bootstrap: roles mt_owner (owner) and mt_app (app) ready
$ psql ... FROM pg_roles
 rolname  | rolsuper | rolbypassrls | rolinherit | rolcreaterole | rolcreatedb | rolconfig
 mt_owner | f        | f            | t          | f             | f           |
 mt_app   | f        | f            | f          | f             | f           | {idle_in_transaction_session_timeout=30s}
mt_app role memberships: 0 rows
```

---

## Phase 2 — Security tests written first (red)

**What was done:** wrote the suites before any table, policy or endpoint
existed, against contracts the implementation would have to meet:
`test/tenant-isolation`, `missing-tenant`, `forged-tenant`, `connection-pool`,
`database-hardening`, plus helpers (`test/helpers/*`). Tests use a real
PostgreSQL connected as the app role; `assertIsRestrictedAppRole()` runs in
every suite so a test can never pass because it ran as a superuser/owner.
DB-level tests use plain `pg` (not app code) so they prove the database
policies on their own; API tests boot the real Nest app.

**Files:** `test/**`.

**Red run (actually run):** `Test Suites: 5 failed, 5 total — Tests: 23 failed, 1 passed`.
DB suites failed with `relation "patients" does not exist`; API/pool suites
with `Cannot find module '../../src/app.module'`.

**Bug found in Claude Code's own output (real):**
`src/config/env.ts` used `process.loadEnvFile('.env')`. Running a single suite
alone gave *every* test failing with `Missing required environment variable
DATABASE_URL`. Cause: `loadEnvFile` writes to Node's native env, but Jest gives
each test file a sandboxed copy of `process.env`. In the full run the first
suite failed for this reason and later suites only worked because they copied
the native env after it had been populated — so the full-run "1 passed" was an
ordering artifact. **Identified** by running one suite in isolation and reading
the failure message instead of assuming which test had passed. **Fixed** by
parsing with `util.parseEnv` and assigning through `process.env`
(commit "Fix .env loading under Jest's sandboxed process.env"). Afterwards a
single suite and the full run agree.

---

## Phase 3a — Schema without RLS (tests must fail for the *right* reason)

**What was done:** migrations `001_create_tenants.sql`, `002_create_patients.sql`
(table, index, DML grants to the app role) and the seed — deliberately without
RLS, to show the isolation tests detect a real leak rather than just a missing table.

**Decisions**
- Migrations grant to the app role via `format('%I', current_setting('migration.app_role'))`;
  the runner sets that transaction-locally from `DATABASE_URL`, so role names
  are not hard-coded and nothing is concatenated.
- App role gets `SELECT, INSERT, UPDATE, DELETE` only — no `TRUNCATE` (ignores
  RLS), no access to `tenants`.
- Seed runs as the owner, setting each tenant's context before inserting its rows.

**Red run (actually run):** tenant A saw/updated/deleted 3 of B's rows
(`Expected: 0, Received: 3`), cross-tenant INSERT succeeded, hardening tests
reported RLS off and no policies. All writes ran in rolled-back transactions.

---

## Phase 3b — RLS (DB tests green)

**What was done:** `003_patients_rls.sql`: `ENABLE` + `FORCE ROW LEVEL SECURITY`,
one policy per command with predicate
`tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`.

**Result (actually run, Jest JSON reporter):** 24 passed, 0 failed, 0 pending.

**Incorrect assumption in the task spec (verified, not a Claude Code mistake):**
the prompt asks to "execute `SET LOCAL` using a parameterized query".
`SET LOCAL app.current_tenant = $1` fails with `42601 syntax error at or near "$1"`
— utility statements cannot take bind parameters. Used the documented
equivalent `SELECT set_config('app.current_tenant', $1, true)`; also verified
the value reverts to `''` after `COMMIT` (handled by `NULLIF`).

---

## Phase 4 — Application (JWT auth, transaction service, GET /patients)

**Tests added first** (before implementation): a swallowed SQL error must not
be reported as a commit; an escaped query handle must be unusable after the
transaction; a DB failure must return a generic 500 (`error-handling.e2e-spec.ts`).

**Files:** `src/auth/*`, `src/database/*`, `src/patients/*`, `src/tenants/tenant-id.ts`,
`src/app.module.ts`, `src/main.ts`.

**Decisions**
- Tenant comes only from a verified JWT (`HS256` pinned, `iss`/`aud`/`exp`
  checked, `tenant_id` must be a UUID). Headers/query/body are never read, so
  forged values are ignored rather than parsed and rejected.
- `@CurrentTenant()` throws if the guard did not run (fails closed if someone
  forgets `@UseGuards`).
- `TenantTransactionService.run()` — one connection per unit of work, `BEGIN`,
  `set_config(..., true)`, work, `COMMIT`/`ROLLBACK`, `release()` in `finally`;
  query-only handle invalidated after the transaction; `COMMIT` answered with
  `ROLLBACK` is treated as failure; connection destroyed if `ROLLBACK` fails.
- `PatientsService` has no `WHERE tenant_id` so API tests exercise RLS.
- Pool `error` handler logs only the error code.

**Result (actually run):** 6 suites, 63 passed, 0 failed, 0 pending — first try.

---

## Phase 5 — Proving the tests are not vacuous (mutation testing)

Because everything passed first time, each security control was broken on
purpose and the relevant suites re-run (`scripts/mutation-check.sh`).

**Gaps found in Claude Code's own tests (real):**

1. **UPDATE `WITH CHECK` was untested.** Replacing it with `WITH CHECK (true)`
   left all 13 isolation tests green. The existing test used
   `UPDATE ... SET tenant_id = B WHERE id = $2`; because the `WHERE` reads a
   column, PostgreSQL also applies the SELECT policy to the new row, which
   blocked the move on its own. **Fixed** by adding a column-free
   `UPDATE patients SET tenant_id = $1`, where only the UPDATE policy applies.
   Verified: passes against the real policy, fails (2 tests) under the mutation.
2. **A connection leak hung the run instead of failing it.** With
   `client.release()` removed, all 10 pool tests did fail (`timeout exceeded
   when trying to connect`), but `app.close()` then waited forever on the
   checked-out client so Jest never exited. **Fixed** with `--forceExit` in
   `npm test` (exit code still non-zero on failure; leaks are caught by the
   explicit `afterEach` pool-count assertions, not by hanging) and a 10-minute
   CI job timeout.

Also observed: removing `ROLLBACK` on failure is not caught by the "after a
FAILED transaction" test specifically, but is caught by 4 other pool tests.
(Probable reason, not separately verified: the connection goes back to the pool
mid-transaction, and the next `BEGIN` is a no-op warning while its `set_config`
overwrites the stale context.)

**Mutation check result (actually run, `bash scripts/mutation-check.sh`):**

```
detected  M1  SELECT policy USING (true)  (14 failing tests)
detected  M2  missing context matches all rows  (4 failing tests)
detected  M3  INSERT WITH CHECK (true)  (2 failing tests)
detected  M4  UPDATE WITH CHECK (true)  (2 failing tests)
detected  M5  RLS not forced  (1 failing tests)
detected  M6  app role has BYPASSRLS  (15 failing tests)
detected  M7  session-level SET instead of SET LOCAL  (2 failing tests)
detected  M8  X-Tenant-Id header overrides token  (2 failing tests)
detected  M9  JWT decoded without verification  (5 failing tests)
detected  M10 connection never released  (10 failing tests)
detected  M11 no ROLLBACK on failure  (4 failing tests)
detected  M12 COMMIT result not checked  (1 failing tests)
detected  M13 escaped query handle still usable  (1 failing tests)
survived: 0
```

Every mutated run exited with code 1 — i.e. the exact `npm test` command CI
uses fails the build when a security test fails (Test E, verified locally).

---

## Phase 6 — CI, Docker, README, token helper

**Files:** `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`,
`docker-compose.yml` (added `migrate` one-shot + `api`), `scripts/issue-token.ts`, `README.md`.

**Decisions**
- CI: Postgres service → `npm ci` → typecheck → grep that refuses
  `.skip/.only/xit/fit` in `test/` → bootstrap (superuser) → migrate + seed
  (owner) → `npm test` with the superuser and owner URLs **unset** → build.
  No `|| true`; `timeout-minutes: 10`.
- Compose `api` service is given only the app role's URL.
- Docker image runs as the non-root `node` user.

**Verification (actually run)**
- Workflow YAML parses; triggers `push`, `pull_request`; no `|| true` in
  workflow/scripts; skip-guard regex matches a probe `it.skip(` and finds nothing in `test/`.
- Fresh stack (`docker compose -p mtpoc-fresh up --build`, new volume):
  migrate container applied bootstrap, 3 migrations and seed; API healthy.
  `curl` with Tenant A token → A's 2 patients; Tenant B token → B's 2;
  A token + `X-Tenant-Id: B` + `?tenant_id=B` → A's 2 only; no token → 401;
  `pg_stat_activity` shows the API connected as `mt_app`.
- Full suite against that fresh database with admin/owner URLs unset (as CI
  does): 6 suites, **65 passed, 0 failed, 0 pending**, exit 0.

**Not verified:** the workflow has not been executed on GitHub Actions — this
repository has no remote yet. It was validated locally as described above.

---

## Security review checklist

| Check | Status | Evidence |
|---|---|---|
| RLS enabled and forced | ✅ | `database-hardening`: `relrowsecurity = relforcerowsecurity = true`; M5 |
| App role has no BYPASSRLS / not superuser | ✅ | `assertIsRestrictedAppRole()` in every suite; M6 |
| App role is not the table owner, cannot disable RLS | ✅ | owner check; `ALTER TABLE ... DISABLE/NO FORCE`, `DROP/CREATE POLICY`, `OWNER TO`, `SET ROLE`, `TRUNCATE` all 42501 |
| Tenant from trusted auth context | ✅ | `JwtAuthGuard` (HS256 pinned, iss/aud/exp); M9 |
| No request-controlled tenant ID trusted | ✅ | `forged-tenant` header/query/body tests; M8 |
| Missing context cannot expose records | ✅ | `missing-tenant` (null, empty, reverted, malformed); M2 |
| All tenant queries on the transaction-bound connection | ✅ | `TenantQueryRunner` only wraps the checked-out client; escaped handle rejected (M13) |
| `SET LOCAL` used correctly | ✅ | `set_config(..., true)`, parameterized; M7 |
| Pooled connections don't leak context | ✅ | pool size 1, same PID, after commit/rollback/SQL error; concurrency tests |
| INSERT/UPDATE prevent cross-tenant writes | ✅ | Test A WITH CHECK tests; M3, M4 |
| DB errors don't leak details | ✅ | `error-handling` → generic 500; pool error logger logs code only |
| CI fails on test failure | ✅ locally / ⚠️ not run on GitHub | mutated runs exit 1; no `|| true` |
| Connection/transaction leaks | ✅ | `afterEach` pool counts; M10, M11; `idle_in_transaction_session_timeout=30s` |

Known limitations are listed in the README ("Security limitations of this POC").
