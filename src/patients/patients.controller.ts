import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../auth/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PatientDto, PatientsService } from './patients.service';

@Controller('patients')
@UseGuards(JwtAuthGuard)
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  /** Tenant comes only from the verified token; headers/query/body are not read. */
  @Get()
  list(@CurrentTenant() tenantId: string): Promise<PatientDto[]> {
    return this.patients.listPatients(tenantId);
  }
}
