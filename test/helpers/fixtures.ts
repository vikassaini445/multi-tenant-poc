// Must match database/seed/001_tenants_and_patients.sql.
export const TENANT_A = '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b';
export const TENANT_B = '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a';

export const SEEDED_PATIENTS = {
  [TENANT_A]: [
    { id: 'a0000000-0000-4000-8000-000000000001', patientName: 'Alice Anderson' },
    { id: 'a0000000-0000-4000-8000-000000000002', patientName: 'Aaron Abbott' },
  ],
  [TENANT_B]: [
    { id: 'b0000000-0000-4000-8000-000000000001', patientName: 'Bella Brown' },
    { id: 'b0000000-0000-4000-8000-000000000002', patientName: 'Bruno Baker' },
  ],
} as const;

export const seededIds = (tenant: string): string[] =>
  SEEDED_PATIENTS[tenant as keyof typeof SEEDED_PATIENTS].map((p) => p.id);
