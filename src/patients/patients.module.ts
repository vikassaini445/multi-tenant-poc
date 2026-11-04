import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
