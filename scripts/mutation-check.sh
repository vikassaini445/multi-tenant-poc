#!/usr/bin/env bash
# Proves the security tests are not vacuous: introduces one security bug at a
# time, runs the relevant suites, and requires at least one test to fail.
# Every mutation is reverted afterwards (DB via SQL, code via git checkout).
#
# Local use only (needs ADMIN_DATABASE_URL). Requires a clean src/ tree.
#   npm run db:setup && bash scripts/mutation-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${ADMIN_DATABASE_URL:?}" "${MIGRATION_DATABASE_URL:?}"

if ! git diff --quiet -- src; then echo "src/ has uncommitted changes; aborting" >&2; exit 2; fi

OUT=$(mktemp -d)
CTX="NULLIF(current_setting('app.current_tenant', true), '')::uuid"
SVC=src/database/tenant-transaction.service.ts
GUARD=src/auth/jwt-auth.guard.ts
survivors=0

owner() { psql "$MIGRATION_DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
admin() { psql "$ADMIN_DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
code_mut() { # file, sed expression
  sed -i "$2" "$1"
  if git diff --quiet -- "$1"; then echo "  !! mutation did not apply to $1" >&2; return 1; fi
}

check() { # label, test paths...
  local label=$1; shift
  timeout 300 npx jest --config test/jest-e2e.json --runInBand --forceExit \
    --json --outputFile="$OUT/r.json" "$@" >/dev/null 2>&1
  local failed
  failed=$(node -e 'console.log(require(process.argv[1]).numFailedTests)' "$OUT/r.json" 2>/dev/null || echo "?")
  if [ "$failed" = "0" ]; then survivors=$((survivors + 1)); echo "SURVIVED  $label"
  else echo "detected  $label  ($failed failing tests)"; fi
}

owner "ALTER POLICY patients_select ON patients USING (true)"
check "M1  SELECT policy USING (true)" test/tenant-isolation.e2e-spec.ts test/forged-tenant.e2e-spec.ts
owner "ALTER POLICY patients_select ON patients USING (tenant_id = $CTX)"

owner "ALTER POLICY patients_select ON patients USING ($CTX IS NULL OR tenant_id = $CTX)"
check "M2  missing context matches all rows" test/missing-tenant.e2e-spec.ts
owner "ALTER POLICY patients_select ON patients USING (tenant_id = $CTX)"

owner "ALTER POLICY patients_insert ON patients WITH CHECK (true)"
check "M3  INSERT WITH CHECK (true)" test/tenant-isolation.e2e-spec.ts
owner "ALTER POLICY patients_insert ON patients WITH CHECK (tenant_id = $CTX)"

owner "ALTER POLICY patients_update ON patients WITH CHECK (true)"
check "M4  UPDATE WITH CHECK (true)" test/tenant-isolation.e2e-spec.ts
owner "ALTER POLICY patients_update ON patients WITH CHECK (tenant_id = $CTX)"

owner "ALTER TABLE patients NO FORCE ROW LEVEL SECURITY"
check "M5  RLS not forced" test/database-hardening.e2e-spec.ts
owner "ALTER TABLE patients FORCE ROW LEVEL SECURITY"

admin "ALTER ROLE $(node -e 'console.log(new URL(process.env.DATABASE_URL).username)') BYPASSRLS"
check "M6  app role has BYPASSRLS" test/tenant-isolation.e2e-spec.ts
admin "ALTER ROLE $(node -e 'console.log(new URL(process.env.DATABASE_URL).username)') NOBYPASSRLS"

code_mut $SVC "s/set_config('app.current_tenant', \$1, true)/set_config('app.current_tenant', \$1, false)/" &&
  check "M7  session-level SET instead of SET LOCAL" test/connection-pool.e2e-spec.ts
git checkout -- src

code_mut $GUARD "s/tenantId: claims.tenant_id })/tenantId: typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : claims.tenant_id })/" &&
  check "M8  X-Tenant-Id header overrides token" test/forged-tenant.e2e-spec.ts
git checkout -- src

code_mut $GUARD "s/claims = await this.jwt.verifyAsync<AccessTokenClaims \& object>(match\[1\]);/claims = this.jwt.decode(match[1]) ?? {};/" &&
  check "M9  JWT decoded without verification" test/forged-tenant.e2e-spec.ts test/missing-tenant.e2e-spec.ts
git checkout -- src

code_mut $SVC "s/      client.release(discardReason);/      void discardReason;/" &&
  check "M10 connection never released" test/connection-pool.e2e-spec.ts
git checkout -- src

code_mut $SVC "s/        await client.query('ROLLBACK');/        void 0;/" &&
  check "M11 no ROLLBACK on failure" test/connection-pool.e2e-spec.ts
git checkout -- src

code_mut $SVC "s/      if (commit.command !== 'COMMIT') {/      if (commit.command === 'never') {/" &&
  check "M12 COMMIT result not checked" test/connection-pool.e2e-spec.ts
git checkout -- src

code_mut $SVC "s/        if (!active) {/        if (false \&\& !active) {/" &&
  check "M13 escaped query handle still usable" test/connection-pool.e2e-spec.ts
git checkout -- src

rm -rf "$OUT"
echo "survived: $survivors"
[ "$survivors" -eq 0 ]
