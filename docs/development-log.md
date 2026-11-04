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
