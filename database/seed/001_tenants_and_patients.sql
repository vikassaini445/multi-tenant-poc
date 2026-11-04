-- Idempotent seed. Runs as the owner role, which is subject to FORCE ROW LEVEL
-- SECURITY like everyone else, so each tenant's rows are inserted under that
-- tenant's transaction-local context. IDs must match test/helpers/fixtures.ts.
BEGIN;

INSERT INTO tenants (id, name) VALUES
  ('6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b', 'Tenant A'),
  ('9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a', 'Tenant B')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('app.current_tenant', '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b', true);
INSERT INTO patients (id, tenant_id, patient_name) VALUES
  ('a0000000-0000-4000-8000-000000000001', '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b', 'Alice Anderson'),
  ('a0000000-0000-4000-8000-000000000002', '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b', 'Aaron Abbott')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('app.current_tenant', '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a', true);
INSERT INTO patients (id, tenant_id, patient_name) VALUES
  ('b0000000-0000-4000-8000-000000000001', '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a', 'Bella Brown'),
  ('b0000000-0000-4000-8000-000000000002', '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a', 'Bruno Baker')
ON CONFLICT (id) DO NOTHING;

COMMIT;
