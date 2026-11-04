/**
 * Database failures must surface as a generic 500 without driver/SQL details.
 */
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { PG_POOL } from '../src/database/database.constants';
import { createTestApp } from './helpers/app';
import { tokenFor } from './helpers/auth';
import { TENANT_A } from './helpers/fixtures';

describe('Database errors are not exposed to clients', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp(1);
  });

  afterAll(async () => app?.close().catch(() => undefined));

  it('returns a generic 500 when the database is unavailable', async () => {
    // End the pool so every query fails inside the transaction service.
    await app.get<Pool>(PG_POOL).end();

    const res = await request(app.getHttpServer())
      .get('/patients')
      .set('Authorization', `Bearer ${tokenFor(TENANT_A)}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(res.text).not.toMatch(/pool|postgres|patients|select|stack/i);
  });
});
