# Multi-Tenant PostgreSQL RLS — Security POC

A small NestJS API showing **tenant data isolation enforced by PostgreSQL
Row-Level Security (RLS)**, not by application `WHERE` clauses. Even if
application code forgets to filter, or a request tries to name another tenant,
the database returns only the authenticated tenant's rows.

## Architecture

```
HTTP request
  │  Authorization: Bearer <JWT{sub, tenant_id}>
  ▼
JwtAuthGuard ── verifies HS256 signature, iss, aud, exp; tenant_id must be a UUID
  │             (X-Tenant-Id headers, query strings, bodies are never read)
  ▼
PatientsController ── @CurrentTenant() = tenant from the verified token only
  ▼
TenantTransactionService.run(tenantId, work)
  │  client = pool.connect()                      ← one connection for the unit of work
  │  BEGIN
  │  SELECT set_config('app.current_tenant', $1, true)   ← = SET LOCAL, parameterized
  │  work(q)  →  SELECT ... FROM patients          ← no tenant WHERE clause
  │  COMMIT (or ROLLBACK)                         ← context disappears here
  │  client.release()  (in finally)
  ▼
PostgreSQL (role mt_app) ── RLS policies on patients filter by app.current_tenant
```

| Path | Purpose |
|---|---|
| `src/auth/` | JWT guard, `@CurrentTenant()` decorator |
| `src/database/` | `pg.Pool` provider, `TenantTransactionService` |
| `src/tenants/` | Tenant ID (UUID) validation |
| `src/patients/` | `GET /patients` controller and service |
| `src/demo/`, `public/` | Optional browser demo page + demo login (off unless `DEMO_LOGIN_ENABLED=true`) |
| `database/migrations/` | Schema, grants, RLS policies (applied in filename order) |
| `database/seed/` | Two tenants, two patients each |
| `scripts/migrate.ts` | `bootstrap` / `migrate` / `seed` runner |
| `scripts/issue-token.ts` | Dev stand-in for an identity provider |
| `scripts/mutation-check.sh` | Breaks security controls one at a time; proves tests catch it |
| `test/` | Integration tests against real PostgreSQL |

## Database roles

| Role | Used by | Attributes |
|---|---|---|
| `postgres` (superuser) | `db:bootstrap` only, to create the two roles below | never given to the app |
| `mt_owner` | migrations and seed | owns `tenants` and `patients`; `NOSUPERUSER NOBYPASSRLS` |
| `mt_app` | the API and every test | `NOSUPERUSER NOBYPASSRLS NOINHERIT`, no role memberships, not a table owner, only `SELECT/INSERT/UPDATE/DELETE` on `patients` (no `TRUNCATE`, which ignores RLS), no access to `tenants`, `idle_in_transaction_session_timeout=30s` |

Because `mt_app` does not own `patients`, it cannot `ALTER TABLE ... DISABLE/NO
FORCE ROW LEVEL SECURITY`, drop or create policies, or take ownership. These
are asserted in `test/database-hardening.e2e-spec.ts`.

## RLS policies

[`003_patients_rls.sql`](database/migrations/003_patients_rls.sql):

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;   -- applies to the owner too

-- one policy per command; every predicate is:
tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
```

| Policy | `USING` (rows visible/targetable) | `WITH CHECK` (new row versions allowed) |
|---|---|---|
| `patients_select` | own tenant | — |
| `patients_insert` | — | own tenant |
| `patients_update` | own tenant | own tenant (cannot move a row to another tenant) |
| `patients_delete` | own tenant | — |

**Fail-closed context handling**

| Context state | `current_setting(..., true)` | Result |
|---|---|---|
| never set on this session | `NULL` | `tenant_id = NULL` → 0 rows |
| reverted after a previous `SET LOCAL` transaction | `''` → `NULLIF` → `NULL` | 0 rows |
| explicitly empty | `''` → `NULL` | 0 rows |
| not a UUID (e.g. `' OR 1=1 --`) | cast fails | query **errors** (22P02), no rows |

## Tenant context and `SET LOCAL`

The context is **transaction-local**: it exists only between `BEGIN` and
`COMMIT`/`ROLLBACK`, so a pooled connection can never carry one tenant's
context into the next request.

`SET LOCAL app.current_tenant = $1` is **not valid SQL**: PostgreSQL utility
statements cannot take bind parameters (verified: error 42601). The
parameterized equivalent, used here, is:

```sql
SELECT set_config('app.current_tenant', $1, true);  -- third arg true = LOCAL
```

The tenant ID is never concatenated into SQL, and it is validated as a UUID
twice: in the JWT guard and again in `TenantTransactionService`.

`TenantTransactionService.run()` also:
- hands `work` a query-only handle (no `release`, no pool access) that **stops
  working once the transaction ends**, so it can't be used on a connection
  that now belongs to another tenant's request;
- treats a `COMMIT` that PostgreSQL turned into `ROLLBACK` (because a statement
  failed and `work` swallowed the error) as a failure;
- destroys, rather than re-pools, a connection whose `ROLLBACK` failed.

`PatientsService` intentionally has **no** `WHERE tenant_id = ...`, so the API
tests exercise the database's enforcement. Adding one as defense in depth is
reasonable in production, but it would mask an RLS regression in these tests.

## Browser demo

With `DEMO_LOGIN_ENABLED=true` (set in `.env.example` and Docker Compose),
open **http://localhost:3000/**, log in as `alice` (Tenant A) or `bob`
(Tenant B) with password `demo-password` (`DEMO_PASSWORD`), then:

- **Load my patients** → only your tenant's patients.
- **Try to read the other tenant** → sends the other tenant's ID in
  `X-Tenant-Id` and `?tenant_id=`; it is ignored, you still get only your own.
- **Call without a token** → 401.

`POST /auth/demo-login {"username","password"}` maps the user to its tenant
**on the server**; a `tenant_id` in the login body is ignored. With the flag
unset (the default, and in CI) the page and the endpoint return 404. The page
uses a strict CSP (no inline scripts) and keeps the token in memory only.

## API

### `GET /patients`

Requires `Authorization: Bearer <JWT>`, signed HS256 with `JWT_SECRET`,
carrying `iss`, `aud`, `exp`, `sub` and `tenant_id` (UUID).

```bash
TOKEN_A=$(npm run -s token -- A)
curl -s localhost:3000/patients -H "Authorization: Bearer $TOKEN_A"
```

```json
[
  {"id":"a0000000-0000-4000-8000-000000000001","patientName":"Alice Anderson","tenantId":"6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b","createdAt":"2026-11-04T09:39:12.018Z"},
  {"id":"a0000000-0000-4000-8000-000000000002","patientName":"Aaron Abbott","tenantId":"6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b","createdAt":"2026-11-04T09:39:12.018Z"}
]
```

Trying to switch tenant with a header, query or body is ignored (same response):

```bash
curl -s "localhost:3000/patients?tenant_id=9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a" \
  -H "Authorization: Bearer $TOKEN_A" -H "X-Tenant-Id: 9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a"
# → Tenant A's two patients only
```

No token / invalid, expired, tampered, wrong-issuer, `alg: none` token:

```bash
curl -s -i localhost:3000/patients
# HTTP/1.1 401 Unauthorized
# {"message":"Unauthorized","statusCode":401}
```

Database failure: `500 {"statusCode":500,"message":"Internal server error"}`, with no
SQL or driver details.

## Running locally

Prerequisites: Node 22+, Docker. Host ports default to **5434** (Postgres) and
**3000** (API); override with `POSTGRES_HOST_PORT` / `API_HOST_PORT`.

```bash
cp .env.example .env
npm ci

docker compose up -d postgres   # start PostgreSQL
npm run db:setup                # bootstrap roles + migrations + seed
                                # (or individually: db:bootstrap, db:migrate, db:seed)
npm run start:dev               # API on :3000 — open http://localhost:3000/ for the demo page
npm test                        # all integration tests (real PostgreSQL, app role)
bash scripts/mutation-check.sh  # optional: prove the tests catch broken controls
```

### Everything in Docker

```bash
docker compose up --build
# postgres → migrate (one-shot: bootstrap, migrate, seed) → api on :3000
TOKEN_B=$(npm run -s token -- B)   # .env's JWT_SECRET matches the compose default
curl -s localhost:3000/patients -H "Authorization: Bearer $TOKEN_B"
```

## Tests

All tests run against a real PostgreSQL as `mt_app`; nothing about the database
is mocked. Every suite first asserts it is connected as a non-superuser,
non-`BYPASSRLS`, non-owner role.

| File | Covers |
|---|---|
| `tenant-isolation.e2e-spec.ts` | **Test A**: each tenant sees only its rows; cross-tenant SELECT/INSERT/UPDATE/DELETE blocked, including moving a row to another tenant |
| `missing-tenant.e2e-spec.ts` | **Test B**: no / empty / reverted / malformed context gives 0 rows or an error; API rejects missing/invalid tokens |
| `forged-tenant.e2e-spec.ts` | **Test C**: tenant B's ID in headers, query, body is ignored; forged/tampered/`alg:none`/wrong-iss/aud tokens give 401 |
| `connection-pool.e2e-spec.ts` | **Test D**: pool size 1, A then B on the same backend PID; no context after commit/rollback/SQL error; 40 concurrent service calls, 30 concurrent HTTP requests, interleaved transactions on a 4-connection pool; no leaked connections after any test |
| `database-hardening.e2e-spec.ts` | RLS enabled + forced, 4 policies, app role cannot disable/alter RLS, `SET ROLE`, `TRUNCATE`, or bypass with `row_security=off` |
| `error-handling.e2e-spec.ts` | DB failure gives a generic 500 |
| `demo-login.e2e-spec.ts` | Demo users get only their own tenant; body `tenant_id` ignored; bad credentials 401; disabled by default (404) |

`scripts/mutation-check.sh` introduces 13 security bugs one at a time (e.g.
`USING (true)`, session-level `SET`, honoring `X-Tenant-Id`, skipping JWT
verification, leaking the connection) and fails if any of them goes undetected.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request:

1. Starts `postgres:16-alpine` as a service (health-checked).
2. `npm ci`, typecheck.
3. Fails if any test is skipped or focused (`.skip`, `.only`, `xit`, ...).
4. Bootstraps roles (superuser), runs migrations and seed (owner).
5. Runs `npm test` with the superuser and owner URLs **unset**, so tests can only
   use `mt_app`.
6. Builds.

There is no `|| true` anywhere; Jest's non-zero exit fails the step, and a
10-minute job timeout fails a hung run.

## Security limitations of this POC

- **The application is trusted to set the context.** `mt_app` can call
  `set_config('app.current_tenant', <any uuid>)` itself; RLS isolates tenants
  only as long as the app sets the context from the verified identity. A SQL
  injection in the app could switch tenant. Production mitigations: no dynamic
  SQL, or a `SECURITY DEFINER` function that derives the tenant from a signed
  value.
- **Demo login is not real authentication**: one shared password, no rate
  limiting or lockout. Keep `DEMO_LOGIN_ENABLED` off anywhere but a local demo.
- **Auth is a stand-in.** HS256 with a shared secret and a CLI to mint tokens.
  Production would use an IdP with asymmetric keys (RS256/EdDSA, JWKS),
  key rotation, and token revocation.
- No check that the token's `tenant_id` exists in `tenants`. An unknown tenant
  simply sees 0 rows.
- `tenants` itself has no RLS; the app role has no access to it at all.
- Single-database, shared-schema model; no per-tenant encryption keys.
- Dev credentials appear in `.env.example` and `docker-compose.yml`; no TLS to
  the database; no rate limiting, audit logging or pagination.
- Remaining `npm audit` findings are in dev-only test tooling; production
  dependencies audit clean.

## Development log

See [docs/development-log.md](docs/development-log.md) and the prompt in
[docs/prompts/](docs/prompts/).
