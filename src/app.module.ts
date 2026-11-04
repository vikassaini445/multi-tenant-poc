import { Module } from '@nestjs/common';
import { DemoModule } from './demo/demo.module';
import { PatientsModule } from './patients/patients.module';

@Module({
  imports: [PatientsModule, DemoModule],
})
export class AppModule {}
