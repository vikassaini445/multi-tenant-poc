import { Module } from '@nestjs/common';
import { PatientsModule } from './patients/patients.module';

@Module({
  imports: [PatientsModule],
})
export class AppModule {}
