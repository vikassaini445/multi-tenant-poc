-- Tenants. The application role gets no privileges on this table: GET /patients
-- does not need it, and tenant identity comes from the verified JWT.
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON tenants FROM PUBLIC;
