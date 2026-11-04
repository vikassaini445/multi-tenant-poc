CREATE TABLE patients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  patient_name text NOT NULL CHECK (length(patient_name) BETWEEN 1 AND 200),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Every RLS predicate filters on tenant_id.
CREATE INDEX patients_tenant_id_idx ON patients (tenant_id);

REVOKE ALL ON patients FROM PUBLIC;

-- Only DML. Deliberately no TRUNCATE (it ignores RLS), REFERENCES or TRIGGER.
DO $$
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO %I',
                 current_setting('migration.app_role'));
END
$$;
