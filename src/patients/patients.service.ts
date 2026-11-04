import { Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../database/tenant-transaction.service';

export interface PatientDto {
  id: string;
  patientName: string;
  tenantId: string;
  createdAt: Date;
}

interface PatientRow {
  id: string;
  tenant_id: string;
  patient_name: string;
  created_at: Date;
}

@Injectable()
export class PatientsService {
  constructor(private readonly tx: TenantTransactionService) {}

  /**
   * Deliberately has no `WHERE tenant_id = ...`: row visibility is decided by
   * the RLS policies for the tenant set on this transaction, so the API tests
   * exercise the database's enforcement rather than an application filter.
   */
  async listPatients(tenantId: string): Promise<PatientDto[]> {
    const { rows } = await this.tx.run(tenantId, (q) =>
      q.query<PatientRow>('SELECT id, tenant_id, patient_name, created_at FROM patients ORDER BY created_at, id'),
    );
    return rows.map((r) => ({
      id: r.id,
      patientName: r.patient_name,
      tenantId: r.tenant_id,
      createdAt: r.created_at,
    }));
  }
}
