-- Tenant isolation enforced by PostgreSQL.
--
-- ENABLE turns RLS on for non-owners; FORCE applies it to the table owner too,
-- so not even the migration role can read across tenants by accident.
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

-- Tenant context: set per transaction by the app with
--   SELECT set_config('app.current_tenant', $1, true)   -- == SET LOCAL
--
-- current_setting(..., true) returns NULL instead of raising when the setting
-- was never defined; NULLIF maps the empty string (what the setting reverts to
-- after a SET LOCAL transaction ends on a pooled connection) to NULL as well.
-- `tenant_id = NULL` is never true, so missing context matches zero rows.
-- A malformed value fails the ::uuid cast and the statement errors (fail closed).
--
-- Separate policies per command keep USING (which existing rows are visible /
-- targetable) and WITH CHECK (which new row versions are allowed) explicit.

CREATE POLICY patients_select ON patients
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE POLICY patients_insert ON patients
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- USING: only the tenant's own rows can be targeted.
-- WITH CHECK: an updated row cannot be moved to another tenant.
CREATE POLICY patients_update ON patients
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE POLICY patients_delete ON patients
  FOR DELETE
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
