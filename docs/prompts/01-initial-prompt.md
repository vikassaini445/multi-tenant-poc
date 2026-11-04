# Prompt 01 — Initial task prompt (verbatim)

Given to Claude Code (model: Claude Opus 5.5) at the start of the session, 2026-11-04.

---

# Claude Code Prompt — Multi-Tenant PostgreSQL RLS Security POC

You are a senior backend engineer and PostgreSQL security specialist.

I need you to build a small, production-minded proof of concept (POC) for a client assessment. The project must demonstrate secure multi-tenant data isolation using PostgreSQL Row-Level Security (RLS) and NestJS.

This is a security-focused task. Do not prioritize UI, unnecessary features, or overengineering.

## 1. Technology Stack

Use the following:

- NestJS
- TypeScript
- PostgreSQL
- Node.js `pg` (node-postgres) connection pool
- Jest for testing
- Supertest for API integration testing
- Docker Compose for PostgreSQL
- GitHub Actions for CI
- SQL migrations for database setup

Use a simple, modular, maintainable architecture.

## 2. Core Requirements

### Database

Create a PostgreSQL database with:

- Two tenants: Tenant A and Tenant B.
- A `tenants` table.
- A `patients` table containing:
  - id
  - patient_name
  - tenant_id
  - created_at

Seed at least two patients for each tenant.

Use UUIDs for tenant IDs.

Create separate database roles:

1. Migration/owner role with permission to create tables and configure RLS.
2. Application role with only the required application permissions.

The application role must:

- Not be a superuser.
- Not have `BYPASSRLS`.
- Not own the protected table.
- Not be able to disable RLS or bypass its policies.

### PostgreSQL Row-Level Security

Enable and force RLS on the patients table.

Implement policies that enforce tenant isolation for SELECT, INSERT, UPDATE, and DELETE.

Use a PostgreSQL transaction-local tenant context.

Example:

`SET LOCAL app.current_tenant = 'tenant-uuid';`

Use `current_setting()` safely so missing tenant context does not expose records.

Ensure missing tenant context returns zero rows.

Use appropriate `USING` and `WITH CHECK` expressions.

Do not implement tenant isolation using only application-level WHERE clauses.

PostgreSQL must enforce the isolation independently.

## 3. NestJS API

Implement the following endpoint:

`GET /patients`

The endpoint should:

1. Obtain the tenant identity from a trusted authentication context.
2. Never trust a tenant ID supplied directly through a request header, query parameter, or request body.
3. Start a PostgreSQL transaction.
4. Execute `SET LOCAL` using a parameterized query.
5. Execute the patients query using the same transaction-bound connection.
6. Return only records belonging to the authenticated tenant.
7. Commit or roll back the transaction appropriately.
8. Release the database connection safely.

Implement a minimal authentication mechanism suitable for this POC.

Use a trusted JWT-based authentication context or an equivalent secure testable mechanism.

Do not create a complicated authentication system.

The endpoint must not allow a user to switch tenants by changing a request header.

If a request has no tenant context, it must return no patient records. Preferably reject unauthenticated requests at the API boundary while also demonstrating that the database itself returns zero rows when tenant context is absent.

## 4. Test-Driven Development — Tests First

IMPORTANT:

Write the security tests before implementing the database policies and application endpoint.

Follow this sequence:

1. Create the test cases.
2. Run them and verify that they fail for the expected reasons.
3. Implement the database and application.
4. Run the tests again.
5. Fix all failures.
6. Verify the tests are not passing because of incorrect assertions, mocked database behavior, or skipped execution.

Use a real PostgreSQL database for integration tests.

Do not mock PostgreSQL RLS behavior.

Implement these tests:

### Test A — Tenant Isolation

Create records belonging to Tenant A and Tenant B.

Set the transaction context to Tenant A.

Verify that Tenant A cannot read Tenant B's records.

Repeat for Tenant B.

### Test B — Missing Tenant Context

Execute a database query without setting the tenant context.

Verify that zero records are returned.

Ensure the test covers both a missing setting and an empty setting if appropriate.

### Test C — Forged Tenant ID

Authenticate as Tenant A.

Attempt to send Tenant B's ID through a request header, query parameter, or body.

Verify that the application rejects the forged tenant ID or ignores it and continues using Tenant A's trusted identity.

Verify that Tenant B's records are never returned.

### Test D — Connection Pool Isolation

Configure a small PostgreSQL connection pool.

Preferably set the pool size to 1 for a deterministic connection-reuse test.

Execute:

1. Tenant A transaction.
2. Complete the transaction.
3. Tenant B transaction using the reused connection.
4. Query the patients table.
5. Verify that Tenant B sees only Tenant B's records.

Also test concurrent requests for both tenants.

Verify that tenant context does not leak between transactions.

### Test E — CI Failure Verification

Configure CI so that:

- PostgreSQL starts successfully.
- Migrations execute.
- Integration tests run against PostgreSQL.
- Any failed test causes a non-zero exit code.
- The GitHub Actions workflow fails when a security test fails.

Do not suppress test failures or use `|| true`.

## 5. Database Transaction Implementation

Implement a reusable transaction service.

The transaction must follow this pattern:

- Acquire a connection from the pool.
- Begin a transaction.
- Set the tenant context using `SET LOCAL`.
- Execute all tenant-protected queries on the same connection.
- Commit on success.
- Roll back on failure.
- Release the connection in a finally block.

Use parameterized SQL for tenant values.

Do not concatenate tenant IDs into SQL strings.

Do not use session-level `SET` for tenant context.

Do not set tenant context outside the transaction.

Do not execute tenant-protected queries using a different connection.

Review the implementation carefully for connection leaks and transaction leaks.

## 6. Project Structure

Use a clean and modular structure similar to:

```
multi-tenant-poc/
├── src/
│   ├── auth/
│   ├── database/
│   ├── tenants/
│   ├── patients/
│   ├── app.module.ts
│   └── main.ts
├── database/
│   ├── migrations/
│   └── seed/
├── test/
│   ├── tenant-isolation.e2e-spec.ts
│   ├── missing-tenant.e2e-spec.ts
│   ├── forged-tenant.e2e-spec.ts
│   └── connection-pool.e2e-spec.ts
├── .github/
│   └── workflows/
│       └── ci.yml
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── README.md
└── .gitignore
```

Adjust the structure if necessary, but keep it simple.

## 7. README

Create a concise README explaining:

- Project purpose.
- Multi-tenant architecture.
- Database roles.
- RLS policies.
- Tenant context and SET LOCAL.
- API endpoint.
- How to start PostgreSQL.
- How to run migrations.
- How to run the API.
- How to run tests.
- How to run the entire project using Docker where practical.
- How CI works.
- Security limitations of the POC.

Include example API requests and expected responses.

## 8. GitHub Actions CI

Create a GitHub Actions workflow.

It must:

1. Run on pull requests and pushes.
2. Start PostgreSQL as a service.
3. Install dependencies.
4. Run database migrations.
5. Run the automated tests.
6. Fail if any test fails.

Make sure CI uses a non-superuser application role when executing application-level integration tests.

## 9. Security Review

Before completing the task, perform a security review.

Verify:

- RLS is both enabled and forced.
- The application role has no BYPASSRLS.
- The application role is not the table owner.
- Tenant IDs are taken from trusted authentication context.
- No request-controlled tenant ID is trusted.
- Missing tenant context cannot expose records.
- All tenant-protected queries use the transaction-bound connection.
- SET LOCAL is used correctly.
- Pooled connections do not leak tenant context.
- INSERT and UPDATE policies prevent cross-tenant writes.
- Database errors do not expose sensitive information.
- CI fails on test failures.

Do not claim that a security test passes unless you actually ran it.

## 10. Claude Code Development Log

The client requires a 30-minute walkthrough explaining:

- Every merged change.
- Prompts used.
- What Claude Code got wrong.
- How those mistakes were identified and fixed.

Create a `docs/development-log.md` containing:

- Prompt used.
- Files changed.
- Important implementation decisions.
- Bugs or incorrect assumptions discovered.
- How each issue was corrected.
- Test results.

Do not invent mistakes or claim that Claude Code made a mistake unless it actually happened.

Keep the log updated during development.

## 11. Working Instructions

First inspect the current repository.

If it is empty, initialize the project.

If an existing project is present, preserve unrelated files and avoid unnecessary changes.

Work in small, understandable phases.

Do not generate the entire application in one massive, unreviewed change.

After each phase:

1. Explain what you implemented.
2. List the files changed.
3. Explain important security decisions.
4. Run relevant tests.
5. Show the actual test results.
6. Identify any remaining issues.

Do not skip tests.

Do not use fake database implementations for the security tests.

Do not add unnecessary frontend code.

Do not claim the project is complete until the security tests, database setup, README, and CI workflow have been verified.

Start with Phase 1: inspect the repository and prepare the project setup. Then write the security tests before implementing the RLS policies and API.
