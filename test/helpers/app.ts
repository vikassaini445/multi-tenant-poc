import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

/** Boots the real application (real pool, real Postgres, app role). */
export async function createTestApp(poolMax?: number): Promise<INestApplication> {
  if (poolMax !== undefined) process.env.DB_POOL_MAX = String(poolMax);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

export interface PatientDto {
  id: string;
  patientName: string;
  tenantId: string;
  createdAt: string;
}
